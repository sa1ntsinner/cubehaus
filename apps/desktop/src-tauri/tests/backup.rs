// Automatic backups of the native file: consistent copies taken through
// SQLite's online backup, published whole or not at all, rotated only after a success.

use cubehaus_lib::backup::{self, Options};
use cubehaus_lib::database::{Database, Statement};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

const DAY: i64 = 86_400_000;
// 2026-11-22T12:00:00Z
const NOON: i64 = 1_795_348_800_000;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "cubehaus-backup-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn statement(sql: &str, params: Vec<Value>) -> Statement {
    Statement {
        sql: sql.into(),
        params,
    }
}

fn add_solve(db: &Database, id: &str, time_ms: i64) {
    db.batch(vec![statement(
        "INSERT INTO solve (id, session_id, time_ms) VALUES (?, 'A', ?)",
        vec![json!(id), json!(time_ms)],
    )])
    .unwrap();
}

fn seeded(dir: &Path) -> Database {
    let db = Database::open(dir).unwrap();
    db.batch(vec![
        statement(
            "CREATE TABLE session (id TEXT PRIMARY KEY) STRICT; \
             CREATE TABLE solve (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id), time_ms INTEGER NOT NULL) STRICT; \
             PRAGMA user_version = 6",
            vec![],
        ),
        statement("INSERT INTO session (id) VALUES ('A')", vec![]),
    ])
    .unwrap();
    add_solve(&db, "a", 9_870);
    db
}

fn ids(db: &Database) -> Vec<String> {
    db.all("SELECT id FROM solve ORDER BY id", vec![])
        .unwrap()
        .into_iter()
        .map(|row| row["id"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn restore_refuses_a_newer_backup_without_touching_the_database() {
    let root = temp_dir("newer");
    let data = root.join("data");
    let backups = root.join("backups");
    let source = root.join("newer.sqlite3");
    let copy = rusqlite::Connection::open(&source).unwrap();
    let newer = env!("CUBEHAUS_SCHEMA_VERSION").parse::<i32>().unwrap() + 1;
    copy.execute_batch(&format!(
        "CREATE TABLE future (id INTEGER); PRAGMA user_version = {newer};"
    ))
    .unwrap();
    drop(copy);

    let db = Arc::new(seeded(&data));
    let target = data.join("cubehaus.sqlite3");
    let before = std::fs::read(&target).unwrap();
    let (current, open_result) = backup::restore(Some(db.clone()), &source, &backups, &data, NOON);
    let kept_connection = current
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, &db));
    let after = std::fs::read(&target).unwrap();
    if let Some(current) = current {
        current.close().unwrap();
    }
    let made_backup = backups.exists();

    let damaged = b"damaged database";
    std::fs::write(&target, damaged).unwrap();
    let (current, damaged_result) = backup::restore(None, &source, &backups, &data, NOON);
    let damaged_after = std::fs::read(&target).unwrap();
    let files = std::fs::read_dir(&data).unwrap().count();
    drop(current);
    std::fs::remove_dir_all(root).unwrap();

    let open_error = open_result.expect_err("the newer backup was accepted");
    assert!(matches!(open_error, backup::RestoreError::NewerSchema));
    assert_eq!(
        serde_json::to_value(open_error).unwrap(),
        "newer_backup_schema"
    );
    assert!(kept_connection);
    assert!(after == before, "the open database was changed");
    assert!(!made_backup);
    assert!(matches!(
        damaged_result,
        Err(backup::RestoreError::NewerSchema)
    ));
    assert_eq!(damaged_after, damaged);
    assert_eq!(files, 1, "the damaged database was set aside");
}

/// Run as a child process by the test below: starts a slow backup and is killed in it.
#[test]
#[ignore = "run as a child process by backup_restores_last_committed_wal_solve"]
fn child_backs_up_slowly() {
    let (Ok(data), Ok(dir)) = (
        std::env::var("CUBEHAUS_CHILD_DATA"),
        std::env::var("CUBEHAUS_CHILD_BACKUPS"),
    ) else {
        return;
    };
    let db = Database::open(Path::new(&data)).unwrap();
    let options = Options {
        pages_per_step: 1,
        pause: Duration::from_millis(400),
        room: None,
    };
    let _ = backup::create_with(&db, Path::new(&dir), NOON + DAY, &options);
}

#[test]
fn backup_restores_last_committed_wal_solve() {
    let data = temp_dir("data");
    let backups = data.join("Backups");
    let db = seeded(&data);

    // A reader holds the WAL open: the next commit stays in the WAL, not the main file.
    let reader = rusqlite::Connection::open(data.join("cubehaus.sqlite3")).unwrap();
    reader.execute_batch("BEGIN").unwrap();
    let held: i64 = reader
        .query_row("SELECT count(*) FROM solve", [], |row| row.get(0))
        .unwrap();
    assert_eq!(held, 1);
    add_solve(&db, "b", 12_345);
    assert!(
        std::fs::metadata(data.join("cubehaus.sqlite3-wal"))
            .unwrap()
            .len()
            > 0
    );

    let first = backup::create(&db, &backups, NOON).unwrap();
    assert_eq!(first.status, "complete");
    assert!(first.bytes > 0);
    assert!(first.id.starts_with("20261122T120000Z-"));
    reader.execute_batch("COMMIT").unwrap();
    drop(reader);

    // The next backup is killed half-way: nothing of it is published.
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["child_backs_up_slowly", "--exact", "--ignored", "--quiet"])
        .env("CUBEHAUS_CHILD_DATA", &data)
        .env("CUBEHAUS_CHILD_BACKUPS", &backups)
        .spawn()
        .unwrap();
    std::thread::sleep(Duration::from_millis(1200));
    let staging = |dir: &Path| {
        std::fs::read_dir(dir).unwrap().flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".backup-staging-")
        })
    };
    assert!(staging(&data), "the child is half-way through its copy");
    assert!(child.try_wait().unwrap().is_none());
    child.kill().unwrap();
    child.wait().unwrap();
    let listed = backup::list(&backups).unwrap();
    assert_eq!(
        listed.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(),
        [first.id.as_str()]
    );

    // Restored into a fresh app-data directory: both solves, sound.
    let fresh = temp_dir("fresh");
    backup::restore_into(&backup::file_of(&backups, &first.id).unwrap(), &fresh).unwrap();
    let restored = Database::open(&fresh).unwrap();
    assert_eq!(ids(&restored), ["a", "b"]);
    assert_eq!(
        restored
            .all("SELECT time_ms FROM solve WHERE id = 'b'", vec![])
            .unwrap()[0]["time_ms"],
        json!(12_345)
    );
    assert_eq!(
        restored.all("PRAGMA integrity_check", vec![]).unwrap()[0]["integrity_check"],
        json!("ok")
    );
    assert!(
        restored
            .all("PRAGMA foreign_key_check", vec![])
            .unwrap()
            .is_empty()
    );
    restored.close().unwrap();

    // A full disk: the backup fails, every earlier copy stays, none is pruned.
    for day in 1..=7 {
        add_solve(&db, &format!("d{day}"), 10_000 + day);
        backup::create(&db, &backups, NOON + day * DAY).unwrap();
    }
    let before = backup::list(&backups).unwrap();
    assert_eq!(before.len(), 7, "seven daily copies kept");
    let full = Options {
        room: Some(1024),
        ..Options::default()
    };
    assert!(backup::create_with(&db, &backups, NOON + 8 * DAY, &full).is_err());
    assert_eq!(backup::list(&backups).unwrap(), before);
    // A folder that cannot be written: the same.
    let locked = temp_dir("locked");
    let mut permissions = std::fs::metadata(&locked).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o555);
    std::fs::set_permissions(&locked, permissions).unwrap();
    assert!(backup::create(&db, &locked, NOON + 8 * DAY).is_err());
    assert!(
        db.all("SELECT 1", vec![]).is_ok(),
        "the live file stays usable"
    );

    // A second copy the same day replaces that day's first; still seven days kept.
    let again = backup::create(&db, &backups, NOON + 7 * DAY + 60_000).unwrap();
    let after = backup::list(&backups).unwrap();
    assert_eq!(after.len(), 7);
    assert_eq!(after[0], again);
    assert!(!after.contains(&before[0]));

    // The latest copy corrupted: restoring it fails and changes nothing; the one before works.
    let latest = backup::file_of(&backups, &again.id).unwrap();
    std::fs::write(&latest, b"SQLite format 3\0 but nothing after").unwrap();
    let target = temp_dir("target");
    std::fs::copy(
        data.join("cubehaus.sqlite3"),
        target.join("cubehaus.sqlite3"),
    )
    .unwrap();
    let untouched = std::fs::read(target.join("cubehaus.sqlite3")).unwrap();
    assert!(backup::restore_into(&latest, &target).is_err());
    assert_eq!(
        std::fs::read(target.join("cubehaus.sqlite3")).unwrap(),
        untouched
    );
    let prior = backup::file_of(&backups, &after[1].id).unwrap();
    backup::restore_into(&prior, &target).unwrap();
    let back = Database::open(&target).unwrap();
    // The copy of the day before: a, b and the six solves up to it.
    assert_eq!(ids(&back).len(), 2 + 6);
    back.close().unwrap();

    db.close().unwrap();
    for dir in [data, fresh, target] {
        let _ = std::fs::remove_dir_all(dir);
    }
    let mut permissions = std::fs::metadata(&locked).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
    std::fs::set_permissions(&locked, permissions).unwrap();
    let _ = std::fs::remove_dir_all(locked);
}

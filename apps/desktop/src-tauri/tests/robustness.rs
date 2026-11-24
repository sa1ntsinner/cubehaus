// The desktop app under conditions it does not choose: a missing, broken or newer database
// file at start, a second copy of the app, a backup while solves are being written, a full
// disk, a window placed by an earlier session.

use cubehaus_lib::backup::{self, Options};
use cubehaus_lib::database::{self, Database, Statement};
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
        "cubehaus-robust-{name}-{}-{}",
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

fn seeded(dir: &Path, solves: usize) -> Database {
    let db = Database::open(dir).unwrap();
    let mut statements = vec![
        statement(
            "CREATE TABLE session (id TEXT PRIMARY KEY) STRICT; \
             CREATE TABLE solve (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id), time_ms INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '') STRICT; \
             PRAGMA user_version = 8",
            vec![],
        ),
        statement("INSERT INTO session (id) VALUES ('A')", vec![]),
    ];
    for i in 0..solves {
        statements.push(statement(
            "INSERT INTO solve (id, session_id, time_ms, note) VALUES (?, 'A', ?, ?)",
            vec![
                json!(format!("s{i:06}")),
                json!(9_000 + i),
                json!("x".repeat(200)),
            ],
        ));
    }
    db.batch(statements).unwrap();
    db
}

fn count(db: &Database) -> i64 {
    db.all("SELECT count(*) AS n FROM solve", vec![]).unwrap()[0]["n"]
        .as_i64()
        .unwrap()
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

fn child(test: &str, vars: &[(&str, &Path)]) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.args([test, "--exact", "--ignored", "--quiet"]);
    for (name, value) in vars {
        command.env(name, value);
    }
    command
}

/// First start: no data directory, no file. Both are made, and the file is a database.
#[test]
fn a_missing_file_is_created_with_its_directory() {
    let root = temp_dir("missing");
    let dir = root.join("nested").join("app.cubehaus.desktop");
    let db = Database::open(&dir).unwrap();
    assert_eq!(db.path(), dir.join("cubehaus.sqlite3"));
    assert_eq!(
        db.all("PRAGMA user_version", vec![]).unwrap()[0]["user_version"],
        json!(0)
    );
    db.close().unwrap();
    let header = std::fs::read(dir.join("cubehaus.sqlite3")).unwrap();
    assert_eq!(&header[..16], b"SQLite format 3\0");
    let _ = std::fs::remove_dir_all(root);
}

/// A file from a newer version of the app (a downgrade, or a copy from another machine):
/// the native side neither migrates nor rejects it (the page refuses a schema it does not
/// know and says so), and it changes nothing in it. Backups of it still work.
#[test]
fn a_newer_schema_is_left_as_it_is() {
    let dir = temp_dir("newer");
    {
        let db = seeded(&dir, 3);
        db.batch(vec![statement("PRAGMA user_version = 99", vec![])])
            .unwrap();
        db.close().unwrap();
    }
    let before = std::fs::read(dir.join("cubehaus.sqlite3")).unwrap();
    let db = Database::open(&dir).unwrap();
    assert_eq!(
        db.all("PRAGMA user_version", vec![]).unwrap()[0]["user_version"],
        json!(99)
    );
    assert_eq!(count(&db), 3);
    db.close().unwrap();
    assert_eq!(std::fs::read(dir.join("cubehaus.sqlite3")).unwrap(), before);

    let db = Database::open(&dir).unwrap();
    let copy = backup::create(&db, &dir.join("Backups"), NOON).unwrap();
    backup::verify(&backup::file_of(&dir.join("Backups"), &copy.id).unwrap()).unwrap();
    db.close().unwrap();
    let _ = std::fs::remove_dir_all(dir);
}

/// A file whose first page is sound but whose later pages are garbage opens (start-up
/// does not read the whole file); reading the damage is an error, never a panic, and the
/// file stays as it was. A backup of it is refused and every earlier copy stays.
#[test]
fn a_damaged_file_is_never_copied_over_good_backups() {
    let dir = temp_dir("damaged");
    let backups = dir.join("Backups");
    {
        let db = seeded(&dir, 2_000);
        backup::create(&db, &backups, NOON).unwrap();
        db.close().unwrap();
    }
    let file = dir.join("cubehaus.sqlite3");
    let mut bytes = std::fs::read(&file).unwrap();
    assert!(bytes.len() > 64 * 1024, "{} bytes", bytes.len());
    let middle = bytes.len() / 2;
    for byte in &mut bytes[middle..middle + 16 * 1024] {
        *byte = 0xA5;
    }
    std::fs::write(&file, &bytes).unwrap();

    let db = Database::open(&dir).unwrap();
    assert!(
        db.all("SELECT sum(length(note)) FROM solve", vec![])
            .is_err()
    );
    let earlier = backup::list(&backups).unwrap();
    assert!(backup::create(&db, &backups, NOON + DAY).is_err());
    assert_eq!(backup::list(&backups).unwrap(), earlier);
    db.close().unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), bytes);
    let _ = std::fs::remove_dir_all(dir);
}

/// A file that cannot be opened at all, and copies in the backup folder: a copy can be put
/// back without the broken file ever opening, and the broken file is kept aside, not
/// deleted.
#[test]
fn a_backup_restores_over_a_file_that_does_not_open() {
    let dir = temp_dir("unopenable");
    let backups = dir.join("Backups");
    let copy = {
        let db = seeded(&dir, 5);
        let copy = backup::create(&db, &backups, NOON).unwrap();
        db.close().unwrap();
        copy
    };
    let file = dir.join("cubehaus.sqlite3");
    std::fs::write(&file, b"this was a database once").unwrap();
    assert!(Database::open(&dir).is_err());

    let source = backup::file_of(&backups, &copy.id).unwrap();
    let (reopened, outcome) = backup::restore(None, &source, &backups, &dir, NOON + DAY);
    outcome.unwrap();
    let db = reopened.expect("the restored file is open");
    assert_eq!(count(&db), 5);
    db.close().unwrap();
    let aside: Vec<_> = names(&dir)
        .into_iter()
        .filter(|name| name.starts_with("cubehaus-unreadable-"))
        .collect();
    assert_eq!(aside.len(), 1, "{:?}", names(&dir));
    assert_eq!(
        std::fs::read(dir.join(&aside[0])).unwrap(),
        b"this was a database once"
    );

    // With the file open, the current file is copied first and the copy put back.
    let db = Arc::new(Database::open(&dir).unwrap());
    db.batch(vec![statement(
        "INSERT INTO solve (id, session_id, time_ms) VALUES ('late', 'A', 1)",
        vec![],
    )])
    .unwrap();
    let (reopened, outcome) = backup::restore(Some(db), &source, &backups, &dir, NOON + 2 * DAY);
    outcome.unwrap();
    let db = reopened.unwrap();
    assert_eq!(count(&db), 5);
    assert_eq!(
        backup::list(&backups).unwrap().len(),
        2,
        "the file before was kept"
    );
    db.close().unwrap();
    let _ = std::fs::remove_dir_all(dir);
}

/// A file that opens but is damaged further in (the case start-up reports as "would not
/// open") cannot be copied first: no sound copy of it exists. A backup still goes back in
/// its place, and the damaged file is kept aside whole, with every earlier copy.
#[test]
fn a_backup_restores_over_a_file_that_opens_damaged() {
    let dir = temp_dir("opens-damaged");
    let backups = dir.join("Backups");
    let copy = {
        let db = seeded(&dir, 2_000);
        let copy = backup::create(&db, &backups, NOON).unwrap();
        db.close().unwrap();
        copy
    };
    let file = dir.join("cubehaus.sqlite3");
    let mut bytes = std::fs::read(&file).unwrap();
    let middle = bytes.len() / 2;
    for byte in &mut bytes[middle..middle + 16 * 1024] {
        *byte = 0xA5;
    }
    std::fs::write(&file, &bytes).unwrap();

    let damaged = Arc::new(Database::open(&dir).unwrap());
    let source = backup::file_of(&backups, &copy.id).unwrap();
    let (reopened, outcome) = backup::restore(Some(damaged), &source, &backups, &dir, NOON + DAY);
    outcome.unwrap();
    let db = reopened.expect("the restored file is open");
    assert_eq!(count(&db), 2_000);
    db.close().unwrap();
    let aside: Vec<_> = names(&dir)
        .into_iter()
        .filter(|name| name.starts_with("cubehaus-unreadable-"))
        .collect();
    assert_eq!(aside.len(), 1, "{:?}", names(&dir));
    assert_eq!(std::fs::read(dir.join(&aside[0])).unwrap(), bytes);
    assert_eq!(backup::list(&backups).unwrap(), [copy]);
    let _ = std::fs::remove_dir_all(dir);
}

/// Run as a child process: takes the app's lock on `CUBEHAUS_CHILD_DIR`, says so, and
/// waits to be killed.
#[test]
#[ignore = "run as a child process by a_second_copy_cannot_open_the_file"]
fn child_holds_the_lock() {
    let Ok(dir) = std::env::var("CUBEHAUS_CHILD_DIR") else {
        return;
    };
    let dir = PathBuf::from(dir);
    let _lock = database::lock(&dir).unwrap();
    std::fs::write(dir.join("child-ready"), b"").unwrap();
    std::thread::sleep(Duration::from_secs(60));
}

/// Two copies of the app (opened twice from the dock, the .deb and the AppImage): only the
/// first holds the data directory. The second is refused before it touches the file, and
/// a copy that crashed holds nothing.
#[test]
fn a_second_copy_cannot_open_the_file() {
    let dir = temp_dir("twice");
    let first = database::lock(&dir).unwrap();
    let refused = database::lock(&dir).expect_err("a second lock is refused");
    assert!(refused.0.contains("already open"), "{}", refused.0);
    drop(first);
    drop(database::lock(&dir).unwrap());

    let mut other = child("child_holds_the_lock", &[("CUBEHAUS_CHILD_DIR", &dir)])
        .spawn()
        .unwrap();
    for _ in 0..200 {
        if dir.join("child-ready").exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(dir.join("child-ready").exists());
    assert!(database::lock(&dir).is_err(), "held by the other process");
    other.kill().unwrap();
    other.wait().unwrap();
    drop(database::lock(&dir).expect("released when that process ended"));
    let _ = std::fs::remove_dir_all(dir);
}

/// Solves keep being written while a slow backup runs: every copy is sound and holds a
/// whole number of commits, and no write is lost or fails.
#[test]
fn a_backup_while_solves_are_written() {
    let dir = temp_dir("inflight");
    let backups = dir.join("Backups");
    let db = Arc::new(seeded(&dir, 500));
    let writer = {
        let db = db.clone();
        std::thread::spawn(move || {
            for i in 0..300 {
                db.batch(vec![
                    statement(
                        "INSERT INTO solve (id, session_id, time_ms) VALUES (?, 'A', ?)",
                        vec![json!(format!("w{i:04}a")), json!(i)],
                    ),
                    statement(
                        "INSERT INTO solve (id, session_id, time_ms) VALUES (?, 'A', ?)",
                        vec![json!(format!("w{i:04}b")), json!(i)],
                    ),
                ])
                .unwrap();
            }
        })
    };
    let slow = Options {
        pages_per_step: 4,
        pause: Duration::from_millis(1),
        room: None,
    };
    // Copies of one day replace each other, so each is checked as it is made.
    for n in 0..4 {
        let copy = backup::create_with(&db, &backups, NOON + n * 1000, &slow).unwrap();
        let file = backup::file_of(&backups, &copy.id).unwrap();
        backup::verify(&file).unwrap();
        let connection = rusqlite::Connection::open(&file).unwrap();
        let written: i64 = connection
            .query_row("SELECT count(*) FROM solve WHERE id LIKE 'w%'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(written % 2, 0, "a commit is in a copy whole or not at all");
    }
    writer.join().unwrap();
    assert_eq!(count(&db), 500 + 600);
    db.close().unwrap();
    let _ = std::fs::remove_dir_all(dir);
}

/// Run as a child process: a file-size limit stands in for a full disk (every write past
/// it fails with EFBIG, as one past the disk's end fails with ENOSPC).
#[cfg(unix)]
#[test]
#[ignore = "run as a child process by a_full_disk_loses_nothing"]
fn child_on_a_full_disk() {
    let (Ok(data), Ok(backups)) = (
        std::env::var("CUBEHAUS_CHILD_DATA"),
        std::env::var("CUBEHAUS_CHILD_BACKUPS"),
    ) else {
        return;
    };
    let (data, backups) = (PathBuf::from(data), PathBuf::from(backups));
    let db = Database::open(&data).unwrap();
    let copy = backup::list(&backups).unwrap()[0].clone();
    // Half the file's size: the file itself can be read but not rewritten past that
    // point, and every new file (a WAL past a few pages, a copy, a kept history) runs out.
    let size = std::fs::metadata(data.join("cubehaus.sqlite3"))
        .unwrap()
        .len();
    assert!(size > 64 * 1024, "{size} bytes");
    // SAFETY: plain libc calls on this process; nothing else runs in it.
    unsafe {
        libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
        let limit = libc::rlimit {
            rlim_cur: size / 2,
            rlim_max: libc::RLIM_INFINITY,
        };
        assert_eq!(libc::setrlimit(libc::RLIMIT_FSIZE, &limit), 0);
    }
    let big = "y".repeat(256 * 1024);
    let mut outcomes = Vec::new();
    outcomes.push(format!(
        "batch:{}",
        db.batch(vec![statement(
            "INSERT INTO solve (id, session_id, time_ms, note) VALUES ('big', 'A', 1, ?)",
            vec![json!(big)],
        )])
        .is_err()
    ));
    outcomes.push(format!("keep:{}", db.keep_source(&big).is_err()));
    outcomes.push(format!(
        "backup:{}",
        backup::create(&db, &backups, NOON + DAY).is_err()
    ));
    let target = data.join("restore-target");
    outcomes.push(format!(
        "restore:{}",
        backup::restore_into(&backup::file_of(&backups, &copy.id).unwrap(), &target).is_err()
    ));
    // The small write still fits and still works.
    outcomes.push(format!(
        "small:{}",
        db.batch(vec![statement(
            "INSERT INTO solve (id, session_id, time_ms) VALUES ('small', 'A', 1)",
            vec![],
        )])
        .is_ok()
    ));
    db.close().unwrap();
    std::fs::write(data.join("child-outcomes"), outcomes.join(" ")).unwrap_or(());
}

/// A full disk: a write fails and is undone, the kept webview history stays whole, a
/// backup or a restore fails without leaving partial files, and nothing already there is
/// lost.
#[cfg(unix)]
#[test]
fn a_full_disk_loses_nothing() {
    let data = temp_dir("full");
    let backups = data.join("Backups");
    let target = data.join("restore-target");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("cubehaus.sqlite3"), b"").unwrap();
    {
        let db = seeded(&data, 600);
        db.keep_source("{\"earlier\":true}").unwrap();
        backup::create(&db, &backups, NOON).unwrap();
        // Everything folded into the main file, so the limit is measured from it.
        db.all("PRAGMA wal_checkpoint(TRUNCATE)", vec![]).unwrap();
        db.close().unwrap();
    }
    let copies = backup::list(&backups).unwrap();
    let status = child(
        "child_on_a_full_disk",
        &[
            ("CUBEHAUS_CHILD_DATA", &data),
            ("CUBEHAUS_CHILD_BACKUPS", &backups),
        ],
    )
    .status()
    .unwrap();
    assert!(status.success());
    let outcomes = std::fs::read_to_string(data.join("child-outcomes")).unwrap();
    assert_eq!(
        outcomes,
        "batch:true keep:true backup:true restore:true small:true"
    );

    let db = Database::open(&data).unwrap();
    assert_eq!(count(&db), 601, "the big write undone, the small one kept");
    assert_eq!(
        db.all("PRAGMA integrity_check", vec![]).unwrap()[0]["integrity_check"],
        json!("ok")
    );
    db.close().unwrap();
    assert_eq!(
        std::fs::read_to_string(data.join("webview-history.json")).unwrap(),
        "{\"earlier\":true}"
    );
    assert_eq!(backup::list(&backups).unwrap(), copies);
    let leftovers: Vec<String> = names(&data)
        .into_iter()
        .chain(names(&backups))
        .chain(names(&target))
        .filter(|name| name.starts_with('.') || name.ends_with(".partial"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    assert_eq!(std::fs::read(target.join("cubehaus.sqlite3")).unwrap(), b"");
    let _ = std::fs::remove_dir_all(data);
}

/// The window opens where the system puts it: no saved position is carried between
/// sessions (no window-state plugin, no x or y in the configuration), so a monitor that
/// was unplugged cannot leave it off screen.
#[test]
fn the_window_is_never_placed_from_a_saved_position() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config: Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("tauri.conf.json")).unwrap())
            .unwrap();
    let windows = config["app"]["windows"].as_array().unwrap();
    assert_eq!(windows.len(), 1);
    let main = windows[0].as_object().unwrap();
    for key in ["x", "y", "fullscreen", "maximized"] {
        assert!(
            !main.get(key).is_some_and(|v| v != &json!(false)),
            "{key} is set"
        );
    }
    let manifest = std::fs::read_to_string(root.join("Cargo.toml")).unwrap();
    assert!(!manifest.contains("window-state"));
}

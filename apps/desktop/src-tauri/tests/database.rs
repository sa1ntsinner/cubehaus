// The native database behind the desktop app: one file in the app's data
// directory, opened by the same numbered migrations as the web, here exercised directly.

use cubehaus_lib::database::{Database, Statement, decode_columns};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::process::Command;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "cubehaus-{name}-{}-{}",
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

/// Run in a separate process by the test below: writes, then the process ends without
/// closing anything, as a quit or a crash would.
#[test]
#[ignore = "run as a child process by native_reopens_same_database"]
fn child_writes() {
    let Ok(dir) = std::env::var("CUBEHAUS_CHILD_DIR") else {
        return;
    };
    let db = Database::open(&PathBuf::from(dir)).unwrap();
    db.batch(vec![
        statement(
            "CREATE TABLE parent (id TEXT PRIMARY KEY) STRICT; \
             CREATE TABLE child (id TEXT PRIMARY KEY, parent TEXT NOT NULL REFERENCES parent(id), raw INTEGER NOT NULL) STRICT",
            vec![],
        ),
        statement("INSERT INTO parent (id) VALUES (?)", vec![json!("A")]),
        statement(
            "INSERT INTO child (id, parent, raw) VALUES (?, ?, ?)",
            vec![json!("b"), json!("A"), json!(12345)],
        ),
    ])
    .unwrap();
    std::process::exit(0);
}

#[test]
fn native_reopens_same_database() {
    let dir = temp_dir("native");
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["child_writes", "--exact", "--ignored", "--quiet"])
        .env("CUBEHAUS_CHILD_DIR", &dir)
        .status()
        .unwrap();
    assert!(status.success());

    let file = dir.join("cubehaus.sqlite3");
    let header = std::fs::read(&file).unwrap();
    assert_eq!(&header[..16], b"SQLite format 3\0");

    let db = Database::open(&dir).unwrap();
    let rows = db
        .all(
            "SELECT id, raw FROM child WHERE parent = ?",
            vec![json!("A")],
        )
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], json!("b"));
    assert_eq!(rows[0]["raw"], json!(12345));
    assert_eq!(
        db.all("PRAGMA foreign_keys", vec![]).unwrap()[0]["foreign_keys"],
        json!(1)
    );
    assert_eq!(
        db.all("PRAGMA integrity_check", vec![]).unwrap()[0]["integrity_check"],
        json!("ok")
    );

    // A bad second statement takes the first one back with it.
    let failed = db.batch(vec![
        statement("INSERT INTO parent (id) VALUES (?)", vec![json!("C")]),
        statement("INSERT INTO nowhere (id) VALUES (?)", vec![json!("D")]),
    ]);
    assert!(failed.is_err());
    assert!(
        db.all("SELECT id FROM parent WHERE id = 'C'", vec![])
            .unwrap()
            .is_empty()
    );
    // Foreign keys hold.
    assert!(
        db.batch(vec![statement(
            "INSERT INTO child (id, parent, raw) VALUES ('x', 'missing', 1)",
            vec![]
        )])
        .is_err()
    );
    // No other file can be attached.
    assert!(
        db.batch(vec![statement(
            &format!(
                "ATTACH DATABASE '{}' AS other",
                dir.join("other.db").display()
            ),
            vec![]
        )])
        .is_err()
    );
    assert!(!dir.join("other.db").exists());

    // A DNF as a column value crosses as +Infinity; rows keep it tagged.
    let payload = db
        .columns(
            "SELECT CASE WHEN id = 'b' THEN 1e999 ELSE 0 END, raw FROM child",
            vec![],
        )
        .unwrap();
    let columns = decode_columns(&payload).unwrap();
    assert_eq!(columns.len(), 2);
    assert_eq!(columns[0], vec![f64::INFINITY]);
    assert_eq!(columns[1], vec![12345.0]);
    assert_eq!(
        db.all("SELECT 1e999 AS dnf", vec![]).unwrap()[0]["dnf"],
        json!({ "$float": "Infinity" })
    );
    // The webview's history, carried once, is also kept whole as a file beside it.
    let kept = db.keep_source("{\"format\":\"cubehaus\"}").unwrap();
    assert_eq!(kept, dir.join("webview-history.json"));
    db.keep_source("{\"format\":\"cubehaus\",\"again\":1}")
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&kept).unwrap(),
        "{\"format\":\"cubehaus\",\"again\":1}"
    );
    let mut names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| !name.starts_with("cubehaus.sqlite3"))
        .collect();
    names.sort();
    assert_eq!(names, ["webview-history.json"]);
    db.close().unwrap();

    // A file that is not a database fails to open and is left as it was.
    let broken = temp_dir("broken");
    std::fs::write(broken.join("cubehaus.sqlite3"), b"not a database at all").unwrap();
    assert!(Database::open(&broken).is_err());
    assert_eq!(
        std::fs::read(broken.join("cubehaus.sqlite3")).unwrap(),
        b"not a database at all"
    );
    let _ = std::fs::remove_dir_all(dir);
    let _ = std::fs::remove_dir_all(broken);
}

/// Typed reads and bulk writes at 100,000 solves (run with --ignored --nocapture).
#[test]
#[ignore = "a measurement, not a check"]
fn bench_native_100k() {
    let dir = temp_dir("bench");
    let db = Database::open(&dir).unwrap();
    db.batch(vec![statement(
        "CREATE TABLE solve (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, time_ms INTEGER NOT NULL, dnf INTEGER NOT NULL) STRICT",
        vec![],
    )])
    .unwrap();
    let rows: Vec<Statement> = (0..100_000)
        .map(|i| {
            statement(
                "INSERT INTO solve (id, started_at, time_ms, dnf) VALUES (?, ?, ?, ?)",
                vec![
                    json!(format!("s{i:06}")),
                    json!(1_700_000_000_000_i64 + i * 60_000),
                    json!(9_000 + (i * 7919) % 8_000),
                    json!(i64::from(i % 50 == 0)),
                ],
            )
        })
        .collect();
    let start = std::time::Instant::now();
    db.batch(rows).unwrap();
    let write = start.elapsed();
    let start = std::time::Instant::now();
    let payload = db
        .columns(
            "SELECT CASE WHEN dnf = 1 THEN 1e999 ELSE time_ms END, started_at FROM solve ORDER BY started_at",
            vec![],
        )
        .unwrap();
    let read = start.elapsed();
    let columns = decode_columns(&payload).unwrap();
    assert_eq!(columns[0].len(), 100_000);
    let start = std::time::Instant::now();
    let page = db
        .all(
            "SELECT * FROM solve ORDER BY started_at DESC LIMIT 200",
            vec![],
        )
        .unwrap();
    let rows_read = start.elapsed();
    assert_eq!(page.len(), 200);
    println!(
        "100k bulk write {write:?}, columns read {read:?} ({} bytes), 200-row page {rows_read:?}",
        payload.len()
    );
    db.close().unwrap();
    let _ = std::fs::remove_dir_all(dir);
}

/// A quit closes the file: what was written is in `cubehaus.sqlite3` itself, with no WAL
/// or shared-memory file left beside it, and it opens again with every row.
#[test]
fn a_closed_database_is_one_file() {
    let dir = temp_dir("closed");
    let db = Database::open(&dir).unwrap();
    db.batch(vec![
        statement("CREATE TABLE t (n INTEGER NOT NULL)", vec![]),
        statement("INSERT INTO t VALUES (?)", vec![json!(1)]),
        statement("INSERT INTO t VALUES (?)", vec![json!(2)]),
    ])
    .unwrap();
    assert!(dir.join("cubehaus.sqlite3-wal").exists());
    db.close().unwrap();
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    assert_eq!(names, ["cubehaus.sqlite3"]);
    let again = Database::open(&dir).unwrap();
    let rows = again.all("SELECT count(*) AS n FROM t", vec![]).unwrap();
    assert_eq!(rows[0]["n"], json!(2));
    again.close().unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
}

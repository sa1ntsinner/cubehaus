//! The solve history as one SQLite file in the app's data directory
//! (`cubehaus.sqlite3`), behind the same four operations the web's database worker
//! offers (`all`, `columns`, `batch`, `close`). The schema is not here: the web code runs
//! the shared numbered migrations through these operations, as it does on OPFS.
//!
//! One connection, used by one thread at a time behind a mutex; callers run it on a
//! blocking thread. Foreign keys on, a bounded busy timeout, WAL journal, no attached
//! databases and no extensions, so SQL from the page cannot reach another file.

use rusqlite::limits::Limit;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags, params_from_iter};
use serde::Deserialize;
use serde_json::{Map, Number, Value, json};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

pub const FILE_NAME: &str = "cubehaus.sqlite3";
/// The webview's history as it was carried into the file (once, on the first start).
pub const SOURCE_NAME: &str = "webview-history.json";
/// Held by the running app for as long as it runs, so a second copy cannot open the file.
pub const LOCK_NAME: &str = "cubehaus.lock";

#[derive(Debug)]
pub struct Error(pub String);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Error {}
impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Error(error.to_string())
    }
}
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// One statement of a batch: SQL and its positional parameters (text, number or null).
#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

/// The app's hold on its data directory: an OS lock on `cubehaus.lock`, released when this
/// is dropped or the process ends in any way (a crash leaves nothing to clean up).
#[derive(Debug)]
pub struct InstanceLock {
    _file: std::fs::File,
}

/// Takes the data directory for this process. A second copy of the app (opened twice,
/// or the same app installed twice) is refused here, before it touches the database:
/// two processes writing, backing up or restoring one file would undo each other.
pub fn lock(dir: &Path) -> Result<InstanceLock> {
    std::fs::create_dir_all(dir).map_err(|e| Error(format!("{}: {e}", dir.display())))?;
    let path = dir.join(LOCK_NAME);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&path)
        .map_err(|e| Error(format!("{}: {e}", path.display())))?;
    match file.try_lock() {
        Ok(()) => Ok(InstanceLock { _file: file }),
        Err(std::fs::TryLockError::WouldBlock) => {
            Err(Error("cubehaus is already open in another window".into()))
        }
        Err(std::fs::TryLockError::Error(e)) => Err(Error(format!("{}: {e}", path.display()))),
    }
}

pub struct Database {
    path: PathBuf,
    connection: Mutex<Option<Connection>>,
}

/// A JSON parameter as SQLite takes it: whole numbers as integers, others as reals.
fn to_sql(value: &Value) -> Result<rusqlite::types::Value> {
    use rusqlite::types::Value as V;
    Ok(match value {
        Value::Null => V::Null,
        Value::String(text) => V::Text(text.clone()),
        Value::Number(number) => match number.as_i64() {
            Some(whole) => V::Integer(whole),
            None => V::Real(number.as_f64().unwrap_or(f64::NAN)),
        },
        Value::Bool(flag) => V::Integer(i64::from(*flag)),
        _ => return Err(Error("A parameter must be text, a number or null".into())),
    })
}

/// A real that JSON cannot carry (a DNF is stored as 1e999, +Infinity) goes tagged.
fn real(value: f64) -> Value {
    match Number::from_f64(value) {
        Some(number) => Value::Number(number),
        None if value.is_nan() => json!({ "$float": "NaN" }),
        None if value > 0.0 => json!({ "$float": "Infinity" }),
        None => json!({ "$float": "-Infinity" }),
    }
}

impl Database {
    /// Opens (or creates) `cubehaus.sqlite3` in `dir`. A file that is there but is not a
    /// database is an error and stays untouched: no second database is made beside it.
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir).map_err(|e| Error(format!("{}: {e}", dir.display())))?;
        let path = dir.join(FILE_NAME);
        let connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        connection.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        // Reading the schema is the first touch of the file: a broken file fails here.
        connection.query_row("SELECT count(*) FROM sqlite_schema", [], |_| Ok(()))?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
        )?;
        Ok(Database {
            path,
            connection: Mutex::new(Some(connection)),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn with<T>(&self, run: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| Error("The database is unavailable".into()))?;
        let connection = guard
            .as_mut()
            .ok_or_else(|| Error("Database is not open".into()))?;
        run(connection)
    }

    /// Rows as objects by column name.
    pub fn all(&self, sql: &str, params: Vec<Value>) -> Result<Vec<Map<String, Value>>> {
        self.with(|connection| {
            let values = params.iter().map(to_sql).collect::<Result<Vec<_>>>()?;
            let mut statement = connection.prepare_cached(sql)?;
            let names: Vec<String> = statement.column_names().map(str::to_string).collect();
            let mut rows = statement.query(params_from_iter(values))?;
            let mut out = Vec::new();
            while let Some(row) = rows.next()? {
                let mut object = Map::with_capacity(names.len());
                for (index, name) in names.iter().enumerate() {
                    let value = match row.get_ref(index)? {
                        ValueRef::Null => Value::Null,
                        ValueRef::Integer(whole) => Value::from(whole),
                        ValueRef::Real(value) => real(value),
                        ValueRef::Text(text) => {
                            Value::String(String::from_utf8_lossy(text).into_owned())
                        }
                        ValueRef::Blob(_) => {
                            return Err(Error("Blobs are not part of the schema".into()));
                        }
                    };
                    object.insert(name.clone(), value);
                }
                out.push(object);
            }
            Ok(out)
        })
    }

    /// Numeric columns as one payload: column count and row count (u32, little-endian),
    /// then each column's values as f64, column after column. Infinity stays Infinity.
    pub fn columns(&self, sql: &str, params: Vec<Value>) -> Result<Vec<u8>> {
        self.with(|connection| {
            let values = params.iter().map(to_sql).collect::<Result<Vec<_>>>()?;
            let mut statement = connection.prepare_cached(sql)?;
            let count = statement.column_count();
            let mut columns: Vec<Vec<f64>> = vec![Vec::new(); count];
            let mut rows = statement.query(params_from_iter(values))?;
            while let Some(row) = rows.next()? {
                for (index, column) in columns.iter_mut().enumerate() {
                    column.push(match row.get_ref(index)? {
                        ValueRef::Integer(whole) => whole as f64,
                        ValueRef::Real(value) => value,
                        _ => return Err(Error("columns requires numeric SQL values".into())),
                    });
                }
            }
            let length = columns.first().map_or(0, Vec::len);
            let mut payload = Vec::with_capacity(8 + count * length * 8);
            payload.extend_from_slice(&(count as u32).to_le_bytes());
            payload.extend_from_slice(&(length as u32).to_le_bytes());
            for column in &columns {
                for value in column {
                    payload.extend_from_slice(&value.to_le_bytes());
                }
            }
            Ok(payload)
        })
    }

    /// All statements in one transaction: every one applies, or none does.
    pub fn batch(&self, statements: Vec<Statement>) -> Result<()> {
        self.with(|connection| {
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            for Statement { sql, params } in &statements {
                if params.is_empty() {
                    transaction.execute_batch(sql)?;
                } else {
                    let values = params.iter().map(to_sql).collect::<Result<Vec<_>>>()?;
                    transaction
                        .prepare_cached(sql)?
                        .execute(params_from_iter(values))?;
                }
            }
            // Dropping an unfinished transaction rolls it back, so an error above undoes all.
            transaction.commit()?;
            Ok(())
        })
    }

    /// Copies the database, WAL commits included, into a new file at `target` through
    /// SQLite's online backup, `pages_per_step` pages at a time with `pause` between steps
    /// (positive). The copy uses a rollback journal, so it is one file.
    pub fn backup_to(&self, target: &Path, pages_per_step: i32, pause: Duration) -> Result<()> {
        self.with(|connection| {
            let mut copy = Connection::open(target)?;
            {
                let backup = rusqlite::backup::Backup::new(connection, &mut copy)?;
                backup.run_to_completion(pages_per_step, pause, None)?;
            }
            copy.execute_batch("PRAGMA journal_mode = DELETE")?;
            copy.close().map_err(|(_, error)| Error::from(error))?;
            Ok(())
        })
    }

    /// Whether the whole file reads as a sound database (SQLite's integrity check). A file
    /// damaged past its first page opens all the same; this is what tells.
    pub fn sound(&self) -> bool {
        self.with(|connection| {
            let found: String =
                connection.query_row("PRAGMA integrity_check(1)", [], |row| row.get(0))?;
            Ok(found == "ok")
        })
        .unwrap_or(false)
    }

    /// Writes `text` as `webview-history.json` beside the database: to a temporary file,
    /// flushed to disk, then renamed over, so the file is always whole or absent.
    pub fn keep_source(&self, text: &str) -> Result<PathBuf> {
        use std::io::Write;
        let dir = self
            .path
            .parent()
            .ok_or_else(|| Error("The database has no directory".into()))?;
        let target = dir.join(SOURCE_NAME);
        let staging = dir.join(format!("{SOURCE_NAME}.partial"));
        let io = |error: std::io::Error| Error(format!("{}: {error}", target.display()));
        let written = (|| {
            let mut file = std::fs::File::create(&staging)?;
            file.write_all(text.as_bytes())?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&staging, &target)
        })();
        if let Err(error) = written {
            // A full disk leaves no half-written file behind to take up what room is left.
            let _ = std::fs::remove_file(&staging);
            return Err(io(error));
        }
        Ok(target)
    }

    pub fn close(&self) -> Result<()> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| Error("The database is unavailable".into()))?;
        if let Some(connection) = guard.take() {
            // Everything in the WAL goes into the file first; closing the last connection
            // then removes the WAL and shared-memory files. A checkpoint that cannot finish
            // loses nothing: the WAL stays and is replayed on the next open.
            let _ = connection.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
            connection
                .close()
                .map_err(|(_, error)| Error::from(error))?;
        }
        Ok(())
    }
}

/// Reads a `columns` payload back (for tests and checks).
pub fn decode_columns(payload: &[u8]) -> Result<Vec<Vec<f64>>> {
    let word = |at: usize| -> Result<usize> {
        payload
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
            .ok_or_else(|| Error("Short payload".into()))
    };
    let (count, length) = (word(0)?, word(4)?);
    if payload.len() != 8 + count * length * 8 {
        return Err(Error("Payload size does not match".into()));
    }
    Ok((0..count)
        .map(|c| {
            (0..length)
                .map(|r| {
                    let at = 8 + (c * length + r) * 8;
                    let mut bytes = [0u8; 8];
                    bytes.copy_from_slice(&payload[at..at + 8]);
                    f64::from_le_bytes(bytes)
                })
                .collect()
        })
        .collect())
}

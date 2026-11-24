//! Automatic backups of `cubehaus.sqlite3`: whole copies of the database in a folder
//! (by default `Backups` in the app's data directory, or one the owner picks), named by
//! their UTC time and a random suffix: `cubehaus-backup-20261122T120000Z-3fa9c1.sqlite3`.
//!
//! A copy is taken through SQLite's online backup from the live connection, so commits
//! still in the WAL are in it; it is checked (integrity, foreign keys, a schema) in the
//! app's data directory, copied to the folder under a dot-name, flushed, and renamed into
//! place: a copy in the folder is whole or absent. Only after that are older copies pruned:
//! one per UTC day, seven days. A failure prunes nothing.

use crate::database::{Database, Error, FILE_NAME, Result};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::hash::BuildHasher;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const PREFIX: &str = "cubehaus-backup-";
const SUFFIX: &str = ".sqlite3";
const STAGING: &str = ".backup-staging-";
const RESTORE_STAGING: &str = ".restore-staging.sqlite3";
const DAY_MS: i64 = 86_400_000;
/// Days with a copy kept, the newest copy of each.
pub const KEEP_DAYS: usize = 7;

#[derive(Debug, Serialize)]
pub enum RestoreError {
    #[serde(rename = "newer_backup_schema")]
    NewerSchema,
    #[serde(untagged)]
    Other(Error),
}

impl From<Error> for RestoreError {
    fn from(error: Error) -> Self {
        Self::Other(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMeta {
    pub id: String,
    /// When the copy was taken, epoch milliseconds (to the second).
    pub created_at: i64,
    pub bytes: u64,
    /// Always `complete`: an incomplete copy is never listed.
    pub status: &'static str,
}

/// How a copy is taken. The defaults are what the app uses; the others serve tests.
#[derive(Debug, Clone)]
pub struct Options {
    /// Pages per step of the online backup (the default: all in one step).
    pub pages_per_step: i32,
    /// Pause between steps.
    pub pause: Duration,
    /// Bytes the folder can still take (`None`: as many as the disk has). A full disk in tests.
    pub room: Option<u64>,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            pages_per_step: i32::MAX,
            pause: Duration::ZERO,
            room: None,
        }
    }
}

fn io(path: &Path) -> impl Fn(std::io::Error) -> Error + '_ {
    move |error| Error(format!("{}: {error}", path.display()))
}

/// Days since 1970-01-01 to a civil date (proleptic Gregorian).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// A civil date to days since 1970-01-01.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year.rem_euclid(400);
    let month = i64::from(month);
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn stamp(ms: i64) -> String {
    let seconds = ms.div_euclid(1000);
    let (year, month, day) = civil(seconds.div_euclid(86_400));
    let rest = seconds.rem_euclid(86_400);
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        rest / 3600,
        rest / 60 % 60,
        rest % 60
    )
}

/// `20261122T120000Z-3fa9c1` back to its time; anything else is not one of ours.
fn parse_id(id: &str) -> Option<i64> {
    let (time, random) = id.split_once('-')?;
    if random.len() != 6 || !random.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let bytes = time.as_bytes();
    if bytes.len() != 16 || bytes[8] != b'T' || bytes[15] != b'Z' {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let text = time.get(range)?;
        text.bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| text.parse().ok())?
    };
    let (year, month, day) = (number(0..4)?, number(4..6)?, number(6..8)?);
    let (hour, minute, second) = (number(9..11)?, number(11..13)?, number(13..15)?);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days = days_from_civil(year, month as u32, day as u32);
    Some((days * 86_400 + hour * 3600 + minute * 60 + second) * 1000)
}

fn file_name(id: &str) -> String {
    format!("{PREFIX}{id}{SUFFIX}")
}

fn new_id(now_ms: i64, dir: &Path) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let state = std::collections::hash_map::RandomState::new();
    loop {
        let random = state.hash_one(COUNTER.fetch_add(1, Ordering::Relaxed)) & 0xff_ffff;
        let id = format!("{}-{random:06x}", stamp(now_ms));
        if !dir.join(file_name(&id)).exists() {
            return id;
        }
    }
}

fn meta(dir: &Path, id: &str) -> Result<BackupMeta> {
    let path = dir.join(file_name(id));
    let created_at = parse_id(id).ok_or_else(|| Error(format!("Not a backup: {id}")))?;
    Ok(BackupMeta {
        id: id.to_string(),
        created_at,
        bytes: std::fs::metadata(&path).map_err(io(&path))?.len(),
        status: "complete",
    })
}

/// The copies in `dir`, newest first. A missing folder holds none.
pub fn list(dir: &Path) -> Result<Vec<BackupMeta>> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io(dir)(error)),
    };
    let mut out = Vec::new();
    for entry in entries {
        let name = entry.map_err(io(dir))?.file_name();
        let Some(id) = name
            .to_str()
            .and_then(|name| name.strip_prefix(PREFIX))
            .and_then(|name| name.strip_suffix(SUFFIX))
        else {
            continue;
        };
        if parse_id(id).is_some() {
            out.push(meta(dir, id)?);
        }
    }
    out.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.id.cmp(&a.id))
    });
    Ok(out)
}

/// The file of copy `id` in `dir`; an ID that is not one of ours is refused.
pub fn file_of(dir: &Path, id: &str) -> Result<PathBuf> {
    parse_id(id).ok_or_else(|| Error(format!("Not a backup: {id}")))?;
    let path = dir.join(file_name(id));
    if path.is_file() {
        Ok(path)
    } else {
        Err(Error(format!("No backup {id}")))
    }
}

/// A copy is sound: it opens, passes the integrity and foreign key checks, has a schema.
pub fn verify(path: &Path) -> Result<()> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(Error(format!("{}: {integrity}", path.display())));
    }
    let broken: i64 =
        connection.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    if broken > 0 {
        return Err(Error(format!(
            "{}: {broken} broken references",
            path.display()
        )));
    }
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        return Err(Error(format!("{}: no schema", path.display())));
    }
    Ok(())
}

fn sync_dir(dir: &Path) -> Result<()> {
    std::fs::File::open(dir)
        .and_then(|file| file.sync_all())
        .map_err(io(dir))
}

/// Copies `from` to `to` and flushes it, refusing past `room` bytes as a full disk would.
fn copy_flushed(from: &Path, to: &Path, room: Option<u64>) -> Result<()> {
    let bytes = std::fs::read(from).map_err(io(from))?;
    write_flushed(&bytes, to, room)
}

fn write_flushed(bytes: &[u8], to: &Path, room: Option<u64>) -> Result<()> {
    let mut file = std::fs::File::create(to).map_err(io(to))?;
    match room {
        Some(room) if (bytes.len() as u64) > room => {
            file.write_all(&bytes[..room as usize]).map_err(io(to))?;
            return Err(io(to)(std::io::Error::from(
                std::io::ErrorKind::StorageFull,
            )));
        }
        _ => file.write_all(bytes).map_err(io(to))?,
    }
    file.sync_all().map_err(io(to))
}

/// Leftovers of copies that never finished (a quit, a crash) in either folder.
fn clear_leftovers(data_dir: &Path, dir: &Path) {
    for (folder, prefix) in [(data_dir, STAGING.to_string()), (dir, format!(".{PREFIX}"))] {
        if let Ok(entries) = std::fs::read_dir(folder) {
            for entry in entries.flatten() {
                if entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with(&prefix))
                {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

pub fn create(db: &Database, dir: &Path, now_ms: i64) -> Result<BackupMeta> {
    create_with(db, dir, now_ms, &Options::default())
}

pub fn create_with(
    db: &Database,
    dir: &Path,
    now_ms: i64,
    options: &Options,
) -> Result<BackupMeta> {
    let data_dir = db
        .path()
        .parent()
        .ok_or_else(|| Error("The database has no directory".into()))?
        .to_path_buf();
    clear_leftovers(&data_dir, dir);
    std::fs::create_dir_all(dir).map_err(io(dir))?;
    let id = new_id(now_ms, dir);
    let name = file_name(&id);
    let local = data_dir.join(format!("{STAGING}{name}"));
    let partial = dir.join(format!(".{name}"));
    let published = (|| {
        db.backup_to(&local, options.pages_per_step, options.pause)?;
        verify(&local)?;
        copy_flushed(&local, &partial, options.room)?;
        std::fs::rename(&partial, dir.join(&name)).map_err(io(dir))?;
        sync_dir(dir)
    })();
    let _ = std::fs::remove_file(&local);
    if let Err(error) = published {
        let _ = std::fs::remove_file(&partial);
        return Err(error);
    }
    let made = meta(dir, &id)?;
    // A failed prune leaves extra copies, never fewer.
    let _ = rotate(dir, &made);
    Ok(made)
}

/// Keeps the newest copy of each of the last seven days that have one; the copy just
/// made (checked) replaces any earlier one of its day.
fn rotate(dir: &Path, newest: &BackupMeta) -> Result<()> {
    let day = |ms: i64| ms.div_euclid(DAY_MS);
    let mut days = vec![day(newest.created_at)];
    for copy in list(dir)? {
        if copy.id == newest.id {
            continue;
        }
        let this = day(copy.created_at);
        let keep = if days.contains(&this) {
            false
        } else if days.len() < KEEP_DAYS && this < day(newest.created_at) {
            days.push(this);
            true
        } else {
            // Older than the seven days, or (a clock set back) later than the newest.
            this > day(newest.created_at)
        };
        if !keep {
            let path = dir.join(file_name(&copy.id));
            std::fs::remove_file(&path).map_err(io(&path))?;
        }
    }
    Ok(())
}

/// Puts the copy at `file` in place of `data_dir/cubehaus.sqlite3`, after checking it.
/// Every connection to the file there must be closed; its WAL and shared-memory files,
/// which belong to the file being replaced, are removed. A copy that fails its check
/// changes nothing.
pub fn restore_into(file: &Path, data_dir: &Path) -> std::result::Result<(), RestoreError> {
    let source = RestoreSource::read(file)?;
    Ok(source.stage(data_dir)?.install(data_dir)?)
}

pub(crate) struct RestoreSource(Vec<u8>);

impl RestoreSource {
    pub(crate) fn read(file: &Path) -> std::result::Result<Self, RestoreError> {
        let bytes = std::fs::read(file).map_err(io(file))?;
        let supported: i32 = env!("CUBEHAUS_SCHEMA_VERSION")
            .parse()
            .expect("schema version validated at build time");
        // SQLite stores PRAGMA user_version at byte 60. Backups are standalone files.
        // Check the exact bytes that will be staged, without opening or writing any database.
        if bytes.starts_with(b"SQLite format 3\0")
            && let Some(version) = bytes.get(60..64).and_then(|bytes| bytes.try_into().ok())
            && i32::from_be_bytes(version) > supported
        {
            return Err(RestoreError::NewerSchema);
        }
        Ok(Self(bytes))
    }

    fn stage(self, data_dir: &Path) -> Result<StagedRestore> {
        std::fs::create_dir_all(data_dir).map_err(io(data_dir))?;
        let staging = StagedRestore(data_dir.join(RESTORE_STAGING));
        write_flushed(&self.0, &staging.0, None)?;
        verify(&staging.0)?;
        Ok(staging)
    }
}

struct StagedRestore(PathBuf);

impl Drop for StagedRestore {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

impl StagedRestore {
    fn install(self, data_dir: &Path) -> Result<()> {
        let target = data_dir.join(FILE_NAME);
        for sidecar in ["-wal", "-shm"] {
            let path = data_dir.join(format!("{FILE_NAME}{sidecar}"));
            match std::fs::remove_file(&path) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(io(&path)(error));
                }
                _ => {}
            }
        }
        std::fs::rename(&self.0, &target).map_err(io(&target))?;
        sync_dir(data_dir)
    }
}

/// Moves a `cubehaus.sqlite3` that does not open (with its WAL and shared-memory files)
/// aside as `cubehaus-unreadable-<time>.sqlite3` in the same folder. It is never deleted:
/// whatever can still be read from it stays the owner's.
fn set_aside(data_dir: &Path, now_ms: i64) -> Result<()> {
    let target = data_dir.join(FILE_NAME);
    let aside = |sidecar: &str| {
        data_dir.join(format!(
            "cubehaus-unreadable-{}{SUFFIX}{sidecar}",
            new_id(now_ms, data_dir)
        ))
    };
    let main = aside("");
    for sidecar in ["-wal", "-shm"] {
        let path = data_dir.join(format!("{FILE_NAME}{sidecar}"));
        if path.exists() {
            let to = PathBuf::from(format!("{}{sidecar}", main.display()));
            std::fs::rename(&path, &to).map_err(io(&path))?;
        }
    }
    if target.exists() {
        std::fs::rename(&target, &main).map_err(io(&target))?;
    }
    sync_dir(data_dir)
}

/// Puts the copy at `file` in place of the database in `data_dir`, and returns the
/// database to use from now on with the outcome.
///
/// `current` is the open database, if there is one: it is copied into `backup_dir` first
/// (without that copy nothing is replaced, and `current` comes back as it was), then
/// closed. If none is open and the file there does not open either, or it is open but
/// fails its integrity check (the cases backups exist for), the broken file is set aside
/// instead of copied, and the copy put in its place.
pub fn restore(
    current: Option<Arc<Database>>,
    file: &Path,
    backup_dir: &Path,
    data_dir: &Path,
    now_ms: i64,
) -> (Option<Arc<Database>>, std::result::Result<(), RestoreError>) {
    match RestoreSource::read(file) {
        Ok(source) => restore_checked(current, source, backup_dir, data_dir, now_ms),
        Err(error) => (current, Err(error)),
    }
}

pub(crate) fn restore_checked(
    current: Option<Arc<Database>>,
    source: RestoreSource,
    backup_dir: &Path,
    data_dir: &Path,
    now_ms: i64,
) -> (Option<Arc<Database>>, std::result::Result<(), RestoreError>) {
    let staging = match source.stage(data_dir) {
        Ok(staging) => staging,
        Err(error) => return (current, Err(error.into())),
    };
    let current = match current {
        Some(db) => Some(db),
        None => Database::open(data_dir).ok().map(Arc::new),
    };
    match current {
        Some(db) if db.sound() => {
            if let Err(error) = create(&db, backup_dir, now_ms) {
                return (Some(db), Err(error.into()));
            }
            if let Err(error) = db.close() {
                return (Some(db), Err(error.into()));
            }
        }
        // It opens but is damaged further in: no sound copy of it can be made, so it is
        // kept whole beside the restored file instead, like one that does not open.
        Some(db) => {
            if let Err(error) = db.close() {
                return (Some(db), Err(error.into()));
            }
            if let Err(error) = set_aside(data_dir, now_ms) {
                let reopened = Database::open(data_dir).ok().map(Arc::new);
                return (reopened, Err(error.into()));
            }
        }
        None => {
            if let Err(error) = set_aside(data_dir, now_ms) {
                return (None, Err(error.into()));
            }
        }
    }
    let restored = staging.install(data_dir).map_err(RestoreError::from);
    match Database::open(data_dir) {
        Ok(db) => (Some(Arc::new(db)), restored),
        Err(error) => (None, restored.and(Err(error.into()))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        // 2026-11-22T12:00:00Z
        let noon = 1_795_348_800_000;
        assert_eq!(stamp(noon), "20261122T120000Z");
        assert_eq!(parse_id("20261122T120000Z-0a1b2c"), Some(noon));
        assert_eq!(stamp(0), "19700101T000000Z");
        assert_eq!(parse_id("20240229T235959Z-ffffff"), Some(1_709_251_199_000));
        for bad in [
            "",
            "20261122T120000Z",
            "20261122T120000Z-xyz123",
            "../x-000000",
            "20261322T120000Z-000000",
        ] {
            assert_eq!(parse_id(bad), None, "{bad}");
        }
    }
}

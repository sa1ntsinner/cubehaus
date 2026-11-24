// Updates of the desktop app. The app carries the updater's public key and
// the address of its manifest in `plugins.updater` of `tauri.conf.json` (the key that signs
// releases stays with the owner). Without both the updater is off:
// the plugin is not loaded and nothing is ever fetched.
//
// A manifest that cannot be had (no release published yet, so the address answers 404; no
// network; a page in its place) is the same as no newer release: nothing is said and the
// running version goes on. Only a release that is there and fails its checks is an error.
//
// With them, a newer release is fetched in the background and checked against the key
// (the plugin verifies the signature over the final bytes, and the version the signature
// names), then kept in memory. It is installed only when the page says the timer is idle
// with nothing left to write, and the native side agrees: no command is using the
// database. The database then leaves the shared state (every other command fails and the
// page keeps solves in its journal), a backup is taken, the file is closed, and the
// package is installed once. Any failure on the way puts the database back as it was.

use crate::backup;
use crate::database::{Database, Error};
use serde_json::Value;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How long the manifest may take. The plugin's default is no limit at all, so a request
/// that is never answered (a captive portal, a dropped route) would wait for ever.
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
/// How long the package may take: an installer of a hundred megabytes on a slow line.
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// The app's updater: its configured endpoints, with `check` as the limit of the check.
pub fn bounded(
    builder: tauri_plugin_updater::UpdaterBuilder,
    check: Duration,
) -> tauri_plugin_updater::UpdaterBuilder {
    builder.timeout(check)
}

/// What `apply_update_when_idle` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateState {
    /// An update is downloaded and waits for an idle moment.
    Waiting,
    /// The update was installed; the app relaunches.
    Applied,
    /// Nothing to install.
    Current,
}

/// The updater's settings (`plugins.updater`) as a release build was given them, or None:
/// then it is off. Both a public key and at least one endpoint are needed, every endpoint
/// over HTTPS, and none of the plugin's `dangerous…` switches may be on.
///
/// A build with the `update-rehearsal` feature (never a release)
/// also takes plain HTTP from this machine (`http://127.0.0.1:<port>/…`) and the one
/// switch that allows it, so the whole update can be tried against a local server.
pub fn configured(updater: Option<&Value>) -> Option<Value> {
    const LOOPBACK: &str = "http://127.0.0.1:";
    let rehearsal = cfg!(feature = "update-rehearsal");
    let updater = updater?.as_object()?;
    let pubkey = updater.get("pubkey")?.as_str()?.trim();
    let endpoints = updater.get("endpoints")?.as_array()?;
    let https = |endpoint: &Value| {
        endpoint.as_str().is_some_and(|url| {
            (url.starts_with("https://") && url.len() > "https://".len())
                || (rehearsal && url.starts_with(LOOPBACK) && url.len() > LOOPBACK.len())
        })
    };
    let dangerous = updater.iter().any(|(name, value)| {
        name.starts_with("dangerous")
            && value != &Value::Bool(false)
            && !(rehearsal && name == "dangerousInsecureTransportProtocol")
    });
    (!pubkey.is_empty() && !endpoints.is_empty() && endpoints.iter().all(https) && !dangerous)
        .then(|| Value::Object(updater.clone()))
}

/// Installs a verified package. The app's is the plugin's `Update` (which verifies the
/// bytes once more); tests count.
pub trait Installer: Send {
    fn install(&self, bytes: &[u8]) -> Result<(), Error>;
}

impl Installer for tauri_plugin_updater::Update {
    fn install(&self, bytes: &[u8]) -> Result<(), Error> {
        tauri_plugin_updater::Update::install(self, bytes).map_err(|error| Error(error.to_string()))
    }
}

/// A newer release, downloaded and verified, waiting to be installed.
pub struct Downloaded {
    pub version: String,
    pub bytes: Vec<u8>,
    pub installer: Box<dyn Installer>,
}

/// Checks the configured endpoints and downloads a newer release. None when there is no
/// newer release (or `updater` is None: the updater is off and nothing is fetched).
/// The download is verified against the key before it is returned.
pub async fn fetch(
    updater: Option<&tauri_plugin_updater::Updater>,
) -> Result<Option<Downloaded>, Error> {
    let Some(updater) = updater else {
        return Ok(None);
    };
    let err = |error: tauri_plugin_updater::Error| Error(error.to_string());
    let mut update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return Ok(None),
        Err(error) if unreachable(&error) => return Ok(None),
        Err(error) => return Err(err(error)),
    };
    // The check's limit is too short for the package; a stalled download still ends.
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(bytes) => bytes,
        Err(error) if unreachable(&error) => return Ok(None),
        Err(error) => return Err(err(error)),
    };
    Ok(Some(Downloaded {
        version: update.version.clone(),
        bytes,
        installer: Box::new(update),
    }))
}

/// Whether `error` only says the release could not be reached: no manifest at the address
/// (a 404 before the first release), no network, a body that is not a manifest, a download
/// cut off. These are quiet; the next check tries again. A signature, key, version or
/// platform that does not match is not among them.
pub fn unreachable(error: &tauri_plugin_updater::Error) -> bool {
    use tauri_plugin_updater::Error as E;
    matches!(
        error,
        E::ReleaseNotFound | E::Reqwest(_) | E::Network(_) | E::Serialization(_) | E::Io(_)
    )
}

/// Installs the downloaded update if `ready` (the page: the timer idle, no inspection, no
/// edit open, no solve waiting to be written) and no command holds the database. The
/// database leaves `slot` for the install; a backup of it goes to `backup_dir` first. On any
/// failure the database is reopened into `slot` and the error returned; the update is
/// dropped then, so a broken package is never tried twice.
pub fn apply_when_idle(
    ready: bool,
    pending: &Mutex<Option<Downloaded>>,
    slot: &Mutex<Option<Arc<Database>>>,
    data_dir: &Path,
    backup_dir: &Path,
    now_ms: i64,
) -> Result<UpdateState, Error> {
    let unavailable = || Error("The update is unavailable".into());
    let mut pending = pending.lock().map_err(|_| unavailable())?;
    if pending.is_none() {
        return Ok(UpdateState::Current);
    }
    if !ready {
        return Ok(UpdateState::Waiting);
    }
    // The write barrier: the database leaves the shared state only when nothing else holds
    // it (a command in flight keeps a clone of the Arc).
    let db = {
        let mut slot = slot.lock().map_err(|_| unavailable())?;
        match slot.take() {
            Some(db) if Arc::strong_count(&db) == 1 => db,
            other => {
                *slot = other;
                return Ok(UpdateState::Waiting);
            }
        }
    };
    let restore = |db: Option<Arc<Database>>| -> Result<(), Error> {
        let db = match db {
            Some(db) => db,
            None => Arc::new(Database::open(data_dir)?),
        };
        *slot.lock().map_err(|_| unavailable())? = Some(db);
        Ok(())
    };
    if let Err(error) = backup::create(&db, backup_dir, now_ms) {
        restore(Some(db))?;
        return Err(error);
    }
    if let Err(error) = db.close() {
        restore(Some(db))?;
        return Err(error);
    }
    drop(db);
    let Some(update) = pending.take() else {
        restore(None)?;
        return Ok(UpdateState::Current);
    };
    match update.installer.install(&update.bytes) {
        Ok(()) => Ok(UpdateState::Applied),
        Err(error) => {
            restore(None)?;
            Err(error)
        }
    }
}

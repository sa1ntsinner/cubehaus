// The desktop app is the web build in a window. Native parts, each with its reason:
// the solve history as a file in the app's data directory (database.rs), so it does
// not live in the webview's storage; whole copies of that file, kept a week
// (backup.rs), so a broken disk or a bad restore loses at most a day; signed updates,
// installed only while the timer is idle and off unless a release build is given a key
// (update.rs); on a Mac, the widgets' snapshot and a widget's link (widgets.rs).
pub mod backup;
pub mod database;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod download;
#[cfg(target_os = "macos")]
mod menu;
pub mod update;
pub mod widgets;

use backup::{BackupMeta, RestoreError, RestoreSource};
use database::{Database, Error, InstanceLock, Statement};
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Native {
    /// This process's hold on the data directory, taken before the file is first opened
    /// and kept until the app ends (database::lock).
    instance: Mutex<Option<InstanceLock>>,
    database: Mutex<Option<Arc<Database>>>,
    /// One backup or restore at a time, held on the blocking thread that does it.
    backups: Arc<Mutex<()>>,
    /// Whether this build carries an updater key (update::configured); else it is off.
    updater: bool,
    /// A newer release, downloaded and verified, waiting for an idle moment.
    update: Arc<Mutex<Option<update::Downloaded>>>,
    /// A widget's link that came while the page was loading, for when it has loaded.
    route: Mutex<Option<String>>,
    /// Whether the page has finished loading (so a route can be set on it now).
    loaded: AtomicBool,
}

/// Where the owner's choice of backup folder is kept (one line: the path).
const FOLDER_FILE: &str = "backup-folder.txt";

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, Error> {
    app.path()
        .app_data_dir()
        .map_err(|error| Error(error.to_string()))
}

/// The folder the owner picked, else `Backups` in the app's data directory.
fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, Error> {
    let data = data_dir(app)?;
    Ok(std::fs::read_to_string(data.join(FOLDER_FILE))
        .ok()
        .map(|text| PathBuf::from(text.trim_end_matches('\n')))
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| data.join("Backups")))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

/// Only the app's own page in the main window may touch the database.
fn trusted(window: &WebviewWindow) -> Result<(), Error> {
    let local = window.url().is_ok_and(|url| {
        matches!(url.scheme(), "tauri")
            || matches!(url.host_str(), Some("tauri.localhost"))
            || (cfg!(debug_assertions) && matches!(url.host_str(), Some("localhost" | "127.0.0.1")))
    });
    if window.label() == "main" && local {
        Ok(())
    } else {
        Err(Error("Not allowed from this page".into()))
    }
}

fn open_database(state: &State<'_, Native>) -> Result<Arc<Database>, Error> {
    state
        .database
        .lock()
        .map_err(|_| Error("The database is unavailable".into()))?
        .clone()
        .ok_or_else(|| Error("Database is not open".into()))
}

async fn blocking<T: Send + 'static>(
    run: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, Error> {
    tauri::async_runtime::spawn_blocking(run)
        .await
        .map_err(|error| Error(error.to_string()))?
}

/// Takes the data directory for this process, once; a second copy of the app is refused.
async fn hold_data_dir(dir: PathBuf, state: &State<'_, Native>) -> Result<(), Error> {
    let held = state
        .instance
        .lock()
        .map_err(|_| Error("The database is unavailable".into()))?
        .is_some();
    if held {
        return Ok(());
    }
    // A relaunch after an update can start while the old process is still ending: its
    // hold is let go just before, so a short wait covers the overlap.
    let lock = blocking(move || {
        let mut tries = 0;
        loop {
            match database::lock(&dir) {
                Err(_) if tries < 20 => {
                    tries += 1;
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                held => return held,
            }
        }
    })
    .await?;
    let mut slot = state
        .instance
        .lock()
        .map_err(|_| Error("The database is unavailable".into()))?;
    slot.get_or_insert(lock);
    Ok(())
}

/// Opens the file once; later calls return the same file's path.
#[tauri::command]
async fn db_open(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, Native>,
) -> Result<String, Error> {
    trusted(&window)?;
    if let Ok(db) = open_database(&state) {
        return Ok(db.path().display().to_string());
    }
    let dir = data_dir(&app)?;
    hold_data_dir(dir.clone(), &state).await?;
    let db = Arc::new(blocking(move || Database::open(&dir)).await?);
    let path = db.path().display().to_string();
    *state
        .database
        .lock()
        .map_err(|_| Error("The database is unavailable".into()))? = Some(db);
    Ok(path)
}

#[tauri::command]
async fn db_all(
    window: WebviewWindow,
    state: State<'_, Native>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, Error> {
    trusted(&window)?;
    let db = open_database(&state)?;
    blocking(move || db.all(&sql, params)).await
}

#[tauri::command]
async fn db_columns(
    window: WebviewWindow,
    state: State<'_, Native>,
    sql: String,
    params: Vec<Value>,
) -> Result<tauri::ipc::Response, Error> {
    trusted(&window)?;
    let db = open_database(&state)?;
    let payload = blocking(move || db.columns(&sql, params)).await?;
    Ok(tauri::ipc::Response::new(payload))
}

#[tauri::command]
async fn db_batch(
    window: WebviewWindow,
    state: State<'_, Native>,
    statements: Vec<Statement>,
) -> Result<(), Error> {
    trusted(&window)?;
    let db = open_database(&state)?;
    blocking(move || db.batch(statements)).await
}

/// Keeps the webview's history, carried into the file, as a backup file beside it.
#[tauri::command]
async fn db_keep_source(
    window: WebviewWindow,
    state: State<'_, Native>,
    text: String,
) -> Result<String, Error> {
    trusted(&window)?;
    let db = open_database(&state)?;
    blocking(move || db.keep_source(&text).map(|path| path.display().to_string())).await
}

#[tauri::command]
async fn db_close(window: WebviewWindow, state: State<'_, Native>) -> Result<(), Error> {
    trusted(&window)?;
    let db = state
        .database
        .lock()
        .map_err(|_| Error("The database is unavailable".into()))?
        .take();
    match db {
        Some(db) => blocking(move || db.close()).await,
        None => Ok(()),
    }
}

/// A copy of the database now, into the backup folder.
#[tauri::command]
async fn backup_now(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, Native>,
) -> Result<BackupMeta, Error> {
    trusted(&window)?;
    let db = open_database(&state)?;
    let dir = backup_dir(&app)?;
    let gate = state.backups.clone();
    blocking(move || {
        let _one = gate
            .lock()
            .map_err(|_| Error("Backups are unavailable".into()))?;
        backup::create(&db, &dir, now_ms())
    })
    .await
}

/// The copies in the backup folder, newest first.
#[tauri::command]
async fn list_backups(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<Vec<BackupMeta>, Error> {
    trusted(&window)?;
    let dir = backup_dir(&app)?;
    blocking(move || backup::list(&dir)).await
}

/// Where the copies go.
#[tauri::command]
async fn backup_folder(app: tauri::AppHandle, window: WebviewWindow) -> Result<String, Error> {
    trusted(&window)?;
    Ok(backup_dir(&app)?.display().to_string())
}

/// Puts copy `id` in place of the database: the current file is copied first (or, when it
/// does not open at all, set aside), every command waits meanwhile (the database is out of
/// the state), the connection closes so its WAL is folded in, the checked copy replaces
/// the file, and the file opens again (backup::restore). The page reloads after it, so its
/// journal replays anything timed meanwhile.
#[tauri::command]
async fn restore_backup(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, Native>,
    id: String,
) -> Result<(), RestoreError> {
    trusted(&window)?;
    let dir = backup_dir(&app)?;
    let data = data_dir(&app)?;
    let file = backup::file_of(&dir, &id)?;
    let source = blocking(move || Ok(RestoreSource::read(&file))).await??;
    hold_data_dir(data.clone(), &state).await?;
    let gate = state.backups.clone();
    let current = state
        .database
        .lock()
        .map_err(|_| Error("The database is unavailable".into()))?
        .take();
    let (db, restored) = blocking(move || {
        let _one = gate
            .lock()
            .map_err(|_| Error("Backups are unavailable".into()))?;
        Ok(backup::restore_checked(
            current,
            source,
            &dir,
            &data,
            now_ms(),
        ))
    })
    .await?;
    *state
        .database
        .lock()
        .map_err(|_| Error("The database is unavailable".into()))? = db;
    restored
}

/// The native folder picker; the folder chosen is where copies go from now on.
#[tauri::command]
async fn choose_backup_directory(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<Option<PathBuf>, Error> {
    trusted(&window)?;
    let data = data_dir(&app)?;
    let start = backup_dir(&app)?;
    blocking(move || {
        let Some(picked) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_directory(&start)
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let folder = picked
            .into_path()
            .map_err(|error| Error(error.to_string()))?;
        std::fs::create_dir_all(&data).map_err(|error| Error(error.to_string()))?;
        let staging = data.join(format!("{FOLDER_FILE}.partial"));
        std::fs::write(&staging, folder.display().to_string())
            .and_then(|()| std::fs::rename(&staging, data.join(FOLDER_FILE)))
            .map_err(|error| Error(error.to_string()))?;
        Ok(Some(folder))
    })
    .await
}

/// Looks for a newer release and downloads it (verified against the build's key); its
/// version, or None. Off (None at once, nothing fetched) without a configured key.
#[tauri::command]
async fn check_update(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, Native>,
) -> Result<Option<String>, Error> {
    trusted(&window)?;
    if !state.updater {
        return Ok(None);
    }
    if let Some(waiting) = state
        .update
        .lock()
        .map_err(|_| Error("The update is unavailable".into()))?
        .as_ref()
    {
        return Ok(Some(waiting.version.clone()));
    }
    use tauri_plugin_updater::UpdaterExt;
    let updater = update::bounded(app.updater_builder(), update::CHECK_TIMEOUT)
        .build()
        .map_err(|error| Error(error.to_string()))?;
    let Some(downloaded) = update::fetch(Some(&updater)).await? else {
        return Ok(None);
    };
    let version = downloaded.version.clone();
    *state
        .update
        .lock()
        .map_err(|_| Error("The update is unavailable".into()))? = Some(downloaded);
    Ok(Some(version))
}

/// Installs the waiting update when `ready` (the page's word that the timer is idle and
/// nothing is left to write) and no command is using the database; the app then
/// relaunches. See update::apply_when_idle.
#[tauri::command]
async fn apply_update_when_idle(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, Native>,
    ready: bool,
) -> Result<update::UpdateState, Error> {
    trusted(&window)?;
    if !state.updater {
        return Ok(update::UpdateState::Current);
    }
    let data = data_dir(&app)?;
    let dir = backup_dir(&app)?;
    let pending = state.update.clone();
    let gate = state.backups.clone();
    // The database slot is borrowed on the blocking thread through the app's state.
    let handle = app.clone();
    let applied = blocking(move || {
        let _one = gate
            .lock()
            .map_err(|_| Error("Backups are unavailable".into()))?;
        let native = handle.state::<Native>();
        update::apply_when_idle(ready, &pending, &native.database, &data, &dir, now_ms())
    })
    .await?;
    if applied == update::UpdateState::Applied {
        // The file is closed; the new process takes the data directory as it starts.
        if let Ok(mut instance) = state.instance.lock() {
            instance.take();
        }
        app.restart();
    }
    Ok(applied)
}

/// The page's snapshot for the Mac widgets: written where they read it, then redrawn.
#[tauri::command]
async fn widget_snapshot(window: WebviewWindow, json: String) -> Result<(), Error> {
    trusted(&window)?;
    blocking(move || widgets::publish(&json)).await
}

/// Sets the page's route (one widgets::drill_route made, so plain characters only) and
/// brings the window forward; kept until the page has loaded when it has not yet.
#[cfg(target_os = "macos")]
fn open_route(app: &tauri::AppHandle, route: String) {
    // At a launch by the link the window may not exist yet.
    let native = app.state::<Native>();
    let window = app.get_webview_window("main");
    match &window {
        Some(window) if native.loaded.load(Ordering::SeqCst) => {
            let _ = window.eval(format!("location.hash = {route:?}"));
        }
        _ => {
            if let Ok(mut pending) = native.route.lock() {
                *pending = Some(route);
            }
        }
    }
    let Some(window) = window else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let updater = update::configured(context.config().plugins.0.get("updater")).is_some();
    // A second launch hands over to the running copy (its window comes to the front) and
    // ends; database::lock refuses it as well should that hand-over fail.
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        // Size, place, maximised and full screen; not visibility or decorations.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        );
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .menu(|app| menu::build(app))
            .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()));
    }
    if updater {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("tauri.conf.json has no window")?
                .clone();
            let window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
                .on_page_load(|webview, payload| {
                    let native = webview.state::<Native>();
                    let finished = payload.event() == tauri::webview::PageLoadEvent::Finished;
                    native.loaded.store(finished, Ordering::SeqCst);
                    if !finished {
                        return;
                    }
                    let pending = native.route.lock().ok().and_then(|mut slot| slot.take());
                    if let Some(route) = pending {
                        let _ = webview.eval(format!("location.hash = {route:?}"));
                    }
                });
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            let window = {
                let downloads = download::Downloads::default();
                window.on_download(move |webview, event| downloads.handle(webview, event))
            };
            window.build()?;
            Ok(())
        })
        .manage(Native {
            updater,
            ..Native::default()
        })
        .invoke_handler(tauri::generate_handler![
            db_open,
            db_all,
            db_columns,
            db_batch,
            db_keep_source,
            db_close,
            backup_now,
            list_backups,
            backup_folder,
            restore_backup,
            choose_backup_directory,
            check_update,
            apply_update_when_idle,
            widget_snapshot
        ])
        .build(context)
        .expect("error while running cubehaus")
        .run(|app, event| {
            // A widget's link (Drill), at launch or while running.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                if let Some(route) = urls
                    .iter()
                    .find_map(|url| widgets::drill_route(url.as_str()))
                {
                    open_route(app, route);
                }
            }
            // A quit folds the WAL into the file and closes it, so the history is one file
            // again (what a copy by hand or a sync tool expects). A crash or a kill skips
            // this; SQLite then replays the WAL on the next start.
            if let tauri::RunEvent::Exit = event {
                let open = app
                    .state::<Native>()
                    .database
                    .lock()
                    .ok()
                    .and_then(|mut slot| slot.take());
                if let Some(db) = open {
                    let _ = db.close();
                }
            }
        });
}

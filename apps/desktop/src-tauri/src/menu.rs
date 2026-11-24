// The macOS menu bar. Tauri's default menu has no Settings item and an About panel with
// only the name and version; this one adds Settings (Cmd+,) and puts the licence and the
// source address in the About panel. Edit keeps the standard items, so Cmd+C, Cmd+V and
// Cmd+Z work in text fields; Window is the system's window list. Windows and Linux get no
// menu bar: the page has its own way to Settings.

use tauri::menu::{
    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Manager, Runtime};

/// The id of the Settings item.
pub const SETTINGS: &str = "settings";

/// Where the source is.
pub const SOURCE: &str = "https://github.com/sa1ntsinner/cubehaus";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        // Empty: the panel shows the version once, not "0.0.5 (0.0.5)" with the build.
        short_version: Some(String::new()),
        // The small grey lines under the version; credits would be a large text block.
        copyright: Some(format!("Licensed under the Mozilla Public License 2.0\n{SOURCE}")),
        ..Default::default()
    };
    let separator = || PredefinedMenuItem::separator(app);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &separator()?,
                    &MenuItem::with_id(app, SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?,
                    &separator()?,
                    &PredefinedMenuItem::services(app, None)?,
                    &separator()?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &separator()?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &separator()?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &separator()?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
        ],
    )
}

/// Settings opens the page's Settings screen in the main window.
pub fn handle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id != SETTINGS {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval("location.hash = '#/settings'");
    }
}

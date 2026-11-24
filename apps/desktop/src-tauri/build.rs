// The app's own commands get `allow-…` permissions generated, so the capability file
// decides which window may call them (only the main one).
fn main() {
    // The webview runs the shared migrations. Build the restore limit from the same source.
    let migrations = "../../../packages/storage/src/migrations.ts";
    println!("cargo:rerun-if-changed={migrations}");
    let source = std::fs::read_to_string(migrations).expect("read shared migrations");
    let version: i32 = source
        .lines()
        .find_map(|line| line.strip_prefix("export const SCHEMA_VERSION = "))
        .and_then(|value| value.strip_suffix(';'))
        .and_then(|value| value.parse().ok())
        .expect("read SCHEMA_VERSION from shared migrations");
    println!("cargo:rustc-env=CUBEHAUS_SCHEMA_VERSION={version}");

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "db_open",
            "db_all",
            "db_columns",
            "db_batch",
            "db_keep_source",
            "db_close",
            "backup_now",
            "list_backups",
            "backup_folder",
            "restore_backup",
            "choose_backup_directory",
            "check_update",
            "apply_update_when_idle",
            "widget_snapshot",
        ]),
    ))
    .expect("failed to run tauri-build");
}

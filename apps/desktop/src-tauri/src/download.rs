use std::collections::HashMap;
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::webview::DownloadEvent;
use tauri::{Emitter, Manager, Url, Webview};

#[derive(Default)]
pub(crate) struct Downloads {
    // Two clicks can suggest the same name before either file exists.
    active: Mutex<HashMap<Url, PathBuf>>,
}

impl Downloads {
    pub(crate) fn handle(&self, webview: Webview, event: DownloadEvent<'_>) -> bool {
        match event {
            DownloadEvent::Requested { url, destination } => {
                if url.scheme() != "blob" {
                    return false;
                }
                if let Some(path) = self.destination(&webview, url.clone(), destination) {
                    *destination = path;
                    true
                } else {
                    report(&webview, &url, false);
                    false
                }
            }
            DownloadEvent::Finished { url, success, .. } if url.scheme() == "blob" => {
                self.active.lock().unwrap().remove(&url);
                report(&webview, &url, success);
                true
            }
            _ => true,
        }
    }

    fn destination(&self, webview: &Webview, url: Url, suggested: &Path) -> Option<PathBuf> {
        let directory = webview.path().download_dir().ok()?;
        std::fs::create_dir_all(&directory).ok()?;
        let mut active = self.active.lock().unwrap();
        let path = free_destination(&directory.join(suggested.file_name()?), |path| {
            if active.values().any(|reserved| reserved == path) {
                return Ok(true);
            }
            match path.symlink_metadata() {
                Ok(_) => Ok(true),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
                Err(error) => Err(error),
            }
        })
        .ok()?;
        active.insert(url, path.clone());
        Some(path)
    }
}

fn report(webview: &Webview, url: &Url, success: bool) {
    let _ = webview.emit_to(
        webview.label(),
        "download-finished",
        serde_json::json!({ "url": url.as_str(), "success": success }),
    );
}

fn free_destination(
    suggested: &Path,
    mut taken: impl FnMut(&Path) -> io::Result<bool>,
) -> io::Result<PathBuf> {
    let mut candidate = suggested.to_path_buf();
    let mut suffix = 1;
    while taken(&candidate)? {
        let mut name = OsString::from(suggested.file_stem().unwrap_or_default());
        name.push(format!(" ({suffix})"));
        if let Some(extension) = suggested.extension() {
            name.push(".");
            name.push(extension);
        }
        candidate.set_file_name(name);
        suffix += 1;
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_extension_and_skips_taken_names() {
        let suggested = Path::new("/downloads/cubehaus-backup.json");
        let taken = [
            suggested.to_path_buf(),
            suggested.with_file_name("cubehaus-backup (1).json"),
        ];
        let destination =
            free_destination(suggested, |path| Ok(taken.iter().any(|name| name == path))).unwrap();
        assert_eq!(
            destination,
            suggested.with_file_name("cubehaus-backup (2).json")
        );
    }
}

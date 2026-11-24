// The Mac widgets (apps/desktop/widgets): the page sends the snapshot it builds
// (apps/web/src/widget-snapshot.ts, the same one the phone app's widgets read), this
// writes it whole as `widgets.json` in the App Group container and asks WidgetKit to
// redraw. Finding the container and the redraw are Swift-only APIs, so they come from a
// small library in the app's Frameworks folder, loaded at run time; without it (a
// development build, a build without widgets, another system) a snapshot is dropped.
//
// A widget's link, `cubehaus://train/<set>/drill`, opens the app on that set's drill.

use crate::database::Error;
use std::path::{Path, PathBuf};

/// The file the extension reads (SnapshotFile.swift).
pub const FILE: &str = "widgets.json";
/// A snapshot is a few kilobytes (50 points for each of four lines); anything far larger
/// is not one.
const MAX_BYTES: usize = 64 * 1024;

/// Writes `json` as the snapshot in `dir`, whole or not at all (a temporary file renamed
/// over the old one), so the extension never reads half of one. It must be a JSON object
/// of a small size.
pub fn write_snapshot(dir: &Path, json: &str) -> Result<PathBuf, Error> {
    if json.len() > MAX_BYTES {
        return Err(Error("The widget snapshot is too large".into()));
    }
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|_| Error("The widget snapshot is not JSON".into()))?;
    if !value.is_object() {
        return Err(Error("The widget snapshot is not an object".into()));
    }
    std::fs::create_dir_all(dir).map_err(|error| Error(error.to_string()))?;
    let target = dir.join(FILE);
    let staging = dir.join(format!("{FILE}.partial"));
    std::fs::write(&staging, json)
        .and_then(|()| std::fs::rename(&staging, &target))
        .map_err(|error| Error(error.to_string()))?;
    Ok(target)
}

/// The page's route for a widget's link: the trainer's drill for one set, nothing else.
pub fn drill_route(url: &str) -> Option<String> {
    let set = url
        .strip_prefix("cubehaus://train/")?
        .strip_suffix("/drill")?;
    let plain = !set.is_empty()
        && set.len() <= 32
        && set
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    plain.then(|| format!("#/train/{set}/drill"))
}

#[cfg(target_os = "macos")]
mod bridge {
    use std::ffi::{CStr, c_char, c_int, c_void};
    use std::path::PathBuf;
    use std::sync::OnceLock;

    unsafe extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }
    const RTLD_NOW: c_int = 0x2;

    type Container = unsafe extern "C" fn(*mut c_char, isize) -> isize;
    type Reload = unsafe extern "C" fn();

    struct Bridge {
        container: Container,
        reload: Reload,
    }

    /// The library beside the app's binary (Contents/MacOS/../Frameworks), loaded once.
    fn bridge() -> Option<&'static Bridge> {
        static BRIDGE: OnceLock<Option<Bridge>> = OnceLock::new();
        BRIDGE
            .get_or_init(|| {
                let exe = std::env::current_exe().ok()?;
                let path = exe
                    .parent()?
                    .join("../Frameworks/libCubehausWidgetBridge.dylib");
                let path =
                    std::ffi::CString::new(path.into_os_string().into_encoded_bytes()).ok()?;
                // SAFETY: a C string path; the library's two symbols have the signatures
                // declared in WidgetBridge.swift, and it stays loaded for the process.
                unsafe {
                    let handle = dlopen(path.as_ptr(), RTLD_NOW);
                    if handle.is_null() {
                        return None;
                    }
                    let container = dlsym(handle, c"cubehaus_widgets_container".as_ptr());
                    let reload = dlsym(handle, c"cubehaus_widgets_reload".as_ptr());
                    if container.is_null() || reload.is_null() {
                        return None;
                    }
                    Some(Bridge {
                        container: std::mem::transmute::<*mut c_void, Container>(container),
                        reload: std::mem::transmute::<*mut c_void, Reload>(reload),
                    })
                }
            })
            .as_ref()
    }

    /// The App Group container, when the app has the library and the group.
    pub fn container() -> Option<PathBuf> {
        let bridge = bridge()?;
        let mut buffer = vec![0 as c_char; 1024];
        // SAFETY: the buffer is writable for its length; the function writes a NUL-ended
        // path only when it fits.
        let length = unsafe { (bridge.container)(buffer.as_mut_ptr(), buffer.len() as isize) };
        if length < 0 || length as usize >= buffer.len() {
            return None;
        }
        // SAFETY: the function wrote a NUL at `length`.
        let path = unsafe { CStr::from_ptr(buffer.as_ptr()) };
        Some(PathBuf::from(path.to_str().ok()?))
    }

    pub fn reload() {
        if let Some(bridge) = bridge() {
            // SAFETY: takes nothing, returns nothing.
            unsafe { (bridge.reload)() }
        }
    }
}

/// Writes the snapshot where the widgets read it and redraws them; nothing without the
/// widgets.
pub fn publish(json: &str) -> Result<(), Error> {
    #[cfg(target_os = "macos")]
    if let Some(dir) = bridge::container() {
        write_snapshot(&dir, json)?;
        bridge::reload();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = json;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_snapshot_is_written_whole_and_only_when_it_is_one() {
        let dir = std::env::temp_dir().join(format!("cubehaus-widgets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let json = r#"{"version":1,"trainer":null,"times":null}"#;
        let path = write_snapshot(&dir, json).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), json);
        assert!(!dir.join(format!("{FILE}.partial")).exists());
        for bad in ["[1]", "not json", &format!("\"{}\"", "x".repeat(MAX_BYTES))] {
            assert!(write_snapshot(&dir, bad).is_err());
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), json);
        std::fs::remove_dir_all(&dir).unwrap();

        assert_eq!(
            drill_route("cubehaus://train/oll/drill").as_deref(),
            Some("#/train/oll/drill")
        );
        for url in [
            "cubehaus://train//drill",
            "cubehaus://train/OLL/drill",
            "cubehaus://train/a'b/drill",
            "cubehaus://train/oll/learn",
            "https://train/oll/drill",
        ] {
            assert_eq!(drill_route(url), None, "{url}");
        }
    }
}

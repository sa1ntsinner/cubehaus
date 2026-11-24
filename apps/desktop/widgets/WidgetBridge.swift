import Foundation
import WidgetKit

// The desktop app's side of the widgets, as two C functions in a small library in
// cubehaus.app/Contents/Frameworks. The app loads it at run time
// (apps/desktop/src-tauri/src/widgets.rs) and does without it when it is not there: a
// development build, another system, a macOS before 12.

/// The App Group container's path, as the system gives it to this app (the group is the
/// one the widget extension's Info.plist names, `CubehausAppGroup`). Copied with a NUL
/// into `buffer`; returns its length in bytes, or -1 when there is no group or container.
/// A length of `capacity` or more means the buffer was too small and nothing was copied.
@_cdecl("cubehaus_widgets_container")
public func cubehausWidgetsContainer(_ buffer: UnsafeMutablePointer<CChar>?, _ capacity: Int) -> Int
{
    guard let plugins = Bundle.main.builtInPlugInsURL,
        let widgets = Bundle(url: plugins.appendingPathComponent("CubehausWidgets.appex")),
        let group = widgets.object(forInfoDictionaryKey: "CubehausAppGroup") as? String,
        !group.isEmpty,
        let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return -1 }
    let path = Array(url.path.utf8CString)
    let length = path.count - 1
    guard let buffer, length < capacity else { return length }
    path.withUnsafeBufferPointer { source in
        buffer.update(from: source.baseAddress!, count: path.count)
    }
    return length
}

/// Asks WidgetKit to draw this app's widgets again from the file.
@_cdecl("cubehaus_widgets_reload")
public func cubehausWidgetsReload() {
    WidgetCenter.shared.reloadAllTimelines()
}

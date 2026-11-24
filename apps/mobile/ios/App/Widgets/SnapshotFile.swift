import Foundation

/// Where the widgets' snapshot lives: one JSON file in the App Group container, written
/// by the app (CubehausPlugin.widgetSnapshot) and read by the widget extension. Compiled
/// into both. The group's name comes from each bundle's Info.plist (`CubehausAppGroup`,
/// `group.$(APP_BUNDLE_ID)`), so a build under another bundle ID keeps its own group.
enum SnapshotFile {
    static let name = "widgets.json"

    static var url: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "CubehausAppGroup") as? String
        else { return nil }
        return FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent(name)
    }
}

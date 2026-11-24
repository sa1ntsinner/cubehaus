import SwiftUI
import WidgetKit

/// The snapshot the page writes (apps/web/src/widget-snapshot.ts), format version 2. The
/// extension reads it and computes nothing: values and their written forms are the app's.
/// Version 2 added `language`; a version 1 file still reads, as English.
struct WidgetSnapshot: Decodable {
    static let version = 2
    static let readable = 1...version

    struct Trainer: Decodable {
        let set: String
        let name: String
        let done: Int
        let total: Int
        let next: String?
    }

    struct Line: Decodable {
        /// Oldest first, in milliseconds; nil is a DNF.
        let values: [Double?]
        let current: String?
        let best: Double?
        let record: Bool
    }

    struct Times: Decodable {
        let session: String
        let count: Int
        let stats: [String: Line]
    }

    let version: Int
    /// The app's chosen language (`en`, `ru`); nil in a version 1 file.
    let language: String?
    let trainer: Trainer?
    let times: Times?

    /// Nil when there is no file yet, or it is of a format this build does not read.
    static func load() -> WidgetSnapshot? {
        guard let url = SnapshotFile.url, let data = try? Data(contentsOf: url),
            let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
            readable.contains(snapshot.version)
        else { return nil }
        return snapshot
    }

    /// What the widget gallery shows before the app has written anything.
    static let sample = WidgetSnapshot(
        version: version,
        language: nil,
        trainer: Trainer(set: "oll", name: "OLL", done: 5, total: 57, next: "OLL 27"),
        times: Times(
            session: "3×3", count: 124,
            stats: Dictionary(
                uniqueKeysWithValues: ["single", "mo3", "ao5", "ao12"].map { name in
                    (name, Line(values: sampleValues, current: "12.34", best: 11020, record: false))
                })))

    private static let sampleValues: [Double?] = [
        13.9, 13.4, 13.6, 13.1, 13.3, 12.9, 13.2, 12.8, 12.6, 12.9, 12.5, 12.7, 12.2, 12.4,
        12.0, 12.3, 11.9, 12.1, 11.6, 11.9, 11.4, 11.7, 11.2, 11.5, 11.02, 11.6, 11.9, 12.1,
        12.0, 12.34,
    ].map { $0 * 1000 }
}

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

/// One entry, never refreshed on a schedule: the app reloads the timelines when it writes.
func snapshotEntry(preview: Bool) -> SnapshotEntry {
    let stored = WidgetSnapshot.load()
    return SnapshotEntry(date: Date(), snapshot: stored ?? (preview ? .sample : nil))
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(snapshotEntry(preview: context.isPreview))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        completion(Timeline(entries: [snapshotEntry(preview: false)], policy: .never))
    }
}

/// The app's colours (apps/web/src/design/tokens.css): ground, ink, dim, gutter, and the
/// green of a personal best. In the tinted and clear Home Screen the system draws one
/// colour, so there the steps are opacities of it.
struct Palette {
    let ink: Color
    let dim: Color
    let gutter: Color
    let track: Color
    let pb: Color

    static let ground = dynamic(light: 0xffffff, dark: 0x000000)

    init(_ mode: WidgetRenderingMode) {
        if mode == .fullColor {
            ink = Self.dynamic(light: 0x000000, dark: 0xffffff)
            dim = Self.dynamic(light: 0x454545, dark: 0xc8c8c8)
            gutter = Self.dynamic(light: 0x636363, dark: 0x929292)
            track = ink.opacity(0.16)
            pb = Self.dynamic(light: 0x116329, dark: 0x8ff09a)
        } else {
            ink = .primary
            dim = .primary.opacity(0.72)
            gutter = .primary.opacity(0.5)
            track = .primary.opacity(0.22)
            pb = .primary
        }
    }

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((value >> 16) & 0xff) / 255,
                green: CGFloat((value >> 8) & 0xff) / 255,
                blue: CGFloat(value & 0xff) / 255,
                alpha: 1)
        })
    }
}

extension Font {
    /// The small dim label over a figure.
    static let widgetLabel = Font.system(size: 13, weight: .medium)

    /// A figure: the system face, bold as the app's times are, digits of one width.
    static func widgetFigure(_ size: CGFloat) -> Font {
        .system(size: size, weight: .bold).monospacedDigit()
    }
}

/// The widgets speak the app's chosen language, not the system's: English until Russian
/// is chosen in the app's Settings (it comes in the snapshot).
enum Words {
    static func bundle(_ language: String?) -> Bundle {
        guard let path = Bundle.main.path(forResource: language == "ru" ? "ru" : "en", ofType: "lproj"),
            let bundle = Bundle(path: path)
        else { return .main }
        return bundle
    }

    static func text(_ key: String, _ language: String?) -> String {
        bundle(language).localizedString(forKey: key, value: key, table: nil)
    }

    /// The language of the last snapshot, for the widget gallery's names.
    static var stored: String? { WidgetSnapshot.load()?.language }
}

/// Russian has three forms: 1 сборка, 2 сборки, 5 сборок; 21 сборка, 11 сборок.
func solvesText(_ count: Int, _ language: String?) -> String {
    guard language == "ru" else {
        return count == 1 ? "1 solve" : "\(count) solves"
    }
    let tens = count % 100, ones = count % 10
    let word =
        (11...14).contains(tens) ? "сборок"
        : ones == 1 ? "сборка"
        : (2...4).contains(ones) ? "сборки" : "сборок"
    return "\(count) \(word)"
}

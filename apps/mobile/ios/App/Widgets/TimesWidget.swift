import AppIntents
import SwiftUI
import WidgetKit

/// The line the times widget draws, chosen in the system's Edit Widget sheet.
enum TimesStat: String, AppEnum {
    case single, mo3, ao5, ao12

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Line"
    static var caseDisplayRepresentations: [TimesStat: DisplayRepresentation] = [
        .single: "Single",
        .mo3: "Mean of 3",
        .ao5: "Average of 5",
        .ao12: "Average of 12",
    ]
}

struct TimesIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Times"

    @Parameter(title: "Line", default: .ao5)
    var stat: TimesStat
}

struct TimesEntry: TimelineEntry {
    let date: Date
    let stat: TimesStat
    let times: WidgetSnapshot.Times?
    let language: String?
}

struct TimesProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TimesEntry {
        TimesEntry(date: Date(), stat: .ao5, times: WidgetSnapshot.sample.times, language: Words.stored)
    }

    func snapshot(for configuration: TimesIntent, in context: Context) async -> TimesEntry {
        let entry = snapshotEntry(preview: context.isPreview)
        return TimesEntry(
            date: entry.date, stat: configuration.stat, times: entry.snapshot?.times,
            language: entry.snapshot?.language)
    }

    func timeline(for configuration: TimesIntent, in context: Context) async -> Timeline<TimesEntry> {
        let entry = snapshotEntry(preview: false)
        return Timeline(
            entries: [
                TimesEntry(
                    date: entry.date, stat: configuration.stat, times: entry.snapshot?.times,
                    language: entry.snapshot?.language)
            ], policy: .never)
    }
}

/// The open session's recent results: the chosen stat's name, its current value, and the
/// last 50 values as a thin line with the best one marked.
struct TimesWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "TimesWidget", intent: TimesIntent.self, provider: TimesProvider()) {
            entry in
            TimesView(stat: entry.stat, times: entry.times, language: entry.language)
                .containerBackground(for: .widget) { Palette.ground }
        }
        .configurationDisplayName(Text(Words.text("Times", Words.stored)))
        .description(
            Text(Words.text("The open session's recent results as a line, with the current value.", Words.stored)))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TimesView: View {
    let stat: TimesStat
    let times: WidgetSnapshot.Times?
    let language: String?
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode

    private var line: WidgetSnapshot.Line? { times?.stats[stat.rawValue] }
    private var name: String {
        stat == .single ? Words.text("single", language) : stat.rawValue
    }

    var body: some View {
        let palette = Palette(mode)
        let record = line?.record == true
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(name).font(.widgetLabel).foregroundStyle(palette.dim)
                Spacer(minLength: 8)
                if family != .systemSmall, let times {
                    Text("\(times.session) · \(solvesText(times.count, language))")
                        .font(.widgetLabel.monospacedDigit())
                        .foregroundStyle(palette.gutter)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
            }
            value(palette, size: family == .systemLarge ? 48 : 34, record: record)
                .padding(.top, family == .systemLarge ? 6 : 2)
            Chart(values: line?.values ?? [], palette: palette, record: record)
                .padding(.top, family == .systemLarge ? 16 : 8)
        }
    }

    /// The current value as the app writes it; `–` when there is none yet.
    private func value(_ palette: Palette, size: CGFloat, record: Bool) -> some View {
        Text(line?.current ?? "–")
            .font(.widgetFigure(size))
            .fontWeight(line?.current == nil ? .regular : .bold)
            .foregroundStyle(line?.current == nil ? palette.gutter : record ? palette.pb : palette.ink)
            .minimumScaleFactor(0.5)
            .lineLimit(1)
    }
}

/// A thin line through the values, no axes, grid or labels; a DNF is left out. The best
/// (lowest) point carries a small dot, green as a record is when the newest is one.
struct Chart: View {
    let values: [Double?]
    let palette: Palette
    let record: Bool

    var body: some View {
        GeometryReader { box in
            let points = Self.points(values, in: box.size)
            ZStack {
                if points.count > 1 {
                    Path { path in
                        path.addLines(points)
                    }
                    .stroke(
                        palette.ink,
                        style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round)
                    )
                    .widgetAccentable()
                }
                if let best = points.max(by: { $0.y < $1.y }) {
                    Circle()
                        .fill(record ? palette.pb : palette.ink)
                        .frame(width: 6, height: 6)
                        .position(best)
                        .widgetAccentable()
                }
            }
        }
    }

    /// Lower is better, so the lowest value sits at the foot. Three points of room above
    /// and below keep the line's width and the dot inside; the line starts where the
    /// label does and ends at the far edge.
    static func points(_ values: [Double?], in size: CGSize) -> [CGPoint] {
        let inset: CGFloat = 3
        let width = size.width, height = size.height - 2 * inset
        let finite = values.enumerated().compactMap { index, value in
            value.map { (index, $0) }
        }
        guard let low = finite.map(\.1).min(), let high = finite.map(\.1).max(), width > 0, height > 0
        else { return [] }
        let last = max(values.count - 1, 1)
        return finite.map { index, value in
            CGPoint(
                x: width * CGFloat(index) / CGFloat(last),
                y: high == low
                    ? inset + height / 2
                    : inset + height * CGFloat((high - value) / (high - low)))
        }
    }
}

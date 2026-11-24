import SwiftUI
import WidgetKit

/// One algorithm set's progress: its word, the cases in the drills of the set's total,
/// and the share as a thin ring (small) or bar (medium). The set is chosen in the app.
struct TrainerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TrainerWidget", provider: SnapshotProvider()) { entry in
            TrainerView(trainer: entry.snapshot?.trainer, language: entry.snapshot?.language)
                .containerBackground(for: .widget) { Palette.ground }
        }
        .configurationDisplayName(Text(Words.text("Algorithms", Words.stored)))
        .description(
            Text(
                Words.text(
                    "One set's progress: the cases in your drills. Choose the set in Algorithms: hold its word.",
                    Words.stored)
            )
        )
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct TrainerView: View {
    let trainer: WidgetSnapshot.Trainer?
    let language: String?
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var mode

    private var share: Double {
        guard let trainer, trainer.total > 0 else { return 0 }
        return min(1, Double(trainer.done) / Double(trainer.total))
    }

    var body: some View {
        let palette = Palette(mode)
        switch family {
        case .systemMedium:
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    label(palette)
                    Spacer(minLength: 8)
                    if let trainer, let url = URL(string: "cubehaus://train/\(trainer.set)/drill") {
                        Link(destination: url) {
                            Text(Words.text("Drill", language))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(palette.ink)
                        }
                    }
                }
                Spacer(minLength: 0)
                count(palette, size: 44)
                if let next = trainer?.next {
                    Text(String(format: Words.text("Next: %@", language), next))
                        .font(.widgetLabel.monospacedDigit())
                        .foregroundStyle(palette.dim)
                        .lineLimit(1)
                        .padding(.top, 2)
                }
                Bar(share: share, palette: palette)
                    .padding(.top, 12)
            }
        default:
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    label(palette)
                    Spacer(minLength: 8)
                    Ring(share: share, width: 3, palette: palette)
                        .frame(width: 30, height: 30)
                }
                Spacer(minLength: 0)
                count(palette, size: 38)
            }
        }
    }

    private func label(_ palette: Palette) -> some View {
        Text(trainer?.name ?? Words.text("Algorithms", language))
            .font(.widgetLabel)
            .foregroundStyle(palette.dim)
            .lineLimit(1)
    }

    /// `5/57`: the done part in ink, the total dimmer.
    private func count(_ palette: Palette, size: CGFloat) -> some View {
        Group {
            if let trainer {
                Text("\(trainer.done)").foregroundStyle(palette.ink)
                    + Text("/\(trainer.total)").foregroundStyle(palette.gutter)
            } else {
                // No set chosen: a plain dash, not a bold bar.
                Text("–").fontWeight(.regular).foregroundStyle(palette.gutter)
            }
        }
        .font(.widgetFigure(size))
        .minimumScaleFactor(0.5)
        .lineLimit(1)
    }
}

struct Ring: View {
    let share: Double
    let width: CGFloat
    let palette: Palette

    var body: some View {
        ZStack {
            Circle().stroke(palette.track, lineWidth: width)
            Circle()
                .trim(from: 0, to: share)
                .stroke(palette.ink, style: StrokeStyle(lineWidth: width, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .widgetAccentable()
        }
        .padding(width / 2)
    }
}

struct Bar: View {
    let share: Double
    let palette: Palette

    var body: some View {
        GeometryReader { box in
            ZStack(alignment: .leading) {
                Capsule().fill(palette.track)
                Capsule().fill(palette.ink)
                    .frame(width: share > 0 ? max(3, box.size.width * share) : 0)
                    .widgetAccentable()
            }
        }
        .frame(height: 3)
    }
}

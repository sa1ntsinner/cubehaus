import SwiftUI
import WidgetKit

/// The Home Screen widgets. They read one
/// file the app writes (SnapshotFile) and nothing else: no network, no database.
@main
struct CubehausWidgets: WidgetBundle {
    var body: some Widget {
        TrainerWidget()
        TimesWidget()
    }
}

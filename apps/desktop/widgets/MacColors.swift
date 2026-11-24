import AppKit
import SwiftUI

// The widgets' sources are the iPhone app's, compiled here as they are
// (apps/mobile/ios/App/Widgets). Their colours are UIKit's dynamic UIColor, which the Mac
// lacks; this is the part of it they use, drawn with AppKit's dynamic NSColor (light and
// dark with the system).

struct UIColor {
    enum Style { case light, dark }
    struct Traits { let userInterfaceStyle: Style }

    fileprivate let resolve: (Traits) -> NSColor

    init(dynamicProvider: @escaping (Traits) -> UIColor) {
        resolve = { traits in dynamicProvider(traits).resolve(traits) }
    }

    init(red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) {
        let color = NSColor(srgbRed: red, green: green, blue: blue, alpha: alpha)
        resolve = { _ in color }
    }
}

extension Color {
    init(uiColor: UIColor) {
        self.init(
            nsColor: NSColor(name: nil) { appearance in
                let dark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
                return uiColor.resolve(UIColor.Traits(userInterfaceStyle: dark ? .dark : .light))
            })
    }
}

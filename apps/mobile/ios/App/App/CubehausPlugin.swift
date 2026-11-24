import Capacitor
import UIKit
import WidgetKit

/// What the page cannot do in a WKWebView, called from apps/web/src/phone-app.ts:
/// haptics for the inspection calls and the session grid, keeping the screen on, the
/// status bar and the ground following the theme, a file handed to the share sheet, the
/// copy of the history in Documents, and what the Home Screen widgets show.
@objc(CubehausPlugin)
public class CubehausPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CubehausPlugin"
    public let jsName = "Cubehaus"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appearance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepCopy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copySettled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copyInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "widgetSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openedRoute", returnType: CAPPluginReturnPromise),
    ]

    /// A vibration pattern as the web writes it (on, off, on… in ms): one tap at the start
    /// of each "on" step. A step of 15 ms or less is a light tap, a longer one a firm one.
    @objc func haptic(_ call: CAPPluginCall) {
        let pattern = (call.getArray("pattern") as? [NSNumber] ?? []).map(\.doubleValue)
        DispatchQueue.main.async {
            var at = 0.0
            for (index, ms) in pattern.enumerated() {
                if index % 2 == 0 {
                    let style: UIImpactFeedbackGenerator.FeedbackStyle = ms <= 15 ? .light : .medium
                    DispatchQueue.main.asyncAfter(deadline: .now() + at / 1000) {
                        let generator = UIImpactFeedbackGenerator(style: style)
                        generator.impactOccurred()
                    }
                }
                at += max(ms, 0)
            }
            call.resolve()
        }
    }

    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    /// The theme's ground (`theme-color`): light figures in the status bar over a dark
    /// ground, dark ones over a light ground, and the same ground behind the page.
    @objc func appearance(_ call: CAPPluginCall) {
        guard let ground = UIColor(hex: call.getString("ground") ?? "") else {
            call.reject("ground is not #rrggbb")
            return
        }
        DispatchQueue.main.async {
            if let controller = self.bridge?.viewController as? CubehausViewController {
                controller.setGround(ground)
            }
            call.resolve()
        }
    }

    /// Writes the file to the app's temporary folder and opens the share sheet on it, so it
    /// can go to Files, AirDrop or a cloud drive. Resolves when the sheet closes.
    @objc func share(_ call: CAPPluginCall) {
        let name = (call.getString("name") ?? "cubehaus.json")
            .replacingOccurrences(of: "/", with: "-")
        let text = call.getString("text") ?? ""
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            call.reject("could not write the file")
            return
        }
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController else {
                call.reject("no view")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.completionWithItemsHandler = { _, _, _, _ in
                try? FileManager.default.removeItem(at: url)
                call.resolve()
            }
            // On an iPad the sheet is a popover and needs a place to point at.
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = controller.view
                popover.sourceRect = CGRect(
                    x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            controller.present(sheet, animated: true)
        }
    }

    /// The copy of the history (a backup file, as Settings › Data saves it) in Documents:
    /// the phone's iCloud and computer backups keep it, which they do not do for the
    /// webview's storage, and Files shows it under On My iPhone › cubehaus.
    private static let copyName = "cubehaus-backup.json"
    private var copyURL: URL? {
        try? FileManager.default
            .url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent(Self.copyName)
    }

    /// Time asked of iOS when the app leaves the screen, so the page can export the
    /// history and the copy can be written before the app is suspended. It ends when the
    /// page says the copy is settled (written, or nothing to write), or when iOS runs out
    /// of patience. Main thread only.
    private var leaving = UIBackgroundTaskIdentifier.invalid

    override public func load() {
        Self.live = self
        NotificationCenter.default.addObserver(
            self, selector: #selector(didEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(willEnterForeground),
            name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func willEnterForeground() {
        endLeaving()
    }

    @objc private func didEnterBackground() {
        guard leaving == .invalid else { return }
        leaving = UIApplication.shared.beginBackgroundTask(withName: "cubehaus copy") { [weak self] in
            self?.endLeaving()
        }
    }

    private func endLeaving() {
        guard leaving != .invalid else { return }
        UIApplication.shared.endBackgroundTask(leaving)
        leaving = .invalid
    }

    /// Writes the copy whole and then moves it into place.
    @objc func keepCopy(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), let url = copyURL else {
            call.reject("no text")
            return
        }
        do {
            try Data(text.utf8).write(to: url, options: .atomic)
            call.resolve()
        } catch {
            call.reject("could not write the copy")
        }
    }

    /// The page has done what it does on leaving: the app may be suspended.
    @objc func copySettled(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endLeaving()
            call.resolve()
        }
    }

    /// How many solves the copy holds (0 when there is no copy or it cannot be read).
    @objc func copyInfo(_ call: CAPPluginCall) {
        guard let url = copyURL, let data = try? Data(contentsOf: url),
            let doc = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let tables = doc["tables"] as? [String: Any]
        else {
            call.resolve(["solves": 0])
            return
        }
        call.resolve(["solves": (tables["solve"] as? [Any])?.count ?? 0])
    }

    /// What the widgets show (apps/web/src/widget-snapshot.ts), as the page computed it:
    /// written whole into the App Group container, where the widget extension reads it,
    /// and the widgets are asked to draw again.
    @objc func widgetSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let url = SnapshotFile.url else {
            call.reject("no snapshot, or no App Group container")
            return
        }
        do {
            try Data(json.utf8).write(to: url, options: .atomic)
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject("could not write the snapshot")
        }
    }

    /// A widget's link (`cubehaus://train/<set>/drill`) as the page's route, or nil for
    /// anything else: the trainer's drill is the only screen a widget opens.
    static func route(of url: URL) -> String? {
        guard url.scheme == "cubehaus", url.host == "train" else { return nil }
        let route = "#/train" + url.path
        return route.range(of: "^#/train/[a-z0-9-]+/drill$", options: .regularExpression) == nil
            ? nil : route
    }

    private static weak var live: CubehausPlugin?
    /// A route the app was opened with before the page asked for it. Main thread only.
    private static var waiting: String?
    private var pageAsked = false

    /// The app was opened by a widget's link (SceneDelegate). A page already running
    /// goes there now; one still loading asks with `openedRoute`.
    static func open(route: String) {
        guard let plugin = live, plugin.pageAsked else {
            waiting = route
            return
        }
        // The route matched the pattern in `route(of:)`: no quote or backslash in it.
        plugin.bridge?.webView?.evaluateJavaScript("location.hash = '\(route)'")
    }

    /// The route the app was opened with ("" when none); later ones set the hash.
    @objc func openedRoute(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pageAsked = true
            call.resolve(["route": Self.waiting ?? ""])
            Self.waiting = nil
        }
    }
}

extension UIColor {
    /// `#rrggbb`, or nil.
    convenience init?(hex: String) {
        guard hex.count == 7, hex.first == "#", let value = UInt32(hex.dropFirst(), radix: 16) else {
            return nil
        }
        self.init(
            red: CGFloat((value >> 16) & 0xff) / 255,
            green: CGFloat((value >> 8) & 0xff) / 255,
            blue: CGFloat(value & 0xff) / 255,
            alpha: 1)
    }

    /// Relative luminance (WCAG), 0 for black to 1 for white.
    var luminance: CGFloat {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        func linear(_ c: CGFloat) -> CGFloat {
            c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }
}

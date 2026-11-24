import Capacitor
import UIKit

/// The one screen: the web app full screen in Capacitor's WKWebView, laid out under the
/// notch and the home indicator (the page keeps its own safe-area margins), with the
/// app's native plugin registered.
class CubehausViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CubehausPlugin())
        // Until the page says otherwise, the ground follows the system, as the page's
        // own first paint does.
        let ground = UIColor { $0.userInterfaceStyle == .dark ? .black : .white }
        view.backgroundColor = ground
        webView?.isOpaque = false
        webView?.backgroundColor = ground
        webView?.scrollView.backgroundColor = ground
    }

    /// The theme's ground behind the page, and status-bar figures that read on it.
    func setGround(_ ground: UIColor) {
        view.backgroundColor = ground
        webView?.backgroundColor = ground
        webView?.scrollView.backgroundColor = ground
        setStatusBarStyle(ground.luminance < 0.5 ? .lightContent : .darkContent)
    }
}

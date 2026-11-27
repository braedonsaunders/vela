// VelaEmbedView (iPhone and iPad): one embedded web player, a trailer in YouTube's privacy-enhanced embed,
// in a WKWebView. The app hands it a host page (packages/core/src/trailer-embed.ts nativeEmbedPage), the
// origin that page loads under, and the one player frame it frames. Nothing else loads: the main frame
// never navigates after the host page, a subframe loads only the player's origin and path, and no window
// opens. Its website data store is non-persistent, so the embed keeps no cookies or storage past the view.
// Messages from the host page's own script (the main frame only) reach JavaScript as onEmbedMessage.
// tvOS has no WebKit: the module exists there, with no view (the app never embeds on a TV).
import ExpoModulesCore

public final class VelaEmbedModule: Module {
    public func definition() -> ModuleDefinition {
        Name("VelaEmbed")
        #if os(iOS)
        View(VelaEmbedView.self) {
            Events("onEmbedMessage", "onEmbedFailure")
            Prop("page") { (view: VelaEmbedView, value: String?) in view.page = value ?? "" }
            Prop("pageOrigin") { (view: VelaEmbedView, value: String?) in view.pageOrigin = value ?? "" }
            Prop("frameUrl") { (view: VelaEmbedView, value: String?) in view.frameUrl = value ?? "" }
            OnViewDidUpdateProps { (view: VelaEmbedView) in view.load() }
        }
        #endif
    }
}

#if os(iOS)
import UIKit
import WebKit

/// Where a frame may go: the scheme, host, port and path of a URL.
struct EmbedFrameRule: Equatable {
    let scheme: String
    let host: String
    let port: Int?
    let path: String

    init?(_ url: URL?) {
        guard let url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = components.host?.lowercased(), !host.isEmpty,
              components.user == nil, components.password == nil else { return nil }
        self.scheme = scheme
        self.host = host
        self.port = components.port
        self.path = components.path
    }

    func sameOrigin(_ other: EmbedFrameRule) -> Bool {
        scheme == other.scheme && host == other.host && port == other.port
    }
}

/// Holds the view weakly: WKUserContentController retains its handlers.
private final class EmbedMessageRelay: NSObject, WKScriptMessageHandler {
    weak var view: VelaEmbedView?
    init(view: VelaEmbedView) { self.view = view }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only the host page's own script; the player frame cannot speak for it.
        guard message.frameInfo.isMainFrame, let data = message.body as? String, data.utf8.count <= 65_536 else { return }
        view?.onEmbedMessage(["data": data])
    }
}

final class VelaEmbedView: ExpoView, WKNavigationDelegate, WKUIDelegate {
    static let handlerName = "velaEmbed"
    let onEmbedMessage = EventDispatcher()
    let onEmbedFailure = EventDispatcher()
    var page = ""
    var pageOrigin = ""
    var frameUrl = ""
    private var loaded: [String]?
    private var host: EmbedFrameRule?
    private var player: EmbedFrameRule?
    /// The host page's own load is the one main-frame navigation allowed.
    private var awaitingHostPage = false
    private var failed = false

    private lazy var web: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsPictureInPictureMediaPlayback = false
        configuration.allowsAirPlayForMediaPlayback = false
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.dataDetectorTypes = []
        configuration.userContentController.add(EmbedMessageRelay(view: self), name: Self.handlerName)
        let view = WKWebView(frame: bounds, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsLinkPreview = false
        view.allowsBackForwardNavigationGestures = false
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        return view
    }()

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        backgroundColor = .black
        clipsToBounds = true
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if web.superview === self { web.frame = bounds }
    }

    func load() {
        let next = [page, pageOrigin, frameUrl]
        if loaded == next { return }
        guard !page.isEmpty, let host = EmbedFrameRule(URL(string: pageOrigin)), host.path.isEmpty || host.path == "/",
              let player = EmbedFrameRule(URL(string: frameUrl)), player.path.hasPrefix("/embed/"),
              let base = URL(string: "\(host.scheme)://\(host.host)\(host.port.map { ":\($0)" } ?? "")/") else {
            fail("invalid")
            return
        }
        loaded = next
        self.host = host
        self.player = player
        failed = false
        awaitingHostPage = true
        if web.superview !== self {
            web.frame = bounds
            addSubview(web)
        }
        web.loadHTMLString(page, baseURL: base)
    }

    private func fail(_ reason: String) {
        if failed { return }
        failed = true
        onEmbedFailure(["reason": reason])
    }

    // MARK: Navigation: the host page, then only the player frame.

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let target = action.targetFrame else { return .cancel } // a new window
        let url = action.request.url
        let blank = url?.scheme?.lowercased() == "about"
        if target.isMainFrame {
            // The host page's own load (reported under its base URL, or about:blank first), and nothing after.
            guard awaitingHostPage else { return .cancel }
            if blank { return .allow }
            if let rule = EmbedFrameRule(url), let host, rule.sameOrigin(host) { return .allow }
            return .cancel
        }
        if blank { return .allow } // a blank frame the player scripts itself
        if let rule = EmbedFrameRule(url), let player, rule == player { return .allow }
        return .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        awaitingHostPage = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failedLoad(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failedLoad(error)
    }

    private func failedLoad(_ error: Error) {
        let error = error as NSError
        // A navigation this view refused is not the page failing.
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return }
        if error.domain == "WebKitErrorDomain" && error.code == 102 { return } // frame load interrupted by policy
        fail("load")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        fail("terminated")
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        nil
    }
}
#endif

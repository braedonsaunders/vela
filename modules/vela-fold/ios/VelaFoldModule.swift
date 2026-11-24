import ExpoModulesCore
import UIKit

/// A foldable iPhone's posture for the app's layout (modules/vela-fold/src): `flat` unless iOS
/// reports an active division region, the fold the window's content should divide at. iOS 27.1
/// activates it only while the hinge is partly open: held like a book (a vertical fold) or stood
/// on a table like a laptop (a horizontal fold). Fully open or closed, the screen is one surface.
public final class VelaFoldModule: Module {
    private var watcher: FoldWatcher?

    public func definition() -> ModuleDefinition {
        Name("VelaFold")
        Events("onChange")

        AsyncFunction("current") { () -> [String: Any] in
            self.attach()
            return self.watcher?.state ?? FoldWatcher.flat
        }.runOnQueue(.main)

        OnStartObserving {
            DispatchQueue.main.async { self.attach() }
        }
        OnStopObserving {
            DispatchQueue.main.async { self.watcher?.removeFromSuperview(); self.watcher = nil }
        }
    }

    /// Watches the key window: the folded and unfolded displays keep one window, and a new one
    /// (a scene reconnecting) is found again on the next call.
    private func attach() {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        guard let window else { return }
        if let watcher, watcher.window === window { return }
        watcher?.removeFromSuperview()
        let view = FoldWatcher(frame: window.bounds)
        view.onChange = { [weak self] state in self?.sendEvent("onChange", state) }
        window.insertSubview(view, at: 0)
        watcher = view
        view.refresh()
    }
}

/// An invisible view the size of the window: its layout passes (rotation, a fold or unfold, the
/// hinge's region becoming active) and the hinge interaction on it re-read the fold.
final class FoldWatcher: UIView {
    static let flat: [String: Any] = ["posture": "flat"]
    var onChange: (([String: Any]) -> Void)?
    private(set) var state: [String: Any] = FoldWatcher.flat
    private var hinge: AnyObject?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        accessibilityElementsHidden = true
        observeHinge()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() { super.layoutSubviews(); refresh() }
    override func safeAreaInsetsDidChange() { super.safeAreaInsetsDidChange(); refresh() }
    override func didMoveToWindow() { super.didMoveToWindow(); refresh() }

    private func observeHinge() {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            // The posture follows the hinge, not its every degree: the app re-lays out per posture.
            let interaction = UIHingeInteraction { [weak self] _, _ in
                guard let self else { return }
                self.refresh()
                // The division region turns active in the layout pass after the hinge moves.
                self.setNeedsLayout()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.refresh() }
            }
            addInteraction(interaction)
            hinge = interaction
        }
        #endif
    }

    func refresh() {
        var next: [String: Any] = ["posture": "flat"]
        #if compiler(>=6.4)
        if #available(iOS 27.1, *), window != nil {
            // Active regions only (the default query); the frame includes the margins interactive
            // content keeps clear of, in this view's (the window's) points.
            if let region = reservedRegions(kind: .division).first(where: { $0.isActive }) {
                let f = region.frame
                next["posture"] = f.height > f.width ? "book" : "tabletop"
                next["division"] = ["x": Double(f.minX), "y": Double(f.minY), "width": Double(f.width), "height": Double(f.height)]
            }
        }
        #endif
        guard !NSDictionary(dictionary: next).isEqual(to: state) else { return }
        state = next
        onChange?(next)
    }
}

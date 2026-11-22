import ExpoModulesCore
import UIKit

#if os(tvOS)
import React

/// Apple TV search: the system's search screen (UISearchController in a
/// UISearchContainerViewController) with its keyboard, dictation and the iPhone remote keyboard.
/// The results below it stay React: the view's React children are mounted in the search
/// controller's results view, sized by the frame `onResultsLayout` reports.
public final class VelaSearchModule: Module {
    public func definition() -> ModuleDefinition {
        Name("VelaSearch")
        View(VelaSearchView.self) {
            Events("onChangeText", "onSubmit", "onResultsLayout")
            Prop("placeholder") { (view: VelaSearchView, placeholder: String) in view.placeholder = placeholder }
            Prop("active") { (view: VelaSearchView, active: Bool) in view.setActive(active) }
            // A new number asks for focus to move into the results (after Return found something).
            Prop("focusResults") { (view: VelaSearchView, serial: Int) in view.focusResults(serial) }
        }
    }
}

/// The results area: React's children go in its view.
final class VelaSearchResultsController: UIViewController {
    var onLayout: (() -> Void)?
    override func loadView() {
        view = UIView()
        view.backgroundColor = .clear
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        onLayout?()
    }
}

/// The container, with a one-shot preferred focus so focus can be sent into the results.
final class VelaSearchContainerController: UISearchContainerViewController {
    var preferred: [UIFocusEnvironment]?
    override var preferredFocusEnvironments: [UIFocusEnvironment] {
        if let preferred {
            self.preferred = nil
            return preferred
        }
        return super.preferredFocusEnvironments
    }
}

final class VelaSearchView: ExpoView, UISearchResultsUpdating, UISearchBarDelegate, UIGestureRecognizerDelegate {
    let onChangeText = EventDispatcher()
    let onSubmit = EventDispatcher()
    let onResultsLayout = EventDispatcher()

    private let results = VelaSearchResultsController()
    private let search: UISearchController
    private let container: VelaSearchContainerController
    private var text = ""
    private var reported = CGRect.null
    private var serial = 0
    private var active = true
    private var openedFocus = false
    private weak var observed: UIScrollView?
    private let menu = UITapGestureRecognizer()
    private var insetSettled = false
    /// Results come and go with the query (React mounts a new scroll view): checked while shown.
    private var watch: Timer?

    var placeholder: String {
        get { search.searchBar.placeholder ?? "" }
        set { search.searchBar.placeholder = newValue }
    }

    required init(appContext: AppContext? = nil) {
        search = UISearchController(searchResultsController: results)
        container = VelaSearchContainerController(searchController: search)
        super.init(appContext: appContext)
        backgroundColor = .clear
        search.searchResultsUpdater = self
        let bar = search.searchBar
        bar.delegate = self
        bar.autocapitalizationType = .none
        bar.autocorrectionType = .no
        bar.keyboardAppearance = .dark
        bar.returnKeyType = .search
        container.overrideUserInterfaceStyle = .dark
        container.view.backgroundColor = .clear
        results.onLayout = { [weak self] in self?.resultsLaidOut() }
        menu.addTarget(self, action: #selector(menuToKeyboard))
        menu.allowedPressTypes = [NSNumber(value: UIPress.PressType.menu.rawValue)]
        menu.delegate = self
        addGestureRecognizer(menu)
    }

    // MARK: React children live in the results view

    override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
        results.loadViewIfNeeded()
        results.view.insertSubview(childComponentView, at: min(index, results.view.subviews.count))
        setNeedsLayout()
    }

    override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
        childComponentView.removeFromSuperview()
    }

    // MARK: Hosting the container

    override func didMoveToWindow() {
        super.didMoveToWindow()
        watch?.invalidate()
        watch = nil
        guard window != nil else { return }
        attach()
        watch = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.observeResultsScroll() }
        if !openedFocus {
            openedFocus = true
            // The screen opens on the keyboard.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.window != nil, self.active else { return }
                self.requestFocus(self.container)
            }
        }
    }

    override func removeFromSuperview() {
        watch?.invalidate()
        watch = nil
        detach()
        super.removeFromSuperview()
    }

    private func attach() {
        guard container.parent == nil, let parent = owningController() else { return }
        parent.addChild(container)
        container.view.frame = bounds
        container.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(container.view)
        container.didMove(toParent: parent)
    }

    private func detach() {
        guard container.parent != nil else { return }
        container.willMove(toParent: nil)
        container.view.removeFromSuperview()
        container.removeFromParent()
    }

    private func owningController() -> UIViewController? {
        var responder: UIResponder? = superview
        while let current = responder {
            if let controller = current as? UIViewController { return controller }
            responder = current.next
        }
        return nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        container.view.frame = bounds
        resultsLaidOut()
    }

    /// React lays its results out in the frame the system gives the results view.
    private func resultsLaidOut() {
        guard results.isViewLoaded, container.parent != nil else { return }
        let frame = results.view.convert(results.view.bounds, to: self)
        if frame != reported, frame.width > 0, frame.height > 0 {
            reported = frame
            onResultsLayout(["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height])
        }
        observeResultsScroll()
    }

    /// The keyboard scrolls away as the results scroll, as in the system's own search screens.
    /// Observing a scroll view makes the results view full screen with the field and keyboard as
    /// its top safe area: the results' scroll view (React's, which ignores safe areas by default)
    /// takes that inset, so the results start below the keyboard and scroll up under it.
    private func observeResultsScroll() {
        guard results.isViewLoaded, let scroll = firstScrollView(in: results.view) else { return }
        if observed !== scroll {
            observed = scroll
            insetSettled = false
            scroll.contentInsetAdjustmentBehavior = .scrollableAxes
            search.searchControllerObservedScrollView = scroll
        }
        let top = scroll.adjustedContentInset.top
        if !insetSettled, top > 0 {
            insetSettled = true
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: -top), animated: false)
        }
    }

    private func firstScrollView(in root: UIView) -> UIScrollView? {
        var queue = root.subviews
        while !queue.isEmpty {
            let view = queue.removeFirst()
            if let scroll = view as? UIScrollView { return scroll }
            queue.append(contentsOf: view.subviews)
        }
        return nil
    }

    // MARK: Text

    func updateSearchResults(for searchController: UISearchController) {
        let next = searchController.searchBar.text ?? ""
        guard next != text else { return }
        text = next
        onChangeText(["text": next])
    }

    /// Return on the iPhone remote keyboard: tvOS ends editing and moves focus down into the
    /// results itself (the search button callback is for a hardware keyboard). Either way the
    /// text is searched at once; `focused` says whether focus already reached the results, else
    /// React asks for it once the results for this text have drawn.
    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) { finishedTyping() }
    func searchBarTextDidEndEditing(_ searchBar: UISearchBar) { finishedTyping() }

    private func finishedTyping() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self, self.window != nil else { return }
            let value = self.search.searchBar.text ?? ""
            self.text = value
            self.onSubmit(["text": value, "focused": self.focusInResults()])
        }
    }

    private func focusInResults() -> Bool {
        guard results.isViewLoaded, let focused = UIFocusSystem(for: self)?.focusedItem as? UIView else { return false }
        return focused.isDescendant(of: results.view)
    }

    // MARK: Menu

    /// Menu in the results goes back up to the keyboard, as in the system's search screens; Menu
    /// on the keyboard leaves search. The navigation stack pops on Menu through a recognizer of
    /// its own, so this recognizer begins only while focus is in the results, and the stack's
    /// waits for it to fail.
    @objc private func menuToKeyboard() {
        // The keyboard must be back on screen before focus can move to it.
        if let observed { observed.setContentOffset(CGPoint(x: 0, y: -observed.adjustedContentInset.top), animated: false) }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.requestFocus(self.search.searchBar)
        }
    }

    override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
        recognizer === menu ? active && focusInResults() : super.gestureRecognizerShouldBegin(recognizer)
    }

    func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        recognizer === menu && other.allowedPressTypes.contains(NSNumber(value: UIPress.PressType.menu.rawValue))
    }

    // MARK: Focus

    func setActive(_ on: Bool) {
        let returning = on && !active
        active = on
        container.view.isUserInteractionEnabled = on
        if returning { restoreFocus(attempt: 0) }
    }

    /// What had focus here last: a title page opened from the results takes focus away, and when
    /// it closes focus must come back here, or the remote's presses go nowhere (Menu then leaves
    /// search). React's own request lands while the screen still refuses focus, so retry briefly.
    private weak var lastFocused: UIView?

    override func didUpdateFocus(in context: UIFocusUpdateContext, with coordinator: UIFocusAnimationCoordinator) {
        super.didUpdateFocus(in: context, with: coordinator)
        if let next = context.nextFocusedView, next.isDescendant(of: self) { lastFocused = next }
    }

    private func restoreFocus(attempt: Int) {
        guard active, window != nil else { return }
        if let focused = UIFocusSystem(for: self)?.focusedItem as? UIView, focused.isDescendant(of: self) { return }
        if let target = lastFocused, target.window != nil { requestFocus(target) } else { requestFocus(search.searchBar) }
        guard attempt < 10 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.restoreFocus(attempt: attempt + 1) }
    }

    func focusResults(_ next: Int) {
        guard next != serial else { return }
        serial = next
        if next > 0 { focusResults(serial: next, attempt: 0) }
    }

    private func focusResults(serial request: Int, attempt: Int) {
        guard request == serial, window != nil, active else { return }
        results.view.layoutIfNeeded()
        if let target = firstFocusable(in: results.view) {
            container.preferred = [target]
            requestFocus(target)
            if target.isFocused { return }
        }
        // Results may still be laying out: try again briefly.
        guard attempt < 15 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.focusResults(serial: request, attempt: attempt + 1)
        }
    }

    /// The top-left-most focusable view showing in the results.
    private func firstFocusable(in root: UIView) -> UIView? {
        var best: (view: UIView, origin: CGPoint)?
        func walk(_ view: UIView) {
            if view.isHidden || view.alpha < 0.01 { return }
            if view.canBecomeFocused {
                let frame = view.convert(view.bounds, to: root)
                guard frame.intersects(root.bounds) else { return }
                if let current = best {
                    let higher = frame.minY < current.origin.y - 1
                    let level = abs(frame.minY - current.origin.y) <= 1
                    if !(higher || (level && frame.minX < current.origin.x)) { return }
                }
                best = (view, frame.origin)
                return
            }
            view.subviews.forEach(walk)
        }
        walk(root)
        return best?.view
    }

    /// react-native-tvos keeps an explicit preferred focus on its hosting root; ask through it,
    /// then through the focus system.
    private func requestFocus(_ environment: UIFocusEnvironment) {
        var ancestor: UIView? = self
        while let view = ancestor {
            if let root = view as? RCTSurfaceHostingProxyRootView {
                root.reactPreferredFocusEnvironments = [environment]
                root.setNeedsFocusUpdate()
                root.updateFocusIfNeeded()
                break
            }
            ancestor = view.superview
        }
        if let system = UIFocusSystem(for: self) {
            system.requestFocusUpdate(to: environment)
            system.updateFocusIfNeeded()
        }
    }
}

#else

/// Search uses the platform's own text fields outside tvOS.
public final class VelaSearchModule: Module {
    public func definition() -> ModuleDefinition {
        Name("VelaSearch")
    }
}

#endif

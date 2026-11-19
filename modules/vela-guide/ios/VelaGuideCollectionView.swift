import ExpoModulesCore
import UIKit
import React
import SDWebImage
import SDWebImageSVGCoder

private struct GuideItem {
    let id: String
    let minute: CGFloat
    let span: CGFloat
}

/// Gaps expose hourly focus targets without allocating an item per hour per channel.
private struct GuideItems: RandomAccessCollection {
    typealias Index = Int
    private var segments: [(index: Int, item: GuideItem, count: Int)] = []
    private(set) var endIndex = 0
    var startIndex: Int { 0 }
    func index(after i: Int) -> Int { i + 1 }
    func index(before i: Int) -> Int { i - 1 }
    init(_ programmes: [GuideItem], minutes: CGFloat) {
        var at: CGFloat = 0
        func gap(_ end: CGFloat) {
            guard end > at else { return }
            let count = Int(ceil((end - at) / 60))
            segments.append((endIndex, GuideItem(id: "", minute: at, span: end - at), count)); endIndex += count; at = end
        }
        for p in programmes { gap(p.minute); segments.append((endIndex, p, 1)); endIndex += 1; at = Swift.max(at, p.minute + p.span) }
        gap(minutes)
    }
    func overlapping(_ from: CGFloat, _ to: CGFloat) -> Range<Int> {
        var low = 0, high = endIndex
        while low < high { let mid = (low + high) / 2; let p = self[mid]; if p.minute + p.span <= from { low = mid + 1 } else { high = mid } }
        let first = low; high = endIndex
        while low < high { let mid = (low + high) / 2; if self[mid].minute < to { low = mid + 1 } else { high = mid } }
        return first..<low
    }
    subscript(index: Int) -> GuideItem {
        let segment = segments.last { $0.index <= index }!
        if !segment.item.id.isEmpty { return segment.item }
        let offset = CGFloat(index - segment.index) * 60
        return GuideItem(id: "", minute: segment.item.minute + offset, span: Swift.min(60, segment.item.span - offset))
    }
}

/// Rect queries touch only intersecting rows, independent of a 1k/10k lineup's height.
private final class GuideLayout: UICollectionViewLayout {
    var diagnostics = false
    private var queries = 0, itemQueries = 0, maxRows = 0
    private var maxQueryMS: Double = 0
    func takeMetrics() -> [String: Any] {
        let value: [String: Any] = ["queries": queries, "items": itemQueries, "maxRows": maxRows, "maxQueryMs": maxQueryMS]
        queries = 0; itemQueries = 0; maxRows = 0; maxQueryMS = 0
        return value
    }
    var rows: [GuideItems] = []
    var row: CGFloat = 96, scale: CGFloat = 6, minutes: CGFloat = 1440
    override var collectionViewContentSize: CGSize { CGSize(width: minutes * scale, height: CGFloat(rows.count) * row) }
    var focusRow = 0, focusColumn = 0
    func metadata(at path: IndexPath) -> GuideItem {
        let minute = CGFloat(path.item), entries = rows[path.section]
        if let i = entries.overlapping(minute, minute + 0.001).first { return entries[i] }
        return GuideItem(id: "", minute: minute, span: 1)
    }
    func isAnchor(_ path: IndexPath) -> Bool {
        guard rows.indices.contains(path.section), path.item >= 0, path.item < Int(ceil(minutes)) else { return false }
        if path.item == focusColumn { return true }
        guard path.section == focusRow else { return false }
        let item = metadata(at: path)
        let current = metadata(at: IndexPath(item: focusColumn, section: focusRow))
        return Int(ceil(item.minute)) == path.item && (item.id != current.id || item.minute != current.minute)
    }
    override func layoutAttributesForItem(at path: IndexPath) -> UICollectionViewLayoutAttributes? {
        if diagnostics { itemQueries += 1 }
        guard rows.indices.contains(path.section), path.item >= 0, path.item < Int(ceil(minutes)) else { return nil }
        let a = UICollectionViewLayoutAttributes(forCellWith: path)
        // Focus uses a stable time anchor, independent of programme duration. This keeps
        // vertical neighbours aligned; a single edge click cannot skip shorter programmes.
        a.frame = CGRect(x: CGFloat(path.item) * scale, y: CGFloat(path.section) * row, width: scale, height: row)
        return a
    }
    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        let began = diagnostics ? CACurrentMediaTime() : 0
        defer { if diagnostics { maxQueryMS = max(maxQueryMS, (CACurrentMediaTime() - began) * 1000) } }
        guard !rows.isEmpty else { return [] }
        let first = max(0, Int(floor(rect.minY / row))), last = min(rows.count - 1, Int(floor(rect.maxY / row)))
        guard first <= last else { return [] }
        if diagnostics { queries += 1; maxRows = max(maxRows, last - first + 1) }
        return (first...last).flatMap { section -> [UICollectionViewLayoutAttributes] in
            var columns = Set([focusColumn])
            if section == focusRow {
                let entries = rows[section]
                for i in entries.overlapping(rect.minX / scale, rect.maxX / scale) { columns.insert(Int(ceil(entries[i].minute))) }
            }
            return columns.sorted().compactMap { column in
                let path = IndexPath(item: column, section: section)
                guard isAnchor(path), let a = layoutAttributesForItem(at: path), a.frame.intersects(rect) else { return nil }
                return a
            }
        }
    }
    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool { false }
}

private final class GuideProgrammeCell: UICollectionViewCell {
    let ring = CALayer()
    override init(frame: CGRect) {
        super.init(frame: frame)
        // These minute-wide targets overlay the opaque row raster. UIKit must never
        // synthesize a selected/focused background above it.
        backgroundConfiguration = UIBackgroundConfiguration.clear()
        automaticallyUpdatesBackgroundConfiguration = false
        backgroundColor = .clear; contentView.backgroundColor = .clear
        ring.borderWidth = 2; ring.isHidden = true; layer.addSublayer(ring)
        clipsToBounds = false; contentView.clipsToBounds = false
        isAccessibilityElement = true; accessibilityTraits = .button
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    var focusAllowed: (() -> Bool)?
    override var canBecomeFocused: Bool { focusAllowed?() ?? true }
    var programmeRect = CGRect.zero
    override func layoutSubviews() { super.layoutSubviews(); ring.frame = programmeRect }
    override func prepareForReuse() { super.prepareForReuse(); ring.isHidden = true; accessibilityLabel = nil }
    override func didUpdateFocus(in context: UIFocusUpdateContext, with coordinator: UIFocusAnimationCoordinator) {
        super.didUpdateFocus(in: context, with: coordinator)
        ring.isHidden = !isFocused
    }
}

private final class GuidePaintSlot {
    let view = VelaGuideRowView(appContext: nil)
    var channel = "", version = -1
    init() { view.accessibilityElementsHidden = true }
}

/// The rail is recycled separately from programme focus, and follows native scrolling per frame.
private final class GuideRail: UIView {
    let image = UIImageView(), title = UILabel(), number = UILabel()
    private var identity = ""
    private var task: SDWebImageCombinedOperation?
    private static let registerSVG: Void = { SDImageCodersManager.shared.addCoder(SDImageSVGCoder.shared) }()
    override init(frame: CGRect) {
        super.init(frame: frame)
        _ = Self.registerSVG
        backgroundColor = guideInitialBackground
        image.backgroundColor = guideInitialBackground
        image.contentMode = .scaleAspectFit; image.clipsToBounds = true
        title.font = .systemFont(ofSize: 18, weight: .semibold); title.textColor = .white
        number.font = .monospacedDigitSystemFont(ofSize: 14, weight: .regular); number.textColor = .lightGray
        [image, title, number].forEach(addSubview)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { task?.cancel() }
    func colours(_ palette: [String: Any]) {
        backgroundColor = guideColour(palette["rail"]); image.backgroundColor = backgroundColor; title.textColor = guideColour(palette["ink"]); number.textColor = guideColour(palette["secondary"])
    }
    func show(_ channel: [String: Any]) {
        let id = channel["id"] as? String ?? "", uri = channel["logo"] as? String ?? ""
        let key = channel["logoKey"] as? String ?? "\(id.utf8.count):\(id)\(uri)"
        let nextTitle = channel["name"] as? String, nextNumber = channel["number"] as? String
        if title.text != nextTitle { title.text = nextTitle }; if number.text != nextNumber { number.text = nextNumber }
        guard key != identity else { return }
        identity = key; task?.cancel(); task = nil; image.image = nil
        guard let url = URL(string: uri), ["https", "http"].contains(url.scheme ?? "") else { return }
        let context: [SDWebImageContextOption: Any] = [
            .imageThumbnailPixelSize: NSValue(cgSize: CGSize(width: 128, height: 80))
        ]
        task = SDWebImageManager.shared.loadImage(with: url, options: [.scaleDownLargeImages], context: context, progress: nil) { [weak self] picture, _, _, _, finished, _ in
            guard finished, let picture else { return }
            DispatchQueue.main.async {
                guard let self, self.identity == key else { return }
                self.image.image = picture
            }
        }
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        number.frame = CGRect(x: 10, y: 0, width: 46, height: bounds.height)
        image.frame = CGRect(x: 62, y: 12, width: 58, height: bounds.height - 24)
        title.frame = CGRect(x: 132, y: 0, width: max(0, bounds.width - 140), height: bounds.height)
    }
}

final class VelaGuideCollectionView: ExpoView, UICollectionViewDataSource, UICollectionViewDelegate {
    let onWindow = EventDispatcher(), onProgramme = EventDispatcher(), onExit = EventDispatcher()
    private let layout = GuideLayout()
    private lazy var collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
    private var channels: [[String: Any]] = []
    private var previousIDs: [String] = []
    private var emptyLabel = ""
    private var chrome: [String: Any] = [:]
    private var previousCells: [String: NSArray] = [:]
    private var channelIndices: [String: Int] = [:]
    private var cacheOrder: [String] = []
    private var latestData: [String: Any]?
    private var dataGeneration = 0
    private var drawings: [String: [String: Any]] = [:]
    private var programmeDrawings: [String: [String: [String: Any]]] = [:]
    private var rails: [GuideRail] = [], ticks: [UILabel] = []
    private var paints: [GuidePaintSlot] = []
    private var paintVersion = 0
    private var availability: [String: Bool] = [:]
    private var accent: CGColor = UIColor.white.cgColor
    private let ruler = UIView(), railHost = UIView()
    private let dayLabel = UILabel(), nowPill = UILabel()
    private var timeLabels: [Int: (String, Bool)] = [:]
    private var rail: CGFloat = 320, rulerHeight: CGFloat = 44
    private var startsAt: Double = 0, now: CGFloat = -1
    private let nowLine = UIView()
    private var lastWindow = "", serial = -1
    private var target: IndexPath?
    private var focusMinute: CGFloat = -1
    var diagnostics = false { didSet { layout.diagnostics = diagnostics } }
    private var enabled = true
    private var hasPosition = false
    private var lastMotion: CFTimeInterval = 0
    private var dataWork: DispatchWorkItem?
    private var motion: [(Double, CGPoint)] = []
    private var settleWork: DispatchWorkItem?
    private var pendingFocus: Int?
    private var focusAttempts = 0
    private var pendingCommand: [String: Any]?
    private var frameLink: CADisplayLink?
    private var frameDeadline: CFTimeInterval = 0

    private func probeFrames() {
        guard diagnostics, window != nil else { return }
        frameDeadline = CACurrentMediaTime() + 0.8
        guard frameLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(probeFrame(_:)))
        link.add(to: .main, forMode: .common); frameLink = link
    }
    @objc private func probeFrame(_ link: CADisplayLink) {
        guard diagnostics, window != nil, CACurrentMediaTime() < frameDeadline else {
            link.invalidate(); frameLink = nil; return
        }
        let rows = paints.filter { !$0.view.isHidden }.map { $0.view.frameState }
        let state: [String: Any] = ["t": link.timestamp, "y": collection.contentOffset.y,
            "rows": rows, "cells": collection.visibleCells.map { cell -> [String: Any] in
                ["focused": cell.isFocused, "selected": cell.isSelected,
                 "background": cell.backgroundColor?.description ?? "nil",
                 "configuredBackground": cell.backgroundConfiguration?.backgroundColor?.description ?? "nil"]
            }]
        if let data = try? JSONSerialization.data(withJSONObject: state), let json = String(data: data, encoding: .utf8) {
            print("[vela-guide-frame] \(json)")
        }
    }

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        collection.dataSource = self; collection.delegate = self
        collection.allowsFocus = true
        collection.register(GuideProgrammeCell.self, forCellWithReuseIdentifier: "programme")
        backgroundColor = guideInitialBackground
        collection.backgroundColor = guideInitialBackground
        railHost.backgroundColor = guideInitialBackground
        collection.remembersLastFocusedIndexPath = false
        collection.contentInsetAdjustmentBehavior = .never
        collection.showsHorizontalScrollIndicator = false; collection.showsVerticalScrollIndicator = false
        addSubview(collection); addSubview(railHost); addSubview(ruler)
        dayLabel.font = .systemFont(ofSize: 14, weight: .semibold); addSubview(dayLabel)
        nowPill.font = .monospacedDigitSystemFont(ofSize: 14, weight: .semibold); nowPill.textAlignment = .center
        nowPill.layer.cornerRadius = 12; nowPill.clipsToBounds = true; ruler.addSubview(nowPill)
        ruler.backgroundColor = guideInitialBackground; ruler.clipsToBounds = true
        railHost.clipsToBounds = true
        nowLine.backgroundColor = .systemRed; nowLine.isUserInteractionEnabled = false; collection.addSubview(nowLine)
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { setNeedsLayout(); fulfillFocus() }
    }
    private func fulfillFocus() {
        guard pendingFocus != nil, window != nil else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.enabled, let next = self.pendingFocus, self.serial == next,
                  self.window != nil, let target = self.target else { return }
            self.collection.layoutIfNeeded()
            guard let cell = self.collection.cellForItem(at: target), let system = UIFocusSystem(for: self) else { return }
            #if os(tvOS)
            // react-native-tvos retains an explicit preferred target on its hosting root.
            // Use its public root contract when crossing from an RN toolbar into UIKit.
            var ancestor: UIView? = self
            while let view = ancestor {
                if let root = view as? RCTSurfaceHostingProxyRootView {
                    root.reactPreferredFocusEnvironments = nil
                    root.reactPreferredFocusedView = cell
                    root.setNeedsFocusUpdate(); root.updateFocusIfNeeded()
                    break
                }
                ancestor = view.superview
            }
            #endif
            system.requestFocusUpdate(to: cell); system.updateFocusIfNeeded()
            self.focusAttempts += 1
            if cell.isFocused { self.pendingFocus = nil }
            else if self.focusAttempts < 12 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.fulfillFocus() }
            } else { self.pendingFocus = nil }
            if self.diagnostics { print("[vela-guide] requestedFocus row=\(target.section) attempt=\(self.focusAttempts) key=\(self.window?.isKeyWindow ?? false) focused=\(system.focusedItem.map { String(describing: type(of: $0)) } ?? "nil")") }
        }
    }
    override var preferredFocusEnvironments: [UIFocusEnvironment] { [collection] }
    func setActive(_ active: Bool) { enabled = active; collection.isUserInteractionEnabled = active }
    override func layoutSubviews() {
        super.layoutSubviews()
        collection.frame = CGRect(x: rail, y: rulerHeight, width: max(0, bounds.width - rail), height: max(0, bounds.height - rulerHeight))
        ruler.frame = CGRect(x: rail, y: 0, width: max(0, bounds.width - rail), height: rulerHeight)
        dayLabel.frame = CGRect(x: 20, y: 0, width: max(0, rail - 30), height: rulerHeight)
        railHost.frame = CGRect(x: 0, y: rulerHeight, width: rail, height: max(0, bounds.height - rulerHeight))
        if let command = pendingCommand, bounds.width > 0 { pendingCommand = nil; navigate(command) }
        updateChrome(); reportWindow(); fulfillFocus()
    }
    func setChannels(_ next: [[String: Any]]) {
        let ids = next.map { $0["id"] as? String ?? "" }
        let changed = ids != previousIDs
        channels = next; previousIDs = ids
        channelIndices = Dictionary(ids.enumerated().map { ($0.element, $0.offset) }, uniquingKeysWith: { _, b in b })
        if changed {
            previousCells.removeAll(); cacheOrder.removeAll(); target = nil
            layout.rows = Array(repeating: GuideItems([], minutes: layout.minutes), count: channels.count)
            collection.reloadData(); layout.invalidateLayout()
        }
        if let data = latestData { setData(data) }
        setNeedsLayout()
    }

    func setDataJSON(_ json: String) {
        dataGeneration += 1
        let token = dataGeneration
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let bytes = json.data(using: .utf8), let data = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.dataGeneration == token else { return }
                self.setData(data)
            }
        }
    }

    func setData(_ data: [String: Any]) {
        let began = CACurrentMediaTime()
        latestData = data
        guard !channels.isEmpty else { return }
        // A listing response must not replace focus targets in the middle of UIKit's
        // gesture/deceleration. Prefetch keeps running; coalesce presentation until settled.
        if hasPosition, window != nil, CACurrentMediaTime() - lastMotion < 0.35 {
            dataWork?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self, let latest = self.latestData else { return }
                self.setData(latest)
            }
            dataWork = work; DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
            return
        }
        dataWork?.cancel(); dataWork = nil
        let oldStart = startsAt, oldScale = layout.scale, oldMinutes = layout.minutes
        let oldOffset = collection.contentOffset
        let focused = collection.indexPathsForVisibleItems.first { collection.cellForItem(at: $0)?.isFocused == true }
        let oldItem = focused.map { layout.metadata(at: $0) }
        rail = CGFloat((data["rail"] as? NSNumber)?.doubleValue ?? 320)
        layout.row = CGFloat((data["row"] as? NSNumber)?.doubleValue ?? 96)
        layout.scale = CGFloat((data["scale"] as? NSNumber)?.doubleValue ?? 6)
        layout.minutes = CGFloat((data["minutes"] as? NSNumber)?.doubleValue ?? 1440)
        startsAt = (data["startsAt"] as? NSNumber)?.doubleValue ?? 0
        now = CGFloat((data["now"] as? NSNumber)?.doubleValue ?? -1)
        timeLabels = Dictionary((data["ticks"] as? [[String: Any]] ?? []).map { tick in
            (Int((tick["minute"] as? NSNumber)?.doubleValue ?? 0), (tick["label"] as? String ?? "", tick["hour"] as? Bool ?? false))
        }, uniquingKeysWith: { _, b in b })
        dayLabel.text = data["dayLabel"] as? String; nowPill.text = data["nowLabel"] as? String
        chrome = data["chrome"] as? [String: Any] ?? [:]
        backgroundColor = guideColour(chrome["background"])
        collection.backgroundColor = backgroundColor
        railHost.backgroundColor = guideColour(chrome["rail"])
        ruler.backgroundColor = guideColour(chrome["rail"]); dayLabel.textColor = guideColour(chrome["secondary"])
        nowPill.backgroundColor = guideColour(chrome["now"]); nowLine.backgroundColor = guideColour(chrome["now"]); nowPill.textColor = guideColour(chrome["ink"])
        emptyLabel = data["emptyLabel"] as? String ?? ""
        accent = guideColour(chrome["accent"]).cgColor
        probeFrames()
        paintVersion += 1
        drawings.removeAll(keepingCapacity: true); programmeDrawings.removeAll(keepingCapacity: true)
        for drawing in data["drawings"] as? [[String: Any]] ?? [] {
            let id = drawing["channelId"] as? String ?? ""
            let cells = drawing["cells"] as? [[String: Any]] ?? []
            programmeDrawings[id] = Dictionary(cells.map { ($0["id"] as? String ?? "", $0) }, uniquingKeysWith: { _, b in b })
            drawings[id] = drawing
        }
        var changed = IndexSet()
        var reset = false
        if oldMinutes != layout.minutes || oldStart != startsAt && oldStart > 0 {
            previousCells.removeAll(); cacheOrder.removeAll()
            layout.rows = Array(repeating: GuideItems([], minutes: layout.minutes), count: channels.count)
            reset = true
        }
        for row in data["rows"] as? [[String: Any]] ?? [] {
            let id = row["id"] as? String ?? ""
            guard let index = channelIndices[id] else { continue }
            availability[id] = row["loaded"] as? Bool ?? false
            let cells = (row["cells"] as? [[String: Any]] ?? []) as NSArray
            cacheOrder.removeAll { $0 == id }; cacheOrder.append(id)
            if previousCells[id]?.isEqual(cells) == true { continue }
            previousCells[id] = cells
            let items = (row["cells"] as? [[String: Any]] ?? []).map { cell in
                GuideItem(id: cell["id"] as? String ?? "", minute: CGFloat((cell["at"] as? NSNumber)?.doubleValue ?? 0), span: CGFloat((cell["span"] as? NSNumber)?.doubleValue ?? 30))
            }.sorted { $0.minute < $1.minute }
            layout.rows[index] = GuideItems(items, minutes: layout.minutes); changed.insert(index)
        }
        while cacheOrder.count > 256 {
            let id = cacheOrder.removeFirst(); previousCells.removeValue(forKey: id); availability.removeValue(forKey: id)
            if let index = channelIndices[id] { layout.rows[index] = GuideItems([], minutes: layout.minutes); changed.insert(index) }
        }
        if let focused, let oldItem {
            focusMinute = (focusMinute >= 0 ? focusMinute : oldItem.minute) + (oldStart > 0 && startsAt > 0 ? CGFloat((oldStart - startsAt) / 60000) : 0)
            target = path(section: focused.section, minute: focusMinute)
            layout.focusRow = focused.section; layout.focusColumn = target!.item
        }
        layout.invalidateLayout()
        if reset {
            collection.reloadData()
            if focused != nil { pendingFocus = serial; focusAttempts = 0; fulfillFocus() }
        }
        for case let cell as GuideProgrammeCell in collection.visibleCells {
            if let p = collection.indexPath(for: cell) { configure(cell, at: p) }
        }
        if oldStart > 0, startsAt > 0, oldStart != startsAt || oldScale != layout.scale {
            let x = max(0, (oldOffset.x / oldScale + CGFloat((oldStart - startsAt) / 60000)) * layout.scale)
            collection.setContentOffset(CGPoint(x: x, y: oldOffset.y), animated: false)
        }
        setNeedsLayout()
        if !changed.isEmpty, let target, collection.cellForItem(at: target)?.isFocused == true { emit(target, press: false) }
        if diagnostics { print("[vela-guide-data] ms=\((CACurrentMediaTime() - began) * 1000) rows=\((data["rows"] as? [Any])?.count ?? 0) sections=\(changed.count)") }
    }

    private func path(section: Int, minute: CGFloat) -> IndexPath {
        IndexPath(item: max(0, min(Int(ceil(layout.minutes)) - 1, Int(floor(minute)))), section: section)
    }
    func navigate(_ command: [String: Any]) {
        guard bounds.width > 0, !channels.isEmpty else { pendingCommand = command; return }
        if diagnostics { print("[vela-guide] navigate rows=\(channels.count) focus=\(command["focus"] as? Bool ?? false) bounds=\(bounds.size)") }
        let next = (command["serial"] as? NSNumber)?.intValue ?? 0
        guard serial != next else { return }; serial = next
        let id = command["channel"] as? String ?? ""
        let section = channels.firstIndex { $0["id"] as? String == id } ?? 0
        let minute = CGFloat((command["minute"] as? NSNumber)?.doubleValue ?? 0)
        focusMinute = minute
        target = path(section: section, minute: minute)
        layout.focusRow = section; layout.focusColumn = target!.item; layout.invalidateLayout()
        hasPosition = true
        collection.setContentOffset(CGPoint(x: max(0, min(layout.minutes * layout.scale - collection.bounds.width, (minute - 60) * layout.scale)), y: max(0, min(CGFloat(channels.count) * layout.row - collection.bounds.height, CGFloat(max(0, section - 1)) * layout.row))), animated: false)
        collection.layoutIfNeeded()
        if diagnostics, let target {
            let cell = collection.cellForItem(at: target)
            print("[vela-guide] target section=\(target.section) item=\(target.item) cell=\(cell != nil) focusable=\(cell?.canBecomeFocused ?? false) enabled=\(enabled) attached=\(window != nil) system=\(UIFocusSystem(for: self) != nil)")
        }
        pendingFocus = nil
        if command["focus"] as? Bool == true { pendingFocus = next; focusAttempts = 0; fulfillFocus() }
        updateChrome(); reportWindow()
    }
    func numberOfSections(in collectionView: UICollectionView) -> Int { channels.count }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { Int(ceil(layout.minutes)) }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "programme", for: indexPath) as! GuideProgrammeCell
        configure(cell, at: indexPath); return cell
    }
    private func configure(_ cell: GuideProgrammeCell, at p: IndexPath) {
        let item = layout.metadata(at: p), id = channels[p.section]["id"] as? String ?? ""
        cell.focusAllowed = { [weak self] in self?.canFocus(p) ?? false }
        cell.ring.borderColor = accent
        cell.ring.cornerRadius = (drawings[id]?["radius"] as? NSNumber)?.doubleValue ?? 8
        cell.ring.isHidden = !cell.isFocused
        cell.programmeRect = CGRect(x: (item.minute - CGFloat(p.item)) * layout.scale + 2, y: 5, width: max(2, item.span * layout.scale - 4), height: layout.row - 11)
        cell.ring.frame = cell.programmeRect
        let label = programmeDrawings[id]?[item.id]?["label"] as? String ?? channels[p.section]["name"] as? String
        if cell.accessibilityLabel != label { cell.accessibilityLabel = label }
    }

    func indexPathForPreferredFocusedView(in collectionView: UICollectionView) -> IndexPath? { target }
    private func canFocus(_ p: IndexPath) -> Bool { enabled && layout.isAnchor(p) }
    func collectionView(_ collectionView: UICollectionView, canFocusItemAt indexPath: IndexPath) -> Bool { canFocus(indexPath) }
    func collectionView(_ collectionView: UICollectionView, didUpdateFocusIn context: UICollectionViewFocusUpdateContext, with coordinator: UIFocusAnimationCoordinator) {
        if let p = context.nextFocusedIndexPath {
            focusMinute = CGFloat(p.item)
            lastMotion = CACurrentMediaTime(); target = p
            layout.focusRow = p.section; layout.focusColumn = p.item
            layout.invalidateLayout(); collection.layoutIfNeeded()
            emit(p, press: false)
        }
        else if context.previouslyFocusedIndexPath != nil { onExit(["toolbar": false]) }
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) { emit(indexPath, press: true) }
    private func emit(_ p: IndexPath, press: Bool) {
        guard channels.indices.contains(p.section) else { return }
        let item = layout.metadata(at: p)
        if diagnostics { print("[vela-guide] focus t=\(CACurrentMediaTime()) row=\(p.section) item=\(p.item) minute=\(item.minute) press=\(press)") }
        onProgramme(["channel": channels[p.section]["id"] as? String ?? "", "minute": CGFloat(p.item), "press": press])
    }
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        lastMotion = CACurrentMediaTime()
        probeFrames()
        updateChrome(); reportWindow()
        guard diagnostics else { return }
        if motion.count < 1200 { motion.append((CACurrentMediaTime(), scrollView.contentOffset)) }
        settleWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let first = self.motion.first, let last = self.motion.last else { return }
            let dy = (last.1.y - first.1.y) / self.layout.row, dx = (last.1.x - first.1.x) / self.layout.scale
            print("[vela-guide-motion] samples=\(self.motion.count) rows=\(dy) minutes=\(dx) duration=\(last.0 - first.0)")
            if let data = try? JSONSerialization.data(withJSONObject: self.layout.takeMetrics()), let json = String(data: data, encoding: .utf8) { print("[vela-guide-layout] \(json)") }
            self.motion.removeAll(keepingCapacity: true)
        }
        settleWork = work; DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
    }
    private func reportWindow() {
        guard hasPosition, collection.bounds.width > 0 else { return }
        let first = max(0, Int(collection.contentOffset.y / layout.row / 4) * 4), last = min(channels.count, first + Int(ceil(collection.bounds.height / layout.row)) + 4)
        let from = max(0, floor(collection.contentOffset.x / layout.scale / 30) * 30), to = min(layout.minutes, ceil((collection.contentOffset.x + collection.bounds.width) / layout.scale / 30) * 30)
        let key = "\(first)|\(last)|\(from)|\(to)"
        guard key != lastWindow else { return }; lastWindow = key
        onWindow(["first": first, "last": last, "from": from, "to": to])
    }
    private func updateChrome() {
        guard !channels.isEmpty else { return }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        let count = Int(ceil(collection.bounds.height / layout.row)) + 2
        while rails.count < count { let v = GuideRail(); railHost.addSubview(v); rails.append(v) }
        let first = max(0, Int(collection.contentOffset.y / layout.row))
        while paints.count < count {
            let slot = GuidePaintSlot(); collection.layer.insertSublayer(slot.view.layer, at: 0); paints.append(slot)
        }
        var used = Set<Int>()
        for index in first..<min(channels.count, first + count) {
            let slot = index % count; used.insert(slot)
            let v = rails[slot], paint = paints[slot], channel = channels[index]
            let id = channel["id"] as? String ?? ""
            v.isHidden = false
            v.frame = CGRect(x: 0, y: CGFloat(index) * layout.row - collection.contentOffset.y, width: rail, height: layout.row - 1)
            v.colours(chrome); v.show(channel)
            paint.view.isHidden = false
            paint.view.setVisibleOffset(collection.contentOffset.x)
            if paint.channel != id || paint.version != paintVersion {
                paint.channel = id; paint.version = paintVersion
                var raw = drawings[id] ?? drawings.values.first ?? [:]
                if drawings[id] == nil { raw["cells"] = [] }
                raw["channelId"] = id
                var palette = raw["colours"] as? [String: Any] ?? [:]
                palette["background"] = chrome["background"]
                palette["surface"] = chrome["surface"]
                raw["colours"] = palette
                if (raw["cells"] as? [Any])?.isEmpty == true, availability[id] == true {
                    raw["cells"] = [["id": "gap:\(id)", "x": 2, "width": max(2, (raw["width"] as? NSNumber)?.doubleValue ?? 1) - 4,
                                      "title": emptyLabel, "label": emptyLabel]]
                }
                paint.view.drawRow(raw)
                let x = (raw["originX"] as? NSNumber)?.doubleValue ?? 0
                let width = (raw["width"] as? NSNumber)?.doubleValue ?? 1
                paint.view.frame = CGRect(x: x, y: CGFloat(index) * layout.row, width: width, height: layout.row)
            }
        }
        for i in rails.indices where !used.contains(i) { rails[i].isHidden = true }
        for i in paints.indices where !used.contains(i) { paints[i].view.isHidden = true }
        let tickCount = Int(ceil(collection.bounds.width / layout.scale / 30)) + 2
        while ticks.count < tickCount { let v = UILabel(); v.font = .systemFont(ofSize: 15, weight: .semibold); v.textColor = .lightGray; ruler.addSubview(v); ticks.append(v) }
        let start = floor(collection.contentOffset.x / layout.scale / 30) * 30
        for (i, v) in ticks.enumerated() {
            let minute = start + CGFloat(i) * 30; v.isHidden = i >= tickCount || minute >= layout.minutes
            v.frame = CGRect(x: minute * layout.scale - collection.contentOffset.x + 8, y: 0, width: 150, height: rulerHeight)
            v.textColor = guideColour(chrome["secondary"])
            v.text = timeLabels[Int(minute)]?.0
            if timeLabels[Int(minute)]?.1 == true { v.textColor = guideColour(chrome["ink"]) }
        }
        nowPill.frame = CGRect(x: now * layout.scale - collection.contentOffset.x - 44, y: 8, width: 88, height: 26)
        nowPill.isHidden = now < 0; ruler.bringSubviewToFront(nowPill)
        nowLine.frame = CGRect(x: now * layout.scale, y: 0, width: 2, height: CGFloat(channels.count) * layout.row)
        nowLine.isHidden = now < 0; collection.bringSubviewToFront(nowLine)
    }
}

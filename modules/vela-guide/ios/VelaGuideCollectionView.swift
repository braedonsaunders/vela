import ExpoModulesCore
import UIKit
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
    subscript(index: Int) -> GuideItem {
        let segment = segments.last { $0.index <= index }!
        if !segment.item.id.isEmpty { return segment.item }
        let offset = CGFloat(index - segment.index) * 60
        return GuideItem(id: "", minute: segment.item.minute + offset, span: Swift.min(60, segment.item.span - offset))
    }
}

/// Rect queries touch only intersecting rows, independent of a 1k/10k lineup's height.
private final class GuideLayout: UICollectionViewLayout {
    var rows: [GuideItems] = []
    var row: CGFloat = 96, scale: CGFloat = 6, minutes: CGFloat = 1440
    override var collectionViewContentSize: CGSize { CGSize(width: minutes * scale, height: CGFloat(rows.count) * row) }
    override func layoutAttributesForItem(at path: IndexPath) -> UICollectionViewLayoutAttributes? {
        guard rows.indices.contains(path.section), rows[path.section].indices.contains(path.item) else { return nil }
        let item = rows[path.section][path.item]
        let a = UICollectionViewLayoutAttributes(forCellWith: path)
        a.frame = CGRect(x: item.minute * scale, y: CGFloat(path.section) * row, width: max(2, item.span * scale), height: row)
        return a
    }
    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        guard !rows.isEmpty else { return [] }
        let first = max(0, Int(floor(rect.minY / row))), last = min(rows.count - 1, Int(floor(rect.maxY / row)))
        guard first <= last else { return [] }
        return (first...last).flatMap { section in
            rows[section].indices.compactMap { item -> UICollectionViewLayoutAttributes? in
                let a = layoutAttributesForItem(at: IndexPath(item: item, section: section))
                return a?.frame.intersects(rect) == true ? a : nil
            }
        }
    }
    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool { false }
}

private final class GuideProgrammeCell: UICollectionViewCell {
    let drawing = VelaGuideRowView(appContext: nil)
    var identity = ""
    var fingerprint: NSDictionary?
    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.addSubview(drawing)
        clipsToBounds = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() { super.layoutSubviews(); drawing.frame = bounds }
    override func prepareForReuse() {
        super.prepareForReuse(); identity = ""; fingerprint = nil; drawing.select("")
        // Invalidate any pending asynchronous drawing before assigning another channel.
        drawing.drawRow(["cells": [], "width": 1, "height": 1])
    }
    override func didUpdateFocus(in context: UIFocusUpdateContext, with coordinator: UIFocusAnimationCoordinator) {
        super.didUpdateFocus(in: context, with: coordinator)
        drawing.select(isFocused ? identity : "")
    }
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
        backgroundColor = UIColor(white: 0.055, alpha: 1)
        image.contentMode = .scaleAspectFit; image.clipsToBounds = true
        title.font = .systemFont(ofSize: 18, weight: .semibold); title.textColor = .white
        number.font = .monospacedDigitSystemFont(ofSize: 14, weight: .regular); number.textColor = .lightGray
        [image, title, number].forEach(addSubview)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { task?.cancel() }
    func colours(_ palette: [String: Any]) {
        backgroundColor = guideColour(palette["rail"]); title.textColor = guideColour(palette["ink"]); number.textColor = guideColour(palette["secondary"])
    }
    func show(_ channel: [String: Any]) {
        let id = channel["id"] as? String ?? "", uri = channel["logo"] as? String ?? ""
        let key = channel["logoKey"] as? String ?? "\(id.utf8.count):\(id)\(uri)"
        title.text = channel["name"] as? String; number.text = channel["number"] as? String
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
    private var previousCells: [NSArray] = []
    private var previousMinutes: CGFloat = -1
    private var drawings: [String: [String: Any]] = [:]
    private var rails: [GuideRail] = [], ticks: [UILabel] = []
    private let ruler = UIView(), railHost = UIView()
    private let dayLabel = UILabel(), nowPill = UILabel()
    private var timeLabels: [Int: (String, Bool)] = [:]
    private var rail: CGFloat = 320, rulerHeight: CGFloat = 44
    private var startsAt: Double = 0, now: CGFloat = -1
    private let nowLine = UIView()
    private var lastWindow = "", serial = -1
    private var target: IndexPath?
    private var enabled = true
    private var pendingCommand: [String: Any]?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        collection.dataSource = self; collection.delegate = self
        collection.register(GuideProgrammeCell.self, forCellWithReuseIdentifier: "programme")
        collection.backgroundColor = .clear
        collection.remembersLastFocusedIndexPath = false
        collection.contentInsetAdjustmentBehavior = .never
        collection.showsHorizontalScrollIndicator = false; collection.showsVerticalScrollIndicator = false
        addSubview(collection); addSubview(railHost); addSubview(ruler)
        dayLabel.font = .systemFont(ofSize: 14, weight: .semibold); addSubview(dayLabel)
        nowPill.font = .monospacedDigitSystemFont(ofSize: 14, weight: .semibold); nowPill.textAlignment = .center
        nowPill.layer.cornerRadius = 12; nowPill.clipsToBounds = true; ruler.addSubview(nowPill)
        ruler.backgroundColor = UIColor(white: 0.055, alpha: 1); ruler.clipsToBounds = true
        railHost.clipsToBounds = true
        nowLine.backgroundColor = .systemRed; nowLine.isUserInteractionEnabled = false; collection.addSubview(nowLine)
    }
    func setActive(_ active: Bool) { enabled = active; collection.isUserInteractionEnabled = active }
    override func layoutSubviews() {
        super.layoutSubviews()
        collection.frame = CGRect(x: rail, y: rulerHeight, width: max(0, bounds.width - rail), height: max(0, bounds.height - rulerHeight))
        ruler.frame = CGRect(x: rail, y: 0, width: max(0, bounds.width - rail), height: rulerHeight)
        dayLabel.frame = CGRect(x: 20, y: 0, width: max(0, rail - 30), height: rulerHeight)
        railHost.frame = CGRect(x: 0, y: rulerHeight, width: rail, height: max(0, bounds.height - rulerHeight))
        if let command = pendingCommand, bounds.width > 0 { pendingCommand = nil; navigate(command) }
        updateChrome(); reportWindow()
    }
    func setData(_ data: [String: Any]) {
        let oldRows = layout.rows
        let oldStart = startsAt, oldScale = layout.scale
        let oldOffset = collection.contentOffset
        channels = data["channels"] as? [[String: Any]] ?? []
        rail = CGFloat((data["rail"] as? NSNumber)?.doubleValue ?? 320)
        layout.row = CGFloat((data["row"] as? NSNumber)?.doubleValue ?? 96)
        layout.scale = CGFloat((data["scale"] as? NSNumber)?.doubleValue ?? 6)
        layout.minutes = CGFloat((data["minutes"] as? NSNumber)?.doubleValue ?? 1440)
        startsAt = (data["startsAt"] as? NSNumber)?.doubleValue ?? 0
        now = CGFloat((data["now"] as? NSNumber)?.doubleValue ?? -1)
        drawings = Dictionary((data["drawings"] as? [[String: Any]] ?? []).map { ($0["channelId"] as? String ?? "", $0) }, uniquingKeysWith: { _, b in b })
        timeLabels = Dictionary((data["ticks"] as? [[String: Any]] ?? []).map { tick in
            (Int((tick["minute"] as? NSNumber)?.doubleValue ?? 0), (tick["label"] as? String ?? "", tick["hour"] as? Bool ?? false))
        }, uniquingKeysWith: { _, b in b })
        dayLabel.text = data["dayLabel"] as? String; nowPill.text = data["nowLabel"] as? String
        chrome = data["chrome"] as? [String: Any] ?? [:]
        ruler.backgroundColor = guideColour(chrome["rail"])
        dayLabel.textColor = guideColour(chrome["secondary"])
        nowPill.backgroundColor = guideColour(chrome["now"]); nowLine.backgroundColor = guideColour(chrome["now"]); nowPill.textColor = guideColour(chrome["ink"])
        emptyLabel = data["emptyLabel"] as? String ?? ""
        let oldIDs = previousIDs
        let ids = channels.map { $0["id"] as? String ?? "" }
        var changed = previousMinutes != layout.minutes || previousIDs != ids
        previousIDs = ids
        var nextCells: [NSArray] = []
        layout.rows = channels.enumerated().map { index, channel in
            let rawCells = (channel["cells"] as? [[String: Any]] ?? []) as NSArray
            nextCells.append(rawCells)
            if previousMinutes == layout.minutes, previousCells.indices.contains(index), oldRows.indices.contains(index), previousCells[index].isEqual(rawCells) { return oldRows[index] }
            changed = true
            let programmes = (channel["cells"] as? [[String: Any]] ?? []).map { cell in
                GuideItem(id: cell["id"] as? String ?? "", minute: CGFloat((cell["at"] as? NSNumber)?.doubleValue ?? 0), span: CGFloat((cell["span"] as? NSNumber)?.doubleValue ?? 30))
            }.sorted { $0.minute < $1.minute }
            return GuideItems(programmes, minutes: layout.minutes)
        }
        previousCells = nextCells; previousMinutes = layout.minutes

        if changed {
            let focused = collection.indexPathsForVisibleItems.first { collection.cellForItem(at: $0)?.isFocused == true }
            let minute = focused.flatMap { oldRows.indices.contains($0.section) && oldRows[$0.section].indices.contains($0.item) ? oldRows[$0.section][$0.item].minute : nil }
            if let focused, let minute, !channels.isEmpty {
                let channel = oldIDs.indices.contains(focused.section) ? oldIDs[focused.section] : ""
                let section = ids.firstIndex(of: channel) ?? min(focused.section, channels.count - 1)
                let id = oldRows[focused.section][focused.item].id
                if !id.isEmpty, let item = layout.rows[section].firstIndex(where: { $0.id == id }) { target = IndexPath(item: item, section: section) }
                else { target = path(section: section, minute: minute + CGFloat((oldStart - startsAt) / 60000)) }
            } else if let current = target, !layout.rows.indices.contains(current.section) { target = nil }
            collection.reloadData(); layout.invalidateLayout()
            if focused != nil { collection.setNeedsFocusUpdate(); collection.updateFocusIfNeeded() }
        } else {
            for case let cell as GuideProgrammeCell in collection.visibleCells { if let p = collection.indexPath(for: cell) { configure(cell, at: p) } }
        }
        layout.invalidateLayout()
        if oldStart > 0, startsAt > 0, oldStart != startsAt || oldScale != layout.scale {
            let x = max(0, (oldOffset.x / oldScale + CGFloat((oldStart - startsAt) / 60000)) * layout.scale)
            collection.setContentOffset(CGPoint(x: x, y: oldOffset.y), animated: false)
        }
        setNeedsLayout()
    }
    private func path(section: Int, minute: CGFloat) -> IndexPath {
        let items = layout.rows[section]
        return IndexPath(item: items.firstIndex { $0.minute + $0.span > minute } ?? max(0, items.count - 1), section: section)
    }
    func navigate(_ command: [String: Any]) {
        guard bounds.width > 0, !channels.isEmpty else { pendingCommand = command; return }
        let next = (command["serial"] as? NSNumber)?.intValue ?? 0
        guard serial != next else { return }; serial = next
        let id = command["channel"] as? String ?? ""
        let section = channels.firstIndex { $0["id"] as? String == id } ?? 0
        let minute = CGFloat((command["minute"] as? NSNumber)?.doubleValue ?? 0)
        target = path(section: section, minute: minute)
        collection.setContentOffset(CGPoint(x: max(0, min(layout.minutes * layout.scale - collection.bounds.width, (minute - 60) * layout.scale)), y: max(0, min(CGFloat(channels.count) * layout.row - collection.bounds.height, CGFloat(max(0, section - 1)) * layout.row))), animated: false)
        collection.layoutIfNeeded()
        if command["focus"] as? Bool == true, let target, let cell = collection.cellForItem(at: target), let system = UIFocusSystem(for: self) {
            system.requestFocusUpdate(to: cell); system.updateFocusIfNeeded()
        }
        updateChrome(); reportWindow()
    }
    func numberOfSections(in collectionView: UICollectionView) -> Int { channels.count }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { layout.rows[section].count }
    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "programme", for: indexPath) as! GuideProgrammeCell
        configure(cell, at: indexPath); return cell
    }
    private func configure(_ cell: GuideProgrammeCell, at p: IndexPath) {
        let item = layout.rows[p.section][p.item], id = channels[p.section]["id"] as? String ?? ""
        var raw = drawings[id] ?? drawings.values.first ?? [:]
        var programme = (raw["cells"] as? [[String: Any]])?.first { $0["id"] as? String == item.id } ?? [:]
        let identity = item.id.isEmpty ? "gap:\(item.minute)" : item.id
        programme["id"] = identity; programme["x"] = 2; programme["width"] = max(2, item.span * layout.scale - 4)
        if item.id.isEmpty { programme["title"] = emptyLabel }
        raw["cells"] = [programme]; raw["channelId"] = id; raw["originX"] = item.minute * layout.scale
        raw["width"] = item.span * layout.scale; raw["height"] = layout.row
        cell.identity = identity
        if cell.fingerprint?.isEqual(to: raw) != true { cell.fingerprint = raw as NSDictionary; cell.drawing.drawRow(raw) }
        cell.drawing.select(cell.isFocused ? identity : "")
        cell.accessibilityLabel = programme["label"] as? String ?? channels[p.section]["name"] as? String
    }
    func indexPathForPreferredFocusedView(in collectionView: UICollectionView) -> IndexPath? { target }
    func collectionView(_ collectionView: UICollectionView, canFocusItemAt indexPath: IndexPath) -> Bool { enabled }
    func collectionView(_ collectionView: UICollectionView, didUpdateFocusIn context: UICollectionViewFocusUpdateContext, with coordinator: UIFocusAnimationCoordinator) {
        if let p = context.nextFocusedIndexPath { target = p; emit(p, press: false) }
        else if context.previouslyFocusedIndexPath != nil { onExit(["toolbar": false]) }
    }
    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) { emit(indexPath, press: true) }
    private func emit(_ p: IndexPath, press: Bool) {
        guard channels.indices.contains(p.section), layout.rows[p.section].indices.contains(p.item) else { return }
        let item = layout.rows[p.section][p.item]
        onProgramme(["channel": channels[p.section]["id"] as? String ?? "", "minute": item.minute + min(1, item.span / 2), "press": press])
    }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { updateChrome(); reportWindow() }
    private func reportWindow() {
        guard collection.bounds.width > 0 else { return }
        let first = max(0, Int(collection.contentOffset.y / layout.row / 4) * 4), last = min(channels.count, first + Int(ceil(collection.bounds.height / layout.row)) + 4)
        let from = max(0, floor(collection.contentOffset.x / layout.scale / 30) * 30), to = min(layout.minutes, ceil((collection.contentOffset.x + collection.bounds.width) / layout.scale / 30) * 30)
        let key = "\(first)|\(last)|\(from)|\(to)"
        guard key != lastWindow else { return }; lastWindow = key
        onWindow(["first": first, "last": last, "from": from, "to": to])
    }
    private func updateChrome() {
        guard !channels.isEmpty else { return }
        let count = Int(ceil(collection.bounds.height / layout.row)) + 2
        while rails.count < count { let v = GuideRail(); railHost.addSubview(v); rails.append(v) }
        let first = max(0, Int(collection.contentOffset.y / layout.row))
        for (i, v) in rails.enumerated() {
            let index = first + i; v.isHidden = index >= channels.count || i >= count
            if !v.isHidden { v.frame = CGRect(x: 0, y: CGFloat(index) * layout.row - collection.contentOffset.y, width: rail, height: layout.row - 1); v.colours(chrome); v.show(channels[index]) }
        }
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

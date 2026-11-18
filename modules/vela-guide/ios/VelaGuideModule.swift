import ExpoModulesCore
import UIKit
import React

public final class VelaGuideModule: Module {
    public func definition() -> ModuleDefinition {
        Name("VelaGuide")
        View(VelaGuideRowView.self) {
            Events("onFocusProgramme", "onPressProgramme")
            Prop("drawing") { (view: VelaGuideRowView, drawing: [String: Any]) in view.drawRow(drawing) }
            Prop("selected") { (view: VelaGuideRowView, id: String) in view.select(id) }
        }

    }
}

private func colour(_ value: Any?) -> UIColor {
    if let number = value as? NSNumber {
        let n = UInt32(truncatingIfNeeded: number.int64Value)
        return UIColor(red: CGFloat((n >> 16) & 255) / 255, green: CGFloat((n >> 8) & 255) / 255,
                       blue: CGFloat(n & 255) / 255, alpha: CGFloat((n >> 24) & 255) / 255)
    }
    let raw = value as? String ?? ""
    if raw.hasPrefix("#") {
        var hex = String(raw.dropFirst())
        if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
        if hex.count == 6 { hex += "ff" }
        if hex.count == 8, let n = UInt64(hex, radix: 16) {
            return UIColor(red: CGFloat((n >> 24) & 255) / 255, green: CGFloat((n >> 16) & 255) / 255,
                           blue: CGFloat((n >> 8) & 255) / 255, alpha: CGFloat(n & 255) / 255)
        }
    }
    let numbers = raw.replacingOccurrences(of: "rgba(", with: "").replacingOccurrences(of: "rgb(", with: "")
        .replacingOccurrences(of: ")", with: "").split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    if numbers.count >= 3 { return UIColor(red: numbers[0] / 255, green: numbers[1] / 255, blue: numbers[2] / 255, alpha: numbers.count > 3 ? numbers[3] : 1) }
    return .clear
}

private let fonts = NSCache<NSString, UIFont>()
private func face(_ family: String?, size: NSNumber, weight: String) -> UIFont {
    let key = "\(family ?? "")|\(size)|\(weight)" as NSString
    if let cached = fonts.object(forKey: key) { return cached }
    let font = RCTFont.update(nil, withFamily: family, size: size, weight: weight, style: nil, variant: nil, scaleMultiplier: 1)
        ?? UIFont.systemFont(ofSize: size.doubleValue)
    fonts.countLimit = 32; fonts.setObject(font, forKey: key)
    return font
}

private struct Cell {
    let id: String, title: String, detail: String, label: String
    let rect: CGRect, tone: UIColor, ended: Bool, airing: Bool, elapsed: CGFloat
    init(_ raw: [String: Any], height: CGFloat) {
        id = raw["id"] as? String ?? ""; title = raw["title"] as? String ?? ""; detail = raw["detail"] as? String ?? ""
        label = raw["label"] as? String ?? ""; tone = colour(raw["tone"])
        ended = raw["ended"] as? Bool ?? false; airing = raw["airing"] as? Bool ?? false
        elapsed = (raw["elapsed"] as? NSNumber)?.doubleValue ?? 0
        rect = CGRect(x: (raw["x"] as? NSNumber)?.doubleValue ?? 0, y: 5,
                      width: max(2, (raw["width"] as? NSNumber)?.doubleValue ?? 2), height: max(0, height - 11))
    }
}

private final class ProgrammeElement: UIAccessibilityElement {
    var focus: (() -> Void)?
    var press: (() -> Void)?
    override func accessibilityElementDidBecomeFocused() { super.accessibilityElementDidBecomeFocused(); focus?() }
    override func accessibilityActivate() -> Bool { press?(); return true }
}

/** One passive view per recycled row. Bitmaps are prepared away from the UI thread. */
final class VelaGuideRowView: ExpoView {
    let onFocusProgramme = EventDispatcher()
    let onPressProgramme = EventDispatcher()
    private let picture = CALayer(), ring = CALayer()
    private var labels: [(cell: Cell, clip: CALayer, text: CALayer)] = []
    private var labelPool: [(clip: CALayer, text: CALayer)] = []
    private var cells: [Cell] = []
    private var generation = 0
    private var selected = "", channel = ""
    private var originX: CGFloat = 0
    private var radius: CGFloat = 0
    private weak var scroll: UIScrollView?
    private var observation: NSKeyValueObservation?
    private var work: DispatchWorkItem?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        isAccessibilityElement = false
        clipsToBounds = true
        layer.addSublayer(picture)
        ring.backgroundColor = UIColor.clear.cgColor
        ring.borderWidth = 2
        layer.addSublayer(ring)
    }

    deinit { work?.cancel(); observation?.invalidate() }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        observeScroll()
    }

    private func observeScroll() {
        observation?.invalidate(); observation = nil; scroll = nil
        guard window != nil else { return }
        var parent = superview
        while let view = parent {
            if let candidate = view as? UIScrollView, candidate.contentSize.width > candidate.bounds.width + 1 { scroll = candidate }
            parent = view.superview
        }
        observation = scroll?.observe(\.contentOffset, options: [.initial, .new]) { [weak self] _, _ in self?.positionLabels() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if scroll == nil { observeScroll() }
        positionLabels()
    }

    func select(_ id: String) {
        selected = id
        CATransaction.begin(); CATransaction.setDisableActions(true)
        if let cell = cells.first(where: { $0.id == id }) {
            ring.frame = cell.rect; ring.cornerRadius = radius; ring.isHidden = false
        } else { ring.isHidden = true }
        CATransaction.commit()
        for case let element as ProgrammeElement in accessibilityElements ?? [] {
            element.accessibilityTraits = element.accessibilityIdentifier == id ? [.button, .selected] : .button
        }
    }

    private func refreshAccessibility() {
        accessibilityElements = cells.map { cell -> ProgrammeElement in
            let element = ProgrammeElement(accessibilityContainer: self)
            element.accessibilityIdentifier = cell.id; element.accessibilityLabel = cell.label
            element.accessibilityFrameInContainerSpace = cell.rect; element.accessibilityTraits = cell.id == selected ? [.button, .selected] : .button
            element.focus = { [weak self] in self?.onFocusProgramme(["id": cell.id]) }
            element.press = { [weak self] in self?.onPressProgramme(["id": cell.id]) }
            return element
        }
    }

    func drawRow(_ raw: [String: Any]) {
        generation += 1
        let token = generation
        work?.cancel()
        let width = max(1, (raw["width"] as? NSNumber)?.doubleValue ?? 1)
        let height = max(1, (raw["height"] as? NSNumber)?.doubleValue ?? 1)
        originX = (raw["originX"] as? NSNumber)?.doubleValue ?? 0
        radius = (raw["radius"] as? NSNumber)?.doubleValue ?? 0
        let r = radius
        let nextChannel = raw["channelId"] as? String ?? ""
        let palette = raw["colours"] as? [String: Any] ?? [:]
        let colors = palette.mapValues(colour)
        let nextCells = (raw["cells"] as? [[String: Any]] ?? []).map { Cell($0, height: height) }
        let titleSize = (raw["titleSize"] as? NSNumber) ?? 18.2
        let detailSize = (raw["detailSize"] as? NSNumber) ?? 15.6
        let titleFont = face(raw["font"] as? String, size: titleSize, weight: "600")
        let boldFont = face(raw["boldFont"] as? String, size: titleSize, weight: "700")
        let detailFont = face(raw["font"] as? String, size: detailSize, weight: "400")
        let displayScale = window?.screen.scale ?? 2
        CATransaction.begin(); CATransaction.setDisableActions(true)
        picture.contents = nil
        picture.backgroundColor = colors["cell"]?.withAlphaComponent(0.5).cgColor
        picture.frame = CGRect(x: 0, y: 0, width: width, height: height)
        for entry in labelPool { entry.clip.isHidden = true; entry.text.contents = nil }
        labels.removeAll(keepingCapacity: true)
        channel = nextChannel; cells = nextCells
        ring.borderColor = colors["accent"]?.cgColor
        select(selected)
        refreshAccessibility()
        CATransaction.commit()

        let job = DispatchWorkItem { [weak self] in
            let format = UIGraphicsImageRendererFormat(); format.scale = displayScale; format.opaque = false; format.preferredRange = .standard
            let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { ctx in
                for cell in nextCells {
                    ctx.cgContext.saveGState(); ctx.cgContext.setAlpha(cell.ended ? 0.46 : 1)
                    let path = UIBezierPath(roundedRect: cell.rect.insetBy(dx: 0.5, dy: 0.5), cornerRadius: r)
                    (colors[cell.airing ? "live" : "cell"] ?? .clear).setFill(); path.fill()
                    (colors[cell.airing ? "liveEdge" : "edge"] ?? .clear).setStroke(); path.lineWidth = 1; path.stroke()
                    ctx.cgContext.saveGState(); path.addClip()
                    if cell.elapsed > 0 {
                        (colors["fill"] ?? .clear).setFill(); ctx.cgContext.fill(CGRect(x: cell.rect.minX, y: 5, width: cell.elapsed, height: height - 11))
                        (colors["accent"] ?? .clear).setFill(); ctx.cgContext.fill(CGRect(x: cell.rect.minX, y: height - 8, width: cell.elapsed, height: 2))
                    }
                    if cell.tone.cgColor.alpha > 0 {
                        cell.tone.withAlphaComponent(cell.ended ? 0.5 : 0.9).setFill()
                        UIBezierPath(roundedRect: CGRect(x: cell.rect.minX, y: 15, width: 3, height: max(0, height - 31)), cornerRadius: 1.5).fill()
                    }
                    ctx.cgContext.restoreGState(); ctx.cgContext.restoreGState()
                }
            }
            let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail
            let textures: [(Cell, CGImage?, CGSize)] = nextCells.filter { !$0.title.isEmpty }.map { cell in
                let size = CGSize(width: max(1, min(width, cell.rect.width - 24)), height: height - 11)
                let texture = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                    let title = [NSAttributedString.Key.font: cell.airing ? boldFont : titleFont, .foregroundColor: colors["ink"] ?? .white, .paragraphStyle: paragraph] as [NSAttributedString.Key: Any]
                    let detail = [NSAttributedString.Key.font: detailFont, .foregroundColor: colors[cell.airing ? "accent" : "secondary"] ?? .white, .paragraphStyle: paragraph] as [NSAttributedString.Key: Any]
                    let titleHeight = titleFont.lineHeight, detailHeight = cell.detail.isEmpty ? 0 : detailFont.lineHeight + 5
                    let y = (size.height - titleHeight - detailHeight) / 2
                    (cell.title as NSString).draw(in: CGRect(x: 0, y: y, width: size.width, height: titleHeight + 1), withAttributes: title)
                    if !cell.detail.isEmpty { (cell.detail as NSString).draw(in: CGRect(x: 0, y: y + titleHeight + 5, width: size.width, height: detailFont.lineHeight + 1), withAttributes: detail) }
                }
                return (cell, texture.preparingForDisplay()?.cgImage ?? texture.cgImage, texture.size)
            }
            let background = image.preparingForDisplay()?.cgImage ?? image.cgImage
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == token else { return }
                if self.scroll == nil { self.observeScroll() }
                CATransaction.begin(); CATransaction.setDisableActions(true)
                self.picture.contents = background; self.picture.backgroundColor = nil
                for (index, entry) in textures.enumerated() {
                    let (cell, texture, size) = entry
                    if index == self.labelPool.count {
                        let clip = CALayer(), text = CALayer()
                        clip.addSublayer(text); self.layer.insertSublayer(clip, below: self.ring)
                        self.labelPool.append((clip, text))
                    }
                    let (clip, text) = self.labelPool[index]
                    clip.frame = cell.rect; clip.masksToBounds = true; clip.opacity = cell.ended ? 0.46 : 1
                    clip.isHidden = false
                    text.contents = texture; text.contentsScale = displayScale; text.frame = CGRect(origin: .zero, size: size)
                    self.labels.append((cell, clip, text))
                }
                self.positionLabels(); CATransaction.commit()
            }
        }
        work = job
        DispatchQueue.global(qos: .userInitiated).async(execute: job)
    }

    private func positionLabels() {
        let left = (scroll?.contentOffset.x ?? originX) - originX
        CATransaction.begin(); CATransaction.setDisableActions(true)
        for entry in labels {
            let shift = min(max(0, left - entry.cell.rect.minX), max(0, entry.cell.rect.width - 120))
            if entry.text.frame.origin.x != 12 + shift { entry.text.frame.origin = CGPoint(x: 12 + shift, y: 0) }
        }
        CATransaction.commit()
    }
}

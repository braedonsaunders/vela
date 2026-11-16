// An original's subtitle streams. Every subtitle stream's packets are kept as they are read
// (they are small), so choosing a track shows what is on screen now, not only what is read next.
// The chosen stream is decoded by VelaMedia (PGS, DVD and DVB bitmaps; SubRip, ASS, tx3g text).
import CoreGraphics
import Foundation
import VelaMedia

final class VelaEmbeddedSubtitles: @unchecked Sendable {
    private let lock = NSLock()
    private var packets: [Int: [VelaDemuxPacket]] = [:]
    private var selected: Int?
    private var decoder: OpaquePointer?
    private var decodedCount = 0
    private var cues: [VelaCue] = []
    private var canvas = CGSize.zero
    private let keptPackets = 4000
    private let keptCues = 2000

    deinit {
        if let decoder {
            vm_subtitle_close(decoder)
        }
    }

    var streamIndex: Int? {
        lock.lock()
        defer { lock.unlock() }
        return selected
    }

    /// Keeps a packet of any subtitle stream; decodes it when its stream is the chosen one.
    func keep(_ packet: VelaDemuxPacket) {
        lock.lock()
        defer { lock.unlock() }
        var list = packets[packet.stream, default: []]
        list.append(packet)
        if list.count > keptPackets {
            let dropped = list.count - keptPackets
            list.removeFirst(dropped)
            if packet.stream == selected {
                decodedCount = max(0, decodedCount - dropped)
            }
        }
        packets[packet.stream] = list
        if packet.stream == selected {
            decodePending()
        }
    }

    /// Chooses a stream (nil: off) and decodes what was already read of it.
    func select(_ stream: Int?, demuxer: OpaquePointer?) {
        lock.lock()
        defer { lock.unlock() }
        guard stream != selected else {
            return
        }
        selected = stream
        if let decoder {
            vm_subtitle_close(decoder)
        }
        decoder = nil
        cues.removeAll()
        decodedCount = 0
        if let stream, let demuxer {
            decoder = vm_subtitle_open(demuxer, Int32(stream), nil, 0)
            decodePending()
        }
    }

    /// The cue to show at `time`.
    func cue(at time: Double) -> VelaCue? {
        lock.lock()
        defer { lock.unlock() }
        return cues.last { $0.start <= time && time < $0.end }
    }

    // MARK: Decoding (under `lock`)

    private func decodePending() {
        guard let selected, let decoder, let list = packets[selected] else {
            return
        }
        if decodedCount > list.count {
            decodedCount = 0
        }
        for packet in list[decodedCount...] {
            decode(packet, with: decoder)
        }
        decodedCount = list.count
        if cues.count > keptCues {
            cues.removeFirst(cues.count - keptCues)
        }
    }

    private func decode(_ packet: VelaDemuxPacket, with decoder: OpaquePointer) {
        var subtitle = VMSubtitle()
        let result = packet.data.withUnsafeBytes { raw in
            let bytes = raw.bindMemory(to: UInt8.self).baseAddress
            return vm_subtitle_decode(decoder, bytes, Int32(packet.data.count), packet.pts, packet.duration, &subtitle)
        }
        guard result == 0 else {
            return
        }
        if subtitle.canvas_width > 0 && subtitle.canvas_height > 0 {
            canvas = CGSize(width: Int(subtitle.canvas_width), height: Int(subtitle.canvas_height))
        }
        // An open cue ends where the next begins (PGS clears the screen with an empty one).
        if let last = cues.indices.last, cues[last].start < subtitle.start, cues[last].end > subtitle.start {
            cues[last].end = subtitle.start
        }
        guard subtitle.count > 0, let cue = cue(from: subtitle) else {
            return
        }
        cues.append(cue)
    }

    private func cue(from subtitle: VMSubtitle) -> VelaCue? {
        var lines: [String] = []
        var bitmaps: [VelaBitmap] = []
        for index in 0..<Int(subtitle.count) {
            let rect = subtitle.rects[index]
            if let text = rect.text {
                lines.append(VelaSubtitleText.plain(String(cString: text), ass: rect.ass != 0))
            } else if let rgba = rect.rgba {
                let width = Int(rect.width)
                let height = Int(rect.height)
                if let image = VelaSubtitleText.image(rgba, width: width, height: height) {
                    let frame = CGRect(x: Int(rect.x), y: Int(rect.y), width: width, height: height)
                    bitmaps.append(VelaBitmap(image: image, frame: frame))
                }
            }
        }
        let end = subtitle.end.isFinite ? subtitle.end : .infinity
        if !bitmaps.isEmpty {
            return VelaCue(start: subtitle.start, end: end, content: .bitmaps(bitmaps, canvas: canvas))
        }
        let text = lines.filter { !$0.isEmpty }.joined(separator: "\n")
        return text.isEmpty ? nil : VelaCue(start: subtitle.start, end: end, content: .text(text))
    }
}

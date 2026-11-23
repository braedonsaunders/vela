// ASS/SSA subtitles drawn as authored (positions, styles, colours, outlines, karaoke, embedded fonts) by
// libass, built by ass/build.sh. AetherEngine hands over the raw event lines (`preserveASSMarkup`), the
// track's script header and the container's fonts; this composites libass's bitmaps into one image laid
// over the picture. A build without the libass frameworks keeps drawing ASS as plain text.
import AetherEngine
import CoreGraphics
import Foundation

#if canImport(Libass)
import Libass

@MainActor
final class ASSSubtitles {
    static var isAvailable: Bool { true }

    private let library: OpaquePointer
    private let renderer: OpaquePointer
    private var track: UnsafeMutablePointer<ASS_Track>?
    private var trackKey = ""
    private var fed = Set<String>()
    private var fontsLoaded = 0
    private var size = CGSize.zero
    private var image: (CGImage, CGRect)?

    init?() {
        guard let library = ass_library_init() else { return nil }
        guard let renderer = ass_renderer_init(library) else { ass_library_done(library); return nil }
        self.library = library
        self.renderer = renderer
        ass_set_extract_fonts(library, 1)
        ass_set_fonts(renderer, nil, "Helvetica Neue", Int32(ASS_FONTPROVIDER_AUTODETECT.rawValue), nil, 1)
    }

    deinit {
        if let track { ass_free_track(track) }
        ass_renderer_done(renderer)
        ass_library_done(library)
    }

    /// The image for `time` over a picture of `pixels` and where it sits there (in pixels), or nil when
    /// nothing shows. `key` names the track: a
    /// new one starts a new libass track with its own header. Cues are the engine's raw event lines; each is
    /// fed once and stays in the track, so passing the cues showing now is enough.
    func render(key: String, header: String, fonts: [FontAttachment], cues: [SubtitleCue], time: Double,
                pixels: CGSize, storage: CGSize) -> (CGImage, CGRect)? {
        if key != trackKey { reset(key: key, header: header) }
        if fonts.count > fontsLoaded {
            for font in fonts[fontsLoaded...] {
                font.data.withUnsafeBytes { bytes in
                    guard let base = bytes.baseAddress else { return }
                    ass_add_font(library, font.filename, UnsafeMutableRawPointer(mutating: base).assumingMemoryBound(to: CChar.self), Int32(bytes.count))
                }
            }
            fontsLoaded = fonts.count
            ass_set_fonts(renderer, nil, "Helvetica Neue", Int32(ASS_FONTPROVIDER_AUTODETECT.rawValue), nil, 1)
        }
        guard let track else { return nil }
        for cue in cues {
            guard case .text(let raw) = cue.body else { continue }
            let start = Int64((cue.startTime * 1000).rounded())
            let duration = max(1, Int64(((cue.endTime - cue.startTime) * 1000).rounded()))
            for line in raw.split(separator: "\n", omittingEmptySubsequences: true) {
                let fields = line.split(separator: ",", maxSplits: 8, omittingEmptySubsequences: false)
                guard fields.count == 9, Int(fields[0]) != nil else { continue }
                let id = "\(start)|\(duration)|\(line)"
                guard fed.insert(id).inserted else { continue }
                var bytes = Array(line.utf8)
                bytes.withUnsafeMutableBufferPointer { buffer in
                    buffer.baseAddress!.withMemoryRebound(to: CChar.self, capacity: buffer.count) {
                        ass_process_chunk(track, $0, Int32(buffer.count), start, duration)
                    }
                }
            }
        }
        let width = Int(pixels.width.rounded()), height = Int(pixels.height.rounded())
        guard width > 0, height > 0 else { return nil }
        if pixels != size {
            size = pixels
            image = nil
            ass_set_frame_size(renderer, Int32(width), Int32(height))
            ass_set_storage_size(renderer, Int32(storage.width), Int32(storage.height))
        }
        var change: Int32 = 0
        let first = ass_render_frame(renderer, track, Int64((time * 1000).rounded()), &change)
        if change == 0, image != nil || first == nil { return first == nil ? nil : image }
        image = first.flatMap { composite($0, width: width, height: height) }
        return image
    }

    private func reset(key: String, header: String) {
        if let track { ass_free_track(track) }
        trackKey = key
        fed.removeAll()
        image = nil
        track = ass_new_track(library)
        guard let track else { return }
        // Real files repeat ReadOrder 0 on every event; duplicates are dropped here by content instead.
        ass_set_check_readorder(track, 0)
        // Matroska CodecPrivate is often NUL-terminated, and libass stops reading at a NUL.
        var bytes = Array(header.replacingOccurrences(of: "\0", with: "").utf8)
        bytes.withUnsafeMutableBufferPointer { buffer in
            buffer.baseAddress!.withMemoryRebound(to: CChar.self, capacity: buffer.count) {
                ass_process_codec_private(track, $0, Int32(buffer.count))
            }
        }
    }

    /// libass's alpha masks, each tinted by its colour, blended into one premultiplied BGRA image.
    private func composite(_ first: UnsafeMutablePointer<ASS_Image>, width: Int, height: Int) -> (CGImage, CGRect)? {
        var minX = width, minY = height, maxX = 0, maxY = 0
        var node: UnsafeMutablePointer<ASS_Image>? = first
        while let image = node?.pointee {
            if image.w > 0, image.h > 0 {
                minX = min(minX, Int(image.dst_x)); minY = min(minY, Int(image.dst_y))
                maxX = max(maxX, Int(image.dst_x + image.w)); maxY = max(maxY, Int(image.dst_y + image.h))
            }
            node = image.next
        }
        minX = max(0, minX); minY = max(0, minY); maxX = min(width, maxX); maxY = min(height, maxY)
        guard maxX > minX, maxY > minY else { return nil }
        // Only the box the images cover: karaoke and fades change every frame.
        let boxWidth = maxX - minX, boxHeight = maxY - minY
        let stride = boxWidth * 4
        var pixels = [UInt8](repeating: 0, count: stride * boxHeight)
        node = first
        while let image = node?.pointee {
            let red = UInt32((image.color >> 24) & 0xFF), green = UInt32((image.color >> 16) & 0xFF)
            let blue = UInt32((image.color >> 8) & 0xFF), opacity = 255 - UInt32(image.color & 0xFF)
            for row in 0..<Int(image.h) {
                let y = Int(image.dst_y) + row - minY
                guard y >= 0, y < boxHeight else { continue }
                for column in 0..<Int(image.w) {
                    let x = Int(image.dst_x) + column - minX
                    guard x >= 0, x < boxWidth else { continue }
                    let coverage = UInt32(image.bitmap[row * Int(image.stride) + column]) * opacity / 255
                    guard coverage > 0 else { continue }
                    let o = y * stride + x * 4
                    let keep = 255 - coverage
                    pixels[o] = UInt8((blue * coverage + UInt32(pixels[o]) * keep) / 255)
                    pixels[o + 1] = UInt8((green * coverage + UInt32(pixels[o + 1]) * keep) / 255)
                    pixels[o + 2] = UInt8((red * coverage + UInt32(pixels[o + 2]) * keep) / 255)
                    pixels[o + 3] = UInt8(coverage + UInt32(pixels[o + 3]) * keep / 255)
                }
            }
            node = image.next
        }
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        guard let provider = CGDataProvider(data: Data(pixels) as CFData) else { return nil }
        guard let picture = CGImage(width: boxWidth, height: boxHeight, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: stride,
                                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: info, provider: provider,
                                    decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { return nil }
        return (picture, CGRect(x: minX, y: minY, width: boxWidth, height: boxHeight))
    }
}
#else
@MainActor
final class ASSSubtitles {
    static var isAvailable: Bool { false }
    init?() { return nil }
    func render(key: String, header: String, fonts: [FontAttachment], cues: [SubtitleCue], time: Double,
                pixels: CGSize, storage: CGSize) -> (CGImage, CGRect)? { nil }
}
#endif

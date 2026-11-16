// An original's audio stream on its way to AVSampleBufferAudioRenderer. AC-3 and E-AC-3 go to
// tvOS as they are: it decodes them, and hands Dolby Atmos in E-AC-3 to an Atmos sink as the
// platform allows. Everything else (DTS, DTS-HD MA, TrueHD, AAC, FLAC, Opus, PCM ...) is decoded
// by VelaMedia's FFmpeg to interleaved float PCM in the stream's own channel layout.
import AVFoundation
import CoreMedia
import Foundation
import VelaMedia

/// A sample buffer for the renderer and the media time it reaches.
struct VelaAudioSample {
    let buffer: CMSampleBuffer
    let end: Double
    let bytes: Int
}

final class VelaAudioPath {
    let stream: VelaStream
    private let compressed: (format: CMAudioFormatDescription, rate: Double)?
    private let decoder: OpaquePointer?
    private var pcmFormat: CMAudioFormatDescription?
    private var pcmKey = ""
    private let framesPerPacket = 1536

    /// `decode` forces FFmpeg decoding of a stream tvOS refused compressed.
    init(stream: VelaStream, demuxer: VelaDemuxer, decode: Bool) throws {
        self.stream = stream
        let native = decode ? nil : VelaAudioPath.compressedFormat(stream)
        compressed = native
        if native == nil {
            var error = [CChar](repeating: 0, count: 256)
            guard let decoder = vm_audio_open(demuxer.handle, Int32(stream.index), &error, Int32(error.count)) else {
                throw VelaDemuxer.Failure.open("\(stream.codec) audio: \(String(cString: error))")
            }
            self.decoder = decoder
        } else {
            decoder = nil
        }
    }

    deinit {
        if let decoder {
            vm_audio_close(decoder)
        }
    }

    var isDecoded: Bool {
        decoder != nil
    }

    var description: String {
        isDecoded ? "\(stream.codec) → PCM" : stream.codec
    }

    func flush() {
        if let decoder {
            vm_audio_flush(decoder)
        }
    }

    /// The samples a packet yields, without those that end before `dropBefore`.
    func samples(for packet: VelaDemuxPacket, dropBefore: Double) -> [VelaAudioSample] {
        if let compressed {
            return passthrough(packet, compressed.format, compressed.rate, dropBefore)
        }
        return decoded(packet, dropBefore)
    }

    private func passthrough(
        _ packet: VelaDemuxPacket, _ format: CMAudioFormatDescription, _ rate: Double, _ dropBefore: Double
    ) -> [VelaAudioSample] {
        guard packet.pts.isFinite else {
            return []
        }
        let end = packet.pts + Double(framesPerPacket) / rate
        guard end >= dropBefore else {
            return []
        }
        let buffer = VelaSampleBuffers.audioPacket(packet.data, format: format, pts: packet.pts, rate: rate)
        guard let buffer else {
            return []
        }
        return [VelaAudioSample(buffer: buffer, end: end, bytes: packet.data.count)]
    }

    private func decoded(_ packet: VelaDemuxPacket, _ dropBefore: Double) -> [VelaAudioSample] {
        guard let decoder else {
            return []
        }
        _ = packet.data.withUnsafeBytes { raw in
            vm_audio_send(decoder, raw.bindMemory(to: UInt8.self).baseAddress, Int32(packet.data.count), packet.pts)
        }
        var out: [VelaAudioSample] = []
        var frame = VMAudioFrame()
        while vm_audio_receive(decoder, &frame) == 0 {
            guard frame.frames > 0, frame.pts.isFinite else {
                continue
            }
            let end = frame.pts + Double(frame.frames) / Double(frame.sample_rate)
            guard end >= dropBefore, let format = pcmFormat(for: frame) else {
                continue
            }
            let bytes = Int(frame.frames) * Int(frame.channels) * 4
            let data = Data(bytes: frame.samples, count: bytes)
            let rate = Int(frame.sample_rate)
            let frames = Int(frame.frames)
            if let buffer = VelaSampleBuffers.pcm(data, format: format, pts: frame.pts, frames: frames, rate: rate) {
                out.append(VelaAudioSample(buffer: buffer, end: end, bytes: bytes))
            }
        }
        return out
    }

    private func pcmFormat(for frame: VMAudioFrame) -> CMAudioFormatDescription? {
        let key = "\(frame.channels):\(frame.sample_rate):\(frame.channel_mask)"
        if key != pcmKey {
            pcmFormat = VelaAudioPath.pcmFormat(
                channels: Int(frame.channels),
                sampleRate: Int(frame.sample_rate),
                mask: frame.channel_mask
            )
            pcmKey = key
        }
        return pcmFormat
    }

    // MARK: Formats

    private static func compressedFormat(_ stream: VelaStream) -> (format: CMAudioFormatDescription, rate: Double)? {
        let formatID: AudioFormatID
        switch stream.codec {
        case "ac3": formatID = kAudioFormatAC3
        case "eac3": formatID = kAudioFormatEnhancedAC3
        default: return nil
        }
        let rate = Double(stream.info.sample_rate)
        guard rate > 0, stream.info.channels > 0 else {
            return nil
        }
        var asbd = AudioStreamBasicDescription(
            mSampleRate: rate,
            mFormatID: formatID,
            mFormatFlags: 0,
            mBytesPerPacket: 0,
            mFramesPerPacket: 1536,
            mBytesPerFrame: 0,
            mChannelsPerFrame: UInt32(stream.info.channels),
            mBitsPerChannel: 0,
            mReserved: 0
        )
        var format: CMAudioFormatDescription?
        let status = CMAudioFormatDescriptionCreate(
            allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil,
            magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format
        )
        guard status == noErr, let format else {
            return nil
        }
        return (format, rate)
    }

    /// Interleaved float PCM in FFmpeg's channel order, labelled for Core Audio.
    static func pcmFormat(channels: Int, sampleRate: Int, mask: UInt64) -> CMAudioFormatDescription? {
        var asbd = AudioStreamBasicDescription(
            mSampleRate: Double(sampleRate),
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: UInt32(4 * channels),
            mFramesPerPacket: 1,
            mBytesPerFrame: UInt32(4 * channels),
            mChannelsPerFrame: UInt32(channels),
            mBitsPerChannel: 32,
            mReserved: 0
        )
        let labels = VelaChannelLabels.labels(channels: channels, mask: mask)
        let extraDescriptions = max(0, labels.count - 1)
        let size = MemoryLayout<AudioChannelLayout>.size + extraDescriptions * MemoryLayout<AudioChannelDescription>.size
        let alignment = MemoryLayout<AudioChannelLayout>.alignment
        let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: alignment)
        defer { raw.deallocate() }
        memset(raw, 0, size)
        let layout = raw.assumingMemoryBound(to: AudioChannelLayout.self)
        layout.pointee.mChannelLayoutTag = kAudioChannelLayoutTag_UseChannelDescriptions
        layout.pointee.mNumberChannelDescriptions = UInt32(labels.count)
        let offset = MemoryLayout<AudioChannelLayout>.offset(of: \AudioChannelLayout.mChannelDescriptions)!
        let descriptions = raw.advanced(by: offset).assumingMemoryBound(to: AudioChannelDescription.self)
        for (index, label) in labels.enumerated() {
            descriptions[index].mChannelLabel = label
        }
        var format: CMAudioFormatDescription?
        let status = CMAudioFormatDescriptionCreate(
            allocator: nil, asbd: &asbd, layoutSize: size, layout: layout,
            magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format
        )
        return status == noErr ? format : nil
    }
}

/// FFmpeg's channel mask bits (its order) as Core Audio channel labels.
enum VelaChannelLabels {
    private static let bits: [(mask: UInt64, label: AudioChannelLabel)] = [
        (1 << 0, kAudioChannelLabel_Left),
        (1 << 1, kAudioChannelLabel_Right),
        (1 << 2, kAudioChannelLabel_Center),
        (1 << 3, kAudioChannelLabel_LFEScreen),
        (1 << 4, kAudioChannelLabel_RearSurroundLeft),
        (1 << 5, kAudioChannelLabel_RearSurroundRight),
        (1 << 6, kAudioChannelLabel_LeftCenter),
        (1 << 7, kAudioChannelLabel_RightCenter),
        (1 << 8, kAudioChannelLabel_CenterSurround),
        (1 << 9, kAudioChannelLabel_LeftSurround),
        (1 << 10, kAudioChannelLabel_RightSurround),
        (1 << 11, kAudioChannelLabel_TopCenterSurround),
        (1 << 12, kAudioChannelLabel_VerticalHeightLeft),
        (1 << 13, kAudioChannelLabel_VerticalHeightCenter),
        (1 << 14, kAudioChannelLabel_VerticalHeightRight),
        (1 << 15, kAudioChannelLabel_TopBackLeft),
        (1 << 16, kAudioChannelLabel_TopBackCenter),
        (1 << 17, kAudioChannelLabel_TopBackRight),
    ]

    static func labels(channels: Int, mask: UInt64) -> [AudioChannelLabel] {
        var labels = bits.filter { mask & $0.mask != 0 }.map(\.label)
        let hasSidePair = mask & (1 << 9) != 0
        if !hasSidePair {
            // A back pair without a side pair: Core Audio's 5.1 calls them the surrounds.
            labels = labels.map { label in
                switch label {
                case kAudioChannelLabel_RearSurroundLeft: return kAudioChannelLabel_LeftSurround
                case kAudioChannelLabel_RearSurroundRight: return kAudioChannelLabel_RightSurround
                default: return label
                }
            }
        }
        if labels.count == channels {
            return labels
        }
        switch channels {
        case 1: return [kAudioChannelLabel_Mono]
        case 2: return [kAudioChannelLabel_Left, kAudioChannelLabel_Right]
        default: return (0..<channels).map { AudioChannelLabel(kAudioChannelLabel_Discrete_0 | UInt32($0)) }
        }
    }
}

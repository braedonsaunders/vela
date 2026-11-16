// VelaMedia's demuxer over a range reader, and the CoreMedia formats of its streams:
// H.264/HEVC (with HDR10, HLG and Dolby Vision configuration) for VideoToolbox through
// AVSampleBufferDisplayLayer, AC-3/E-AC-3 for tvOS's own audio path, PCM for the rest.
import AVFoundation
import CoreMedia
import Foundation
import VelaMedia

struct VelaStream {
    let info: VMStreamInfo
    var index: Int { Int(info.index) }
    var codec: String { withUnsafeBytes(of: info.codec) { String(cString: $0.bindMemory(to: CChar.self).baseAddress!) } }
    var language: String { withUnsafeBytes(of: info.language) { String(cString: $0.bindMemory(to: CChar.self).baseAddress!) } }
    var title: String { withUnsafeBytes(of: info.title) { String(cString: $0.bindMemory(to: CChar.self).baseAddress!) } }
    var extradata: Data { info.extradata.map { Data(bytes: $0, count: Int(info.extradata_size)) } ?? Data() }
    var isVideo: Bool { info.type == Int32(VM_VIDEO) && info.is_attached_pic == 0 }
    var isAudio: Bool { info.type == Int32(VM_AUDIO) }
    var isSubtitle: Bool { info.type == Int32(VM_SUBTITLE) }
}

struct VelaDemuxPacket {
    let stream: Int
    let pts: Double
    let dts: Double
    let duration: Double
    let keyframe: Bool
    let data: Data
}

final class VelaDemuxer: @unchecked Sendable {
    enum Failure: Error, CustomStringConvertible {
        case open(String)
        var description: String { switch self { case .open(let why): return why } }
    }
    let reader: VelaRangeReader
    let handle: OpaquePointer
    let streams: [VelaStream]
    let container: String
    let duration: Double?

    init(reader: VelaRangeReader) throws {
        self.reader = reader
        var error = [CChar](repeating: 0, count: 256)
        let opaque = Unmanaged.passUnretained(reader).toOpaque()
        guard let handle = vm_open(opaque, { opaque, buffer, size in
            guard let opaque, let buffer else { return -1 }
            return Int32(Unmanaged<VelaRangeReader>.fromOpaque(opaque).takeUnretainedValue().read(into: buffer, size: Int(size)))
        }, { opaque, offset, whence in
            guard let opaque else { return -1 }
            return Unmanaged<VelaRangeReader>.fromOpaque(opaque).takeUnretainedValue().seek(offset: offset, whence: whence)
        }, &error, Int32(error.count)) else {
            throw Failure.open(String(cString: error))
        }
        self.handle = handle
        streams = (0..<vm_stream_count(handle)).compactMap { index in
            var info = VMStreamInfo()
            return vm_stream_info(handle, index, &info) == 0 ? VelaStream(info: info) : nil
        }
        container = String(cString: vm_container(handle))
        let seconds = vm_duration(handle)
        duration = seconds.isFinite && seconds > 0 ? seconds : nil
    }

    func enable(_ wanted: Set<Int>) {
        for stream in streams { vm_enable_stream(handle, Int32(stream.index), wanted.contains(stream.index) ? 1 : 0) }
    }

    /// The next packet, nil at the end; throws on a read failure.
    func read() throws -> VelaDemuxPacket? {
        var packet = VMPacket()
        let r = vm_read(handle, &packet)
        if r == 1 { return nil }
        if r < 0 { throw Failure.open("The media could not be read (\(r))") }
        let data = packet.data.map { Data(bytes: $0, count: Int(packet.size)) } ?? Data()
        return VelaDemuxPacket(stream: Int(packet.stream), pts: packet.pts, dts: packet.dts, duration: packet.duration, keyframe: packet.keyframe != 0, data: data)
    }

    func seek(to seconds: Double) -> Bool { vm_seek(handle, seconds) == 0 }
    func interrupt(_ on: Bool) { vm_interrupt(handle, on ? 1 : 0) }

    deinit { vm_close(handle) }
}

// MARK: - Video

/// How a video stream's samples reach VideoToolbox.
struct VelaVideoFormat {
    let description: CMVideoFormatDescription
    /// Annex B input (MPEG-TS): start codes become 4-byte lengths.
    let annexB: Bool
    /// Dolby Vision layers to strip before decode (a profile 7 enhancement layer, or the
    /// RPU when presenting the HDR10 base layer).
    let stripNALTypes: Set<UInt8>
    let dynamicRange: String   // "sdr" | "hdr10" | "hlg" | "dv"
    let codec: String          // "h264" | "hevc"
    let frameRate: Double

    enum Failure: Error { case unsupported(String) }

    /// `dolbyVision` false presents a DV stream's base layer (HDR10/SDR/HLG).
    static func make(_ stream: VelaStream, firstPacket: Data?, dolbyVision: Bool) throws -> VelaVideoFormat {
        let info = stream.info
        let codec = stream.codec
        guard codec == "h264" || codec == "hevc" else { throw Failure.unsupported("\(codec) video is not decoded on this device") }
        var config = stream.extradata
        var annexB = false
        if config.isEmpty || config.starts(with: [0, 0, 1]) || config.starts(with: [0, 0, 0, 1]) {
            // Annex B: the parameter sets come from the configuration or the first keyframe.
            annexB = true
            let source = config.isEmpty ? (firstPacket ?? Data()) : config
            config = codec == "hevc" ? try hvcC(fromAnnexB: source) : try avcC(fromAnnexB: source)
        }
        let transfer = info.color_trc
        var range = transfer == 16 ? "hdr10" : transfer == 18 ? "hlg" : "sdr" // AVCOL_TRC_SMPTE2084, ARIB_STD_B67
        var codecType = codec == "hevc" ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264
        var atoms: [String: Any] = [(codec == "hevc" ? "hvcC" : "avcC"): config]
        var strip: Set<UInt8> = []
        if codec == "hevc" && info.dv_present != 0 {
            let profile = Int(info.dv_profile)
            if dolbyVision && (profile == 5 || profile == 8) && info.dv_rpu_present != 0 {
                codecType = kCMVideoCodecType_DolbyVisionHEVC
                atoms[profile > 7 ? "dvvC" : "dvcC"] = dvConfig(info)
                range = "dv"
            } else {
                // Profile 7's enhancement layer and every RPU go; the base layer stays.
                strip = [62, 63]
                if profile == 5 { throw Failure.unsupported("Dolby Vision profile 5 has no base layer this display can show") }
            }
        }
        var extensions: [CFString: Any] = [kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms: atoms]
        if let primaries = colourPrimaries(info.color_primaries) { extensions[kCMFormatDescriptionExtension_ColorPrimaries] = primaries }
        if let function = transferFunction(transfer) { extensions[kCMFormatDescriptionExtension_TransferFunction] = function }
        if let matrix = yCbCrMatrix(info.color_space) { extensions[kCMFormatDescriptionExtension_YCbCrMatrix] = matrix }
        if info.color_range == 2 { extensions[kCMFormatDescriptionExtension_FullRangeVideo] = true } // AVCOL_RANGE_JPEG
        if info.has_mastering != 0 { extensions[kCMFormatDescriptionExtension_MasteringDisplayColorVolume] = withUnsafeBytes(of: info.mastering) { Data($0) } }
        if info.has_light_level != 0 { extensions[kCMFormatDescriptionExtension_ContentLightLevelInfo] = withUnsafeBytes(of: info.light_level) { Data($0) } }
        if info.sar_num > 0 && info.sar_den > 0 && info.sar_num != info.sar_den {
            extensions[kCMFormatDescriptionExtension_PixelAspectRatio] = [kCMFormatDescriptionKey_PixelAspectRatioHorizontalSpacing: Int(info.sar_num), kCMFormatDescriptionKey_PixelAspectRatioVerticalSpacing: Int(info.sar_den)]
        }
        if Int(info.bits_per_raw_sample) > 8 { extensions[kCMFormatDescriptionExtension_BitsPerComponent] = Int(info.bits_per_raw_sample) }
        var description: CMVideoFormatDescription?
        let status = CMVideoFormatDescriptionCreate(allocator: nil, codecType: codecType, width: info.width, height: info.height, extensions: extensions as CFDictionary, formatDescriptionOut: &description)
        guard status == noErr, let description else { throw Failure.unsupported("The video configuration was refused (\(status))") }
        return VelaVideoFormat(description: description, annexB: annexB, stripNALTypes: strip, dynamicRange: range, codec: codec, frameRate: info.frame_rate)
    }

    /// One packet as VideoToolbox takes it: 4-byte NAL lengths, without stripped layers.
    func sampleData(_ packet: Data) -> Data {
        if !annexB && stripNALTypes.isEmpty { return packet }
        let units = annexB ? VelaVideoFormat.annexBUnits(packet) : VelaVideoFormat.lengthPrefixedUnits(packet)
        var out = Data(capacity: packet.count + 16)
        for unit in units where !unit.isEmpty {
            let type = codec == "hevc" ? (unit[unit.startIndex] >> 1) & 0x3f : unit[unit.startIndex] & 0x1f
            if stripNALTypes.contains(type) { continue }
            var length = UInt32(unit.count).bigEndian
            out.append(Data(bytes: &length, count: 4))
            out.append(unit)
        }
        return out
    }

    static func annexBUnits(_ data: Data) -> [Data] {
        var units: [Data] = []
        let bytes = [UInt8](data)
        var i = 0, start = -1
        while i + 2 < bytes.count {
            if bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 1 {
                if start >= 0 {
                    var end = i
                    while end > start && bytes[end - 1] == 0 { end -= 1 }
                    units.append(Data(bytes[start..<end]))
                }
                i += 3; start = i
            } else { i += 1 }
        }
        if start >= 0 && start < bytes.count { units.append(Data(bytes[start...])) }
        return units
    }

    static func lengthPrefixedUnits(_ data: Data) -> [Data] {
        var units: [Data] = []
        var i = data.startIndex
        while i + 4 <= data.endIndex {
            let length = Int(data[i]) << 24 | Int(data[i + 1]) << 16 | Int(data[i + 2]) << 8 | Int(data[i + 3])
            let start = i + 4, end = start + length
            guard length > 0, end <= data.endIndex else { break }
            units.append(data.subdata(in: start..<end))
            i = end
        }
        return units
    }

    private static func avcC(fromAnnexB data: Data) throws -> Data {
        let units = annexBUnits(data)
        guard let sps = units.first(where: { !$0.isEmpty && $0[$0.startIndex] & 0x1f == 7 }), sps.count >= 4,
              let pps = units.first(where: { !$0.isEmpty && $0[$0.startIndex] & 0x1f == 8 }) else { throw Failure.unsupported("The H.264 stream has no parameter sets yet") }
        var out = Data([1, sps[sps.startIndex + 1], sps[sps.startIndex + 2], sps[sps.startIndex + 3], 0xff, 0xe1])
        out.append(contentsOf: [UInt8(sps.count >> 8), UInt8(sps.count & 0xff)]); out.append(sps)
        out.append(1); out.append(contentsOf: [UInt8(pps.count >> 8), UInt8(pps.count & 0xff)]); out.append(pps)
        return out
    }

    /// A minimal hvcC from Annex B parameter sets: VideoToolbox reads the arrays and
    /// re-derives the profile from the SPS.
    private static func hvcC(fromAnnexB data: Data) throws -> Data {
        let units = annexBUnits(data)
        let of = { (type: UInt8) in units.filter { $0.count > 2 && ($0[$0.startIndex] >> 1) & 0x3f == type } }
        let vps = of(32), sps = of(33), pps = of(34)
        guard let first = sps.first, first.count > 14, !vps.isEmpty, !pps.isEmpty else { throw Failure.unsupported("The HEVC stream has no parameter sets yet") }
        // profile_tier_level follows the 2-byte NAL header and one byte of the SPS.
        let ptl = [UInt8](first[(first.startIndex + 3)..<(first.startIndex + 15)])
        var out = Data([1])
        out.append(contentsOf: ptl[0..<1])            // profile space, tier, profile idc
        out.append(contentsOf: ptl[1..<5])            // compatibility flags
        out.append(contentsOf: ptl[5..<11])           // constraint flags
        out.append(ptl[11])                           // level idc
        out.append(contentsOf: [0xf0, 0x00, 0xfc, 0xfd, 0xf8, 0xf8, 0x00, 0x00, 0x0f]) // segmentation, parallelism, chroma, depths, frame rate, lengthSize 4
        let arrays = [(UInt8(32), vps), (UInt8(33), sps), (UInt8(34), pps)]
        out.append(UInt8(arrays.count))
        for (type, list) in arrays {
            out.append(0x80 | type)
            out.append(contentsOf: [UInt8(list.count >> 8), UInt8(list.count & 0xff)])
            for unit in list { out.append(contentsOf: [UInt8(unit.count >> 8), UInt8(unit.count & 0xff)]); out.append(unit) }
        }
        return out
    }

    private static func dvConfig(_ info: VMStreamInfo) -> Data {
        var bytes = [UInt8](repeating: 0, count: 24)
        bytes[0] = UInt8(info.dv_version_major); bytes[1] = UInt8(info.dv_version_minor)
        bytes[2] = UInt8((Int(info.dv_profile) & 0x7f) << 1 | (Int(info.dv_level) >> 5) & 1)
        bytes[3] = UInt8((Int(info.dv_level) & 0x1f) << 3 | Int(info.dv_rpu_present & 1) << 2 | Int(info.dv_el_present & 1) << 1 | Int(info.dv_bl_present & 1))
        bytes[4] = UInt8((Int(info.dv_compatibility_id) & 0xf) << 4)
        return Data(bytes)
    }
    private static func colourPrimaries(_ value: Int32) -> CFString? {
        switch value { case 1: return kCMFormatDescriptionColorPrimaries_ITU_R_709_2; case 9: return kCMFormatDescriptionColorPrimaries_ITU_R_2020
        case 12: return kCMFormatDescriptionColorPrimaries_P3_D65; case 5, 6: return kCMFormatDescriptionColorPrimaries_SMPTE_C; default: return nil }
    }
    private static func transferFunction(_ value: Int32) -> CFString? {
        switch value { case 1, 6, 14, 15: return kCMFormatDescriptionTransferFunction_ITU_R_709_2; case 16: return kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ
        case 18: return kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG; default: return nil }
    }
    private static func yCbCrMatrix(_ value: Int32) -> CFString? {
        switch value { case 1: return kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2; case 9, 10: return kCMFormatDescriptionYCbCrMatrix_ITU_R_2020
        case 5, 6: return kCMFormatDescriptionYCbCrMatrix_ITU_R_601_4; default: return nil }
    }
}

// MARK: - Audio

/// How an audio stream reaches AVSampleBufferAudioRenderer: AC-3 and E-AC-3 as they are
/// (tvOS decodes them, and hands Dolby Atmos in E-AC-3 to an Atmos-capable sink), the rest
/// decoded by FFmpeg to interleaved float PCM.
enum VelaAudioRoute {
    case compressed(CMAudioFormatDescription, framesPerPacket: Int, sampleRate: Double)
    case decoded

    static func make(_ stream: VelaStream) -> VelaAudioRoute {
        let info = stream.info
        let format: AudioFormatID
        switch stream.codec {
        case "ac3": format = kAudioFormatAC3
        case "eac3": format = kAudioFormatEnhancedAC3
        default: return .decoded
        }
        guard info.sample_rate > 0, info.channels > 0 else { return .decoded }
        var asbd = AudioStreamBasicDescription(mSampleRate: Double(info.sample_rate), mFormatID: format, mFormatFlags: 0, mBytesPerPacket: 0, mFramesPerPacket: 1536, mBytesPerFrame: 0, mChannelsPerFrame: UInt32(info.channels), mBitsPerChannel: 0, mReserved: 0)
        var description: CMAudioFormatDescription?
        guard CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &description) == noErr, let description else { return .decoded }
        return .compressed(description, framesPerPacket: 1536, sampleRate: Double(info.sample_rate))
    }

    /// Float PCM's format for a channel count and FFmpeg channel mask.
    static func pcmFormat(channels: Int, sampleRate: Int, mask: UInt64) -> CMAudioFormatDescription? {
        var asbd = AudioStreamBasicDescription(mSampleRate: Double(sampleRate), mFormatID: kAudioFormatLinearPCM, mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
                                               mBytesPerPacket: UInt32(4 * channels), mFramesPerPacket: 1, mBytesPerFrame: UInt32(4 * channels), mChannelsPerFrame: UInt32(channels), mBitsPerChannel: 32, mReserved: 0)
        let labels = channelLabels(channels: channels, mask: mask)
        let size = MemoryLayout<AudioChannelLayout>.size + max(0, labels.count - 1) * MemoryLayout<AudioChannelDescription>.size
        let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<AudioChannelLayout>.alignment)
        defer { raw.deallocate() }
        memset(raw, 0, size)
        let layout = raw.assumingMemoryBound(to: AudioChannelLayout.self)
        layout.pointee.mChannelLayoutTag = kAudioChannelLayoutTag_UseChannelDescriptions
        layout.pointee.mNumberChannelDescriptions = UInt32(labels.count)
        let descriptions = raw.advanced(by: MemoryLayout<AudioChannelLayout>.offset(of: \AudioChannelLayout.mChannelDescriptions)!).assumingMemoryBound(to: AudioChannelDescription.self)
        for (i, label) in labels.enumerated() { descriptions[i].mChannelLabel = label }
        var description: CMAudioFormatDescription?
        guard CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: size, layout: layout, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &description) == noErr else { return nil }
        return description
    }

    /// FFmpeg's channel order (its mask's bit order) in Core Audio labels.
    private static func channelLabels(channels: Int, mask: UInt64) -> [AudioChannelLabel] {
        let bits: [(UInt64, AudioChannelLabel)] = [
            (1 << 0, kAudioChannelLabel_Left), (1 << 1, kAudioChannelLabel_Right), (1 << 2, kAudioChannelLabel_Center),
            (1 << 3, kAudioChannelLabel_LFEScreen), (1 << 4, kAudioChannelLabel_RearSurroundLeft), (1 << 5, kAudioChannelLabel_RearSurroundRight),
            (1 << 6, kAudioChannelLabel_LeftCenter), (1 << 7, kAudioChannelLabel_RightCenter), (1 << 8, kAudioChannelLabel_CenterSurround),
            (1 << 9, kAudioChannelLabel_LeftSurround), (1 << 10, kAudioChannelLabel_RightSurround), (1 << 11, kAudioChannelLabel_TopCenterSurround),
            (1 << 12, kAudioChannelLabel_VerticalHeightLeft), (1 << 13, kAudioChannelLabel_VerticalHeightCenter), (1 << 14, kAudioChannelLabel_VerticalHeightRight),
            (1 << 15, kAudioChannelLabel_TopBackLeft), (1 << 16, kAudioChannelLabel_TopBackCenter), (1 << 17, kAudioChannelLabel_TopBackRight),
        ]
        var labels = bits.filter { mask & $0.0 != 0 }.map { $0.1 }
        // Back pair without a side pair: Core Audio's 5.1 calls them the surrounds.
        if mask & (1 << 9) == 0 { labels = labels.map { $0 == kAudioChannelLabel_RearSurroundLeft ? kAudioChannelLabel_LeftSurround : $0 == kAudioChannelLabel_RearSurroundRight ? kAudioChannelLabel_RightSurround : $0 } }
        if labels.count != channels {
            labels = channels == 1 ? [kAudioChannelLabel_Mono] : (0..<channels).map { AudioChannelLabel(kAudioChannelLabel_Discrete_0 | UInt32($0)) }
            if channels == 2 { labels = [kAudioChannelLabel_Left, kAudioChannelLabel_Right] }
        }
        return labels
    }
}

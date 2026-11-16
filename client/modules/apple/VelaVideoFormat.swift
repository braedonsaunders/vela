// A video stream's CoreMedia format for VideoToolbox (through AVSampleBufferDisplayLayer):
// H.264 and HEVC from their avcC/hvcC (or Annex B parameter sets in MPEG-TS), with colour,
// HDR10 mastering and light level, HLG, and Dolby Vision profiles 5 and 8 as 'dvh1'.
// Dolby Vision this device or display refuses, and profile 7, present the HDR10 base layer.
import CoreMedia
import Foundation
import VelaMedia

struct VelaVideoFormat {
    enum Failure: Error, CustomStringConvertible {
        case unsupported(String)

        var description: String {
            switch self {
            case .unsupported(let reason): return reason
            }
        }
    }

    let description: CMVideoFormatDescription
    /// Annex B input (MPEG-TS): start codes become 4-byte lengths.
    let annexB: Bool
    /// NAL unit types to drop before decoding (Dolby Vision RPU and enhancement layer).
    let strippedUnits: Set<UInt8>
    /// sdr, hdr10, hlg or dv.
    let dynamicRange: String
    let codec: String
    let frameRate: Double

    /// `dolbyVision` false presents a Dolby Vision stream's base layer.
    static func make(_ stream: VelaStream, firstPacket: Data?, dolbyVision: Bool) throws -> VelaVideoFormat {
        let info = stream.info
        let codec = stream.codec
        guard codec == "h264" || codec == "hevc" else {
            throw Failure.unsupported("\(codec) video is not decoded on this device")
        }
        var configuration = stream.extradata
        let annexB = configuration.isEmpty || VelaNALUnits.startsWithStartCode(configuration)
        if annexB {
            let source = configuration.isEmpty ? (firstPacket ?? Data()) : configuration
            configuration = codec == "hevc"
                ? try VelaParameterSets.hvcC(fromAnnexB: source)
                : try VelaParameterSets.avcC(fromAnnexB: source)
        }
        var range = VelaColour.dynamicRange(transfer: info.color_trc)
        var codecType = codec == "hevc" ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264
        var atoms: [String: Any] = [codec == "hevc" ? "hvcC" : "avcC": configuration]
        var stripped: Set<UInt8> = []
        if codec == "hevc" && info.dv_present != 0 {
            let profile = Int(info.dv_profile)
            let presentable = profile == 5 || profile == 8
            if dolbyVision && presentable && info.dv_rpu_present != 0 {
                codecType = kCMVideoCodecType_DolbyVisionHEVC
                atoms[profile > 7 ? "dvvC" : "dvcC"] = dolbyVisionConfiguration(info)
                range = "dv"
            } else if profile == 5 {
                throw Failure.unsupported("Dolby Vision profile 5 has no base layer another display can show")
            } else {
                // Profile 7's enhancement layer and every RPU go; the HDR10 base layer stays.
                stripped = [62, 63]
            }
        }
        var extensions = VelaColour.extensions(info)
        extensions[kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms] = atoms
        var description: CMVideoFormatDescription?
        let status = CMVideoFormatDescriptionCreate(
            allocator: nil,
            codecType: codecType,
            width: info.width,
            height: info.height,
            extensions: extensions as CFDictionary,
            formatDescriptionOut: &description
        )
        guard status == noErr, let description else {
            throw Failure.unsupported("The video configuration was refused (\(status))")
        }
        return VelaVideoFormat(
            description: description,
            annexB: annexB,
            strippedUnits: stripped,
            dynamicRange: range,
            codec: codec,
            frameRate: info.frame_rate
        )
    }

    /// A packet as VideoToolbox takes it: 4-byte NAL lengths, without stripped units.
    func sampleData(_ packet: Data) -> Data {
        if !annexB && strippedUnits.isEmpty {
            return packet
        }
        let units = annexB ? VelaNALUnits.annexB(packet) : VelaNALUnits.lengthPrefixed(packet)
        var out = Data(capacity: packet.count + 16)
        for unit in units where !unit.isEmpty {
            let header = unit[unit.startIndex]
            let type = codec == "hevc" ? (header >> 1) & 0x3f : header & 0x1f
            if strippedUnits.contains(type) {
                continue
            }
            var length = UInt32(unit.count).bigEndian
            out.append(Data(bytes: &length, count: 4))
            out.append(unit)
        }
        return out
    }

    /// The 24-byte DOVIDecoderConfigurationRecord (dvcC/dvvC).
    private static func dolbyVisionConfiguration(_ info: VMStreamInfo) -> Data {
        let profile = Int(info.dv_profile) & 0x7f
        let level = Int(info.dv_level) & 0x3f
        let flags = Int(info.dv_rpu_present & 1) << 2 | Int(info.dv_el_present & 1) << 1 | Int(info.dv_bl_present & 1)
        var bytes = [UInt8](repeating: 0, count: 24)
        bytes[0] = UInt8(info.dv_version_major)
        bytes[1] = UInt8(info.dv_version_minor)
        bytes[2] = UInt8(profile << 1 | level >> 5)
        bytes[3] = UInt8((level & 0x1f) << 3 | flags)
        bytes[4] = UInt8((Int(info.dv_compatibility_id) & 0xf) << 4)
        return Data(bytes)
    }
}

/// Colour description extensions from the stream's FFmpeg colour enums.
enum VelaColour {
    static func dynamicRange(transfer: Int32) -> String {
        switch transfer {
        case 16: return "hdr10" // AVCOL_TRC_SMPTE2084
        case 18: return "hlg"   // AVCOL_TRC_ARIB_STD_B67
        default: return "sdr"
        }
    }

    static func extensions(_ info: VMStreamInfo) -> [CFString: Any] {
        var out: [CFString: Any] = [:]
        out[kCMFormatDescriptionExtension_ColorPrimaries] = primaries(info.color_primaries)
        out[kCMFormatDescriptionExtension_TransferFunction] = transfer(info.color_trc)
        out[kCMFormatDescriptionExtension_YCbCrMatrix] = matrix(info.color_space)
        if info.color_range == 2 { // AVCOL_RANGE_JPEG
            out[kCMFormatDescriptionExtension_FullRangeVideo] = true
        }
        if info.has_mastering != 0 {
            let mastering = withUnsafeBytes(of: info.mastering) { Data($0) }
            out[kCMFormatDescriptionExtension_MasteringDisplayColorVolume] = mastering
        }
        if info.has_light_level != 0 {
            let lightLevel = withUnsafeBytes(of: info.light_level) { Data($0) }
            out[kCMFormatDescriptionExtension_ContentLightLevelInfo] = lightLevel
        }
        if info.sar_num > 0 && info.sar_den > 0 && info.sar_num != info.sar_den {
            out[kCMFormatDescriptionExtension_PixelAspectRatio] = [
                kCMFormatDescriptionKey_PixelAspectRatioHorizontalSpacing: Int(info.sar_num),
                kCMFormatDescriptionKey_PixelAspectRatioVerticalSpacing: Int(info.sar_den),
            ]
        }
        if info.bits_per_raw_sample > 8 {
            out[kCMFormatDescriptionExtension_BitsPerComponent] = Int(info.bits_per_raw_sample)
        }
        return out
    }

    private static func primaries(_ value: Int32) -> CFString? {
        switch value {
        case 1: return kCMFormatDescriptionColorPrimaries_ITU_R_709_2
        case 5, 6: return kCMFormatDescriptionColorPrimaries_SMPTE_C
        case 9: return kCMFormatDescriptionColorPrimaries_ITU_R_2020
        case 12: return kCMFormatDescriptionColorPrimaries_P3_D65
        default: return nil
        }
    }

    private static func transfer(_ value: Int32) -> CFString? {
        switch value {
        case 1, 6, 14, 15: return kCMFormatDescriptionTransferFunction_ITU_R_709_2
        case 16: return kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ
        case 18: return kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG
        default: return nil
        }
    }

    private static func matrix(_ value: Int32) -> CFString? {
        switch value {
        case 1: return kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2
        case 5, 6: return kCMFormatDescriptionYCbCrMatrix_ITU_R_601_4
        case 9, 10: return kCMFormatDescriptionYCbCrMatrix_ITU_R_2020
        default: return nil
        }
    }
}

/// Splitting H.264/HEVC access units into NAL units.
enum VelaNALUnits {
    static func startsWithStartCode(_ data: Data) -> Bool {
        data.starts(with: [0, 0, 1]) || data.starts(with: [0, 0, 0, 1])
    }

    /// Units separated by 00 00 01 start codes.
    static func annexB(_ data: Data) -> [Data] {
        let bytes = [UInt8](data)
        var units: [Data] = []
        var index = 0
        var start = -1
        while index + 2 < bytes.count {
            let isStartCode = bytes[index] == 0 && bytes[index + 1] == 0 && bytes[index + 2] == 1
            guard isStartCode else {
                index += 1
                continue
            }
            if start >= 0 {
                var end = index
                while end > start && bytes[end - 1] == 0 {
                    end -= 1
                }
                units.append(Data(bytes[start..<end]))
            }
            index += 3
            start = index
        }
        if start >= 0 && start < bytes.count {
            units.append(Data(bytes[start...]))
        }
        return units
    }

    /// Units each preceded by a 4-byte big-endian length.
    static func lengthPrefixed(_ data: Data) -> [Data] {
        var units: [Data] = []
        var index = data.startIndex
        while index + 4 <= data.endIndex {
            let length = data[index..<(index + 4)].reduce(0) { total, byte in total << 8 | Int(byte) }
            let start = index + 4
            let end = start + length
            guard length > 0, end <= data.endIndex else {
                break
            }
            units.append(data.subdata(in: start..<end))
            index = end
        }
        return units
    }
}

/// avcC and hvcC records from Annex B parameter sets.
enum VelaParameterSets {
    static func avcC(fromAnnexB data: Data) throws -> Data {
        let units = VelaNALUnits.annexB(data)
        let sps = units.first { $0.count >= 4 && $0[$0.startIndex] & 0x1f == 7 }
        let pps = units.first { !$0.isEmpty && $0[$0.startIndex] & 0x1f == 8 }
        guard let sps, let pps else {
            throw VelaVideoFormat.Failure.unsupported("The H.264 stream has no parameter sets yet")
        }
        let profile = sps[sps.startIndex + 1]
        let compatibility = sps[sps.startIndex + 2]
        let level = sps[sps.startIndex + 3]
        var out = Data([1, profile, compatibility, level, 0xff, 0xe1])
        append(sps, to: &out)
        out.append(1)
        append(pps, to: &out)
        return out
    }

    /// A minimal hvcC: VideoToolbox reads the parameter set arrays and the SPS's profile.
    static func hvcC(fromAnnexB data: Data) throws -> Data {
        let units = VelaNALUnits.annexB(data)
        let ofType = { (type: UInt8) in
            units.filter { $0.count > 2 && ($0[$0.startIndex] >> 1) & 0x3f == type }
        }
        let vps = ofType(32)
        let sps = ofType(33)
        let pps = ofType(34)
        guard let first = sps.first, first.count > 14, !vps.isEmpty, !pps.isEmpty else {
            throw VelaVideoFormat.Failure.unsupported("The HEVC stream has no parameter sets yet")
        }
        // profile_tier_level follows the 2-byte NAL header and the SPS's first byte.
        let tierLevel = [UInt8](first[(first.startIndex + 3)..<(first.startIndex + 15)])
        var out = Data([1])
        out.append(contentsOf: tierLevel[0..<11])
        out.append(tierLevel[11])
        // Segmentation, parallelism, chroma format, bit depths, frame rate, 4-byte lengths.
        out.append(contentsOf: [0xf0, 0x00, 0xfc, 0xfd, 0xf8, 0xf8, 0x00, 0x00, 0x0f])
        let arrays: [(type: UInt8, units: [Data])] = [(32, vps), (33, sps), (34, pps)]
        out.append(UInt8(arrays.count))
        for array in arrays {
            out.append(0x80 | array.type)
            out.append(contentsOf: [UInt8(array.units.count >> 8), UInt8(array.units.count & 0xff)])
            for unit in array.units {
                append(unit, to: &out)
            }
        }
        return out
    }

    private static func append(_ unit: Data, to out: inout Data) {
        out.append(contentsOf: [UInt8(unit.count >> 8), UInt8(unit.count & 0xff)])
        out.append(unit)
    }
}

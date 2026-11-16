// tvOS display matching (Settings › Video and Audio › Match Content): the content's dynamic range
// and frame rate as AVDisplayCriteria, before the first frame, cleared on stop. The criteria come
// from the plan's verified original facts, else from what mpv reports once the video is decoded.
import AVFoundation
import AVKit
import CoreMedia
import UIKit

struct VideoFacts: Equatable {
    /// sdr, hdr10, hlg or dv.
    var dynamicRange: String
    var frameRate: Double
    var width: Int
    var height: Int
    var hevc: Bool
}

enum DisplayMatching {
    #if os(tvOS)
    /// Asks the display for `facts` (nil: the display's own mode). Main thread.
    static func prefer(_ facts: VideoFacts?, in window: UIWindow?) {
        guard let manager = window?.avDisplayManager, manager.isDisplayCriteriaMatchingEnabled else {
            return
        }
        guard let facts, let format = formatDescription(facts) else {
            manager.preferredDisplayCriteria = nil
            return
        }
        guard #available(tvOS 17.0, *) else {
            return
        }
        let rate = Float(facts.frameRate > 0 ? facts.frameRate : 24)
        manager.preferredDisplayCriteria = AVDisplayCriteria(refreshRate: rate, formatDescription: format)
    }

    /// Whether the display is between modes (it blanks meanwhile). Main thread.
    static func switching(in window: UIWindow?) -> Bool {
        window?.avDisplayManager.isDisplayModeSwitchInProgress ?? false
    }

    /// The display manager's state, for the console.
    static func describe(_ window: UIWindow?) -> String {
        guard let manager = window?.avDisplayManager else {
            return "no window"
        }
        let criteria = manager.preferredDisplayCriteria.map { "\($0)" } ?? "none"
        let modes = AVPlayer.availableHDRModes
        let named: [(AVPlayer.HDRMode, String)] = [(.hdr10, "hdr10"), (.hlg, "hlg"), (.dolbyVision, "dv")]
        let hdr = named.filter { modes.contains($0.0) }.map(\.1)
        let matching = manager.isDisplayCriteriaMatchingEnabled ? "on" : "off"
        return "matching \(matching), criteria \(criteria), switching \(manager.isDisplayModeSwitchInProgress), "
            + "HDR eligible \(AVPlayer.eligibleForHDRPlayback) \(hdr)"
    }
    #else
    static func prefer(_ facts: VideoFacts?, in window: UIWindow?) {}
    static func switching(in window: UIWindow?) -> Bool { false }
    static func describe(_ window: UIWindow?) -> String { "no display matching" }
    #endif

    /// A format description that carries only what display matching reads: codec and colour.
    private static func formatDescription(_ facts: VideoFacts) -> CMVideoFormatDescription? {
        let codec: CMVideoCodecType
        let extensions: [CFString: Any]
        switch facts.dynamicRange {
        case "hdr10":
            codec = kCMVideoCodecType_HEVC
            extensions = colour(bt2020: true, transfer: kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ)
        case "hlg":
            codec = kCMVideoCodecType_HEVC
            extensions = colour(bt2020: true, transfer: kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG)
        case "dv":
            codec = kCMVideoCodecType_DolbyVisionHEVC
            extensions = colour(bt2020: true, transfer: kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ)
        default:
            codec = facts.hevc ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264
            extensions = colour(bt2020: false, transfer: kCMFormatDescriptionTransferFunction_ITU_R_709_2)
        }
        var format: CMVideoFormatDescription?
        let status = CMVideoFormatDescriptionCreate(
            allocator: nil,
            codecType: codec,
            width: Int32(max(facts.width, 16)),
            height: Int32(max(facts.height, 16)),
            extensions: extensions as CFDictionary,
            formatDescriptionOut: &format
        )
        return status == noErr ? format : nil
    }

    private static func colour(bt2020: Bool, transfer: CFString) -> [CFString: Any] {
        [
            kCMFormatDescriptionExtension_ColorPrimaries:
                bt2020 ? kCMFormatDescriptionColorPrimaries_ITU_R_2020 : kCMFormatDescriptionColorPrimaries_ITU_R_709_2,
            kCMFormatDescriptionExtension_TransferFunction: transfer,
            kCMFormatDescriptionExtension_YCbCrMatrix:
                bt2020 ? kCMFormatDescriptionYCbCrMatrix_ITU_R_2020 : kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2,
        ]
    }

    // MARK: Facts

    /// From the plan's verified original facts (OriginalVideo).
    static func facts(_ video: VelaOriginalVideo?) -> VideoFacts? {
        guard let video, let width = video.width, let height = video.height else {
            return nil
        }
        let transfer = (video.colorTransfer ?? "").lowercased()
        let range: String
        if video.dvProfile != nil {
            range = "dv"
        } else if transfer == "smpte2084" || transfer == "pq" {
            range = "hdr10"
        } else if transfer == "arib-std-b67" || transfer == "hlg" {
            range = "hlg"
        } else {
            range = "sdr"
        }
        let codec = (video.codec ?? "").lowercased()
        let hevc = codec.contains("hevc") || codec.contains("265")
        let rate = video.frameRate ?? 0
        return VideoFacts(dynamicRange: range, frameRate: rate, width: width, height: height, hevc: hevc)
    }

    /// From mpv's `video-params` and `container-fps` once the video is decoded.
    static func facts(videoParams: [String: Any], frameRate: Double?, codec: String?) -> VideoFacts? {
        guard let width = videoParams["w"] as? Int64, let height = videoParams["h"] as? Int64 else {
            return nil
        }
        let gamma = videoParams["gamma"] as? String ?? ""
        let range = gamma == "pq" ? "hdr10" : gamma == "hlg" ? "hlg" : "sdr"
        let hevc = (codec ?? "").lowercased().contains("hevc")
        let rate = frameRate ?? 0
        return VideoFacts(dynamicRange: range, frameRate: rate, width: Int(width), height: Int(height), hevc: hevc)
    }
}

/// The audio session a film needs: playback, movie mode, multichannel output when the HDMI sink takes it.
enum PlaybackAudioSession {
    static func activate() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
        #if os(tvOS)
        try? session.setSupportsMultichannelContent(true)
        #endif
        try? session.setActive(true)
        let channels = min(8, session.maximumOutputNumberOfChannels)
        try? session.setPreferredOutputNumberOfChannels(channels)
    }

    /// Channels the output takes now (2 on a TV's speakers, 6 or 8 on a receiver).
    static var outputChannels: Int {
        AVAudioSession.sharedInstance().outputNumberOfChannels
    }
}

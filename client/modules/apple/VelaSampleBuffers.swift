// CMSampleBuffers from demuxed packets and decoded PCM, for AVSampleBufferDisplayLayer and
// AVSampleBufferAudioRenderer.
import CoreMedia
import Foundation

enum VelaSampleBuffers {
    static let videoTimescale: CMTimeScale = 90_000

    /// One compressed video frame. `hidden` frames are decoded (to reach a seek target) but never shown.
    static func video(
        _ data: Data, format: CMFormatDescription, pts: Double, dts: Double, duration: Double,
        keyframe: Bool, hidden: Bool
    ) -> CMSampleBuffer? {
        guard let block = blockBuffer(data) else {
            return nil
        }
        var timing = CMSampleTimingInfo(
            duration: duration > 0 ? CMTime(seconds: duration, preferredTimescale: videoTimescale) : .invalid,
            presentationTimeStamp: pts.isFinite ? CMTime(seconds: pts, preferredTimescale: videoTimescale) : .invalid,
            decodeTimeStamp: dts.isFinite ? CMTime(seconds: dts, preferredTimescale: videoTimescale) : .invalid
        )
        var size = data.count
        var sample: CMSampleBuffer?
        let status = CMSampleBufferCreateReady(
            allocator: nil,
            dataBuffer: block,
            formatDescription: format,
            sampleCount: 1,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleSizeEntryCount: 1,
            sampleSizeArray: &size,
            sampleBufferOut: &sample
        )
        guard status == noErr, let sample else {
            return nil
        }
        if !keyframe || hidden {
            let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true)
            if let first = (attachments as? [NSMutableDictionary])?.first {
                if !keyframe {
                    first[kCMSampleAttachmentKey_NotSync] = true
                }
                if hidden {
                    first[kCMSampleAttachmentKey_DoNotDisplay] = true
                }
            }
        }
        return sample
    }

    /// One compressed audio packet (AC-3, E-AC-3) of `frames` samples.
    static func audioPacket(
        _ data: Data, format: CMAudioFormatDescription, pts: Double, rate: Double
    ) -> CMSampleBuffer? {
        guard let block = blockBuffer(data) else {
            return nil
        }
        var description = AudioStreamPacketDescription(
            mStartOffset: 0,
            mVariableFramesInPacket: 0,
            mDataByteSize: UInt32(data.count)
        )
        var sample: CMSampleBuffer?
        let status = CMAudioSampleBufferCreateReadyWithPacketDescriptions(
            allocator: nil,
            dataBuffer: block,
            formatDescription: format,
            sampleCount: 1,
            presentationTimeStamp: CMTime(seconds: pts, preferredTimescale: CMTimeScale(rate)),
            packetDescriptions: &description,
            sampleBufferOut: &sample
        )
        return status == noErr ? sample : nil
    }

    /// Interleaved float PCM of `frames` frames.
    static func pcm(
        _ data: Data, format: CMAudioFormatDescription, pts: Double, frames: Int, rate: Int
    ) -> CMSampleBuffer? {
        guard let block = blockBuffer(data) else {
            return nil
        }
        let start = CMTime(value: CMTimeValue((pts * Double(rate)).rounded()), timescale: CMTimeScale(rate))
        var sample: CMSampleBuffer?
        let status = CMAudioSampleBufferCreateReadyWithPacketDescriptions(
            allocator: nil,
            dataBuffer: block,
            formatDescription: format,
            sampleCount: frames,
            presentationTimeStamp: start,
            packetDescriptions: nil,
            sampleBufferOut: &sample
        )
        return status == noErr ? sample : nil
    }

    private static func blockBuffer(_ data: Data) -> CMBlockBuffer? {
        var block: CMBlockBuffer?
        let made = CMBlockBufferCreateWithMemoryBlock(
            allocator: nil,
            memoryBlock: nil,
            blockLength: data.count,
            blockAllocator: nil,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: data.count,
            flags: kCMBlockBufferAssureMemoryNowFlag,
            blockBufferOut: &block
        )
        guard made == noErr, let block else {
            return nil
        }
        let copied = data.withUnsafeBytes { raw in
            CMBlockBufferReplaceDataBytes(
                with: raw.baseAddress!,
                blockBuffer: block,
                offsetIntoDestination: 0,
                dataLength: data.count
            )
        }
        return copied == noErr ? block : nil
    }
}

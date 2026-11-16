// AVPlayer for the server's HLS: what plays when the server must remux or convert an original
// (or a source has no original path). The player view labels it `native-hls`.
import AVFoundation
import Foundation

final class VelaHLSBackend: VelaBackend {
    var onChange: (() -> Void)?

    private let player = AVPlayer()
    /// The media time of the playlist's zero (an off-grid seek's offset playlist starts later).
    private let timelineOrigin: Double
    private var observations: [NSKeyValueObservation] = []
    private var failure: String?

    init(layer: AVPlayerLayer, url: URL, headers: [String: String], start: Double, timelineOrigin: Double) {
        self.timelineOrigin = timelineOrigin
        let options = headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers]
        let item = AVPlayerItem(asset: AVURLAsset(url: url, options: options))
        item.preferredForwardBufferDuration = 30
        // tvOS switches the display to the stream's range and rate (Match Content).
        player.appliesMediaSelectionCriteriaAutomatically = false
        player.replaceCurrentItem(with: item)
        layer.player = player
        if start - timelineOrigin > 0.5 {
            item.seek(to: CMTime(seconds: start - timelineOrigin, preferredTimescale: 600), completionHandler: nil)
        }
        observations.append(item.observe(\.status) { [weak self] item, _ in
            if item.status == .failed {
                self?.failure = item.error?.localizedDescription ?? "The stream could not be played"
            }
            self?.notify()
        })
        observations.append(player.observe(\.timeControlStatus) { [weak self] _, _ in
            self?.notify()
        })
        player.play()
    }

    private func notify() {
        DispatchQueue.main.async { [weak self] in
            self?.onChange?()
        }
    }

    var currentTime: Double {
        timelineOrigin + max(0, CMTimeGetSeconds(player.currentTime()))
    }

    var readout: VelaReadout {
        var readout = VelaReadout()
        let item = player.currentItem
        readout.position = currentTime
        if let duration = item?.duration, duration.isNumeric {
            readout.duration = timelineOrigin + CMTimeGetSeconds(duration)
        }
        if let range = item?.loadedTimeRanges.first?.timeRangeValue {
            readout.bufferedEnd = timelineOrigin + CMTimeGetSeconds(CMTimeRangeGetEnd(range))
        }
        if let event = item?.accessLog()?.events.last {
            readout.throughputBps = event.observedBitrate > 0 ? event.observedBitrate : nil
            readout.transferredBytes = event.numberOfBytesTransferred
        }
        if let size = item?.presentationSize, size.width > 0 {
            readout.width = Int(size.width)
            readout.height = Int(size.height)
        }
        readout.state = state(item)
        readout.failure = failure
        readout.preparation = readout.state == .loading ? "initial-buffer" : nil
        return readout
    }

    private func state(_ item: AVPlayerItem?) -> VelaReadout.State {
        if failure != nil {
            return .failed
        }
        guard let item, item.status == .readyToPlay else {
            return .loading
        }
        switch player.timeControlStatus {
        case .playing:
            return .playing
        case .waitingToPlayAtSpecifiedRate:
            return .buffering
        case .paused:
            let atEnd = item.duration.isNumeric && CMTimeCompare(item.currentTime(), item.duration) >= 0
            return atEnd ? .ended : .paused
        @unknown default:
            return .loading
        }
    }

    func play() {
        player.play()
    }

    func pause() {
        player.pause()
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: max(0, seconds - timelineOrigin), preferredTimescale: 600))
    }

    func setVolume(_ volume: Float, muted: Bool) {
        player.volume = volume
        player.isMuted = muted
    }

    func stop() {
        observations.removeAll()
        player.pause()
        player.replaceCurrentItem(with: nil)
    }
}

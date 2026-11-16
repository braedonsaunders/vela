// VelaMedia's demuxer (FFmpeg libavformat: Matroska, MP4/MOV, MPEG-TS) over a range reader.
import Foundation
import VelaMedia

/// One stream of an original, as the demuxer describes it.
struct VelaStream {
    let info: VMStreamInfo

    var index: Int {
        Int(info.index)
    }

    var codec: String {
        VelaStream.string(info.codec)
    }

    var language: String {
        VelaStream.string(info.language)
    }

    var extradata: Data {
        guard let bytes = info.extradata else {
            return Data()
        }
        return Data(bytes: bytes, count: Int(info.extradata_size))
    }

    var isVideo: Bool {
        info.type == Int32(VM_VIDEO) && info.is_attached_pic == 0
    }

    var isAudio: Bool {
        info.type == Int32(VM_AUDIO)
    }

    var isSubtitle: Bool {
        info.type == Int32(VM_SUBTITLE)
    }

    /// A fixed-size C character array as a string.
    private static func string<T>(_ tuple: T) -> String {
        withUnsafeBytes(of: tuple) { raw in
            String(cString: raw.bindMemory(to: CChar.self).baseAddress!)
        }
    }
}

struct VelaDemuxPacket {
    let stream: Int
    /// Seconds; NaN when absent.
    let pts: Double
    let dts: Double
    /// Seconds; 0 when unknown.
    let duration: Double
    let keyframe: Bool
    let data: Data
}

final class VelaDemuxer: @unchecked Sendable {
    enum Failure: Error, CustomStringConvertible {
        case open(String)

        var description: String {
            switch self {
            case .open(let reason): return reason
            }
        }
    }

    let reader: VelaRangeReader
    let handle: OpaquePointer
    let streams: [VelaStream]
    let container: String
    let duration: Double?

    /// Opens and probes the container; blocks on the network.
    init(reader: VelaRangeReader) throws {
        self.reader = reader
        var error = [CChar](repeating: 0, count: 256)
        let opaque = Unmanaged.passUnretained(reader).toOpaque()
        let opened = vm_open(opaque, VelaDemuxer.readBytes, VelaDemuxer.seekBytes, &error, Int32(error.count))
        guard let opened else {
            throw Failure.open(String(cString: error))
        }
        handle = opened
        streams = (0..<vm_stream_count(opened)).compactMap { index in
            var info = VMStreamInfo()
            return vm_stream_info(opened, index, &info) == 0 ? VelaStream(info: info) : nil
        }
        container = String(cString: vm_container(opened))
        let seconds = vm_duration(opened)
        duration = seconds.isFinite && seconds > 0 ? seconds : nil
    }

    deinit {
        vm_close(handle)
    }

    private static let readBytes: vm_read_fn = { opaque, buffer, size in
        guard let opaque, let buffer else {
            return -1
        }
        let reader = Unmanaged<VelaRangeReader>.fromOpaque(opaque).takeUnretainedValue()
        return Int32(reader.read(into: buffer, size: Int(size)))
    }

    private static let seekBytes: vm_seek_fn = { opaque, offset, whence in
        guard let opaque else {
            return -1
        }
        let reader = Unmanaged<VelaRangeReader>.fromOpaque(opaque).takeUnretainedValue()
        return reader.seek(offset: offset, whence: whence)
    }

    /// Reads only these streams; the demuxer discards the others.
    func enable(_ wanted: Set<Int>) {
        for stream in streams {
            vm_enable_stream(handle, Int32(stream.index), wanted.contains(stream.index) ? 1 : 0)
        }
    }

    /// The next packet, or nil at the end of the file.
    func read() throws -> VelaDemuxPacket? {
        var packet = VMPacket()
        let result = vm_read(handle, &packet)
        if result == 1 {
            return nil
        }
        if result < 0 {
            throw Failure.open("The media could not be read (\(result))")
        }
        let data = packet.data.map { Data(bytes: $0, count: Int(packet.size)) } ?? Data()
        return VelaDemuxPacket(
            stream: Int(packet.stream),
            pts: packet.pts,
            dts: packet.dts,
            duration: packet.duration,
            keyframe: packet.keyframe != 0,
            data: data
        )
    }

    /// Moves to the keyframe at or before `seconds`.
    func seek(to seconds: Double) -> Bool {
        vm_seek(handle, seconds) == 0
    }

    /// Makes a blocked read return now (a seek or stop is waiting).
    func interrupt(_ on: Bool) {
        vm_interrupt(handle, on ? 1 : 0)
    }
}

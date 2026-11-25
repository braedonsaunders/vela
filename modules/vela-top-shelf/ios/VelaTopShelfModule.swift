import ExpoModulesCore
import ImageIO
import TVServices
import UIKit
import os

/// Apple TV's Top Shelf writer (src/model.ts decides what goes on it). The snapshot and its
/// pictures go into the App Group's `Library/Caches/TopShelf`, which the TV Services extension
/// (extension/VelaTopShelfExtension.swift) reads. Picture URLs arrive in memory only: they can carry a
/// server's transient credential, so they are fetched once and never written down.
public final class VelaTopShelfModule: Module {
    public func definition() -> ModuleDefinition {
        Name("VelaTopShelf")

        AsyncFunction("publish") { (sequence: Int, snapshot: String, downloads: [TopShelfDownload]) async throws in
            let pictures = downloads.compactMap { download -> (file: String, url: URL)? in
                guard TopShelfStore.isPictureName(download.file), let url = URL(string: download.url),
                      url.scheme == "https" || url.scheme == "http" else { return nil }
                return (download.file, url)
            }
            try await TopShelfStore.shared.publish(sequence: sequence, snapshot: Data(snapshot.utf8), pictures: pictures)
        }

        AsyncFunction("clear") { (sequence: Int) async throws in
            try await TopShelfStore.shared.clear(sequence: sequence)
        }
    }
}

struct TopShelfDownload: Record {
    @Field var file: String = ""
    @Field var url: String = ""
}

private let log = Logger(subsystem: "app.ether.vela", category: "top-shelf")

/// One writer for the App Group folder. Every call carries the app's rising sequence: a call older
/// than one already seen is dropped, and a publish that a later call overtook while its pictures
/// downloaded stops before committing, so a previous viewer's late write never replaces a clear.
actor TopShelfStore {
    static let shared = TopShelfStore()
    static let snapshotName = "snapshot.json"
    /// The longest side of a stored picture, in pixels: a Top Shelf card at 2x and no more.
    private static let maxPixels: CGFloat = 1280
    private static let maxDownloadBytes = 16 * 1024 * 1024

    private var latest = 0
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 60
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration)
    }()

    /// The folder the app and the extension share; nil without the App Group entitlement.
    static var folder: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "VelaAppGroup") as? String, !group.isEmpty,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
        return container.appendingPathComponent("Library/Caches/TopShelf", isDirectory: true)
    }

    /// The model names pictures `<16 hex>.jpg`; anything else never reaches the file system.
    static func isPictureName(_ name: String) -> Bool {
        name.count == 20 && name.hasSuffix(".jpg") && name.dropLast(4).allSatisfy { $0.isHexDigit }
    }

    func publish(sequence: Int, snapshot: Data, pictures: [(file: String, url: URL)]) async throws {
        guard sequence > latest else { return }
        latest = sequence
        guard let folder = Self.folder else { throw TopShelfError.noAppGroup }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // A cold start can inherit another viewer's published snapshot. Remove it before
        // the first suspension, even when auth and the new Home arrived together.
        let snapshotURL = folder.appendingPathComponent(Self.snapshotName)
        if let previous = try? Data(contentsOf: snapshotURL),
           try JSONDecoder().decode(ShelfOwner.self, from: snapshot).owner != (try? JSONDecoder().decode(ShelfOwner.self, from: previous).owner) {
            try FileManager.default.removeItem(at: snapshotURL)
            TVTopShelfContentProvider.topShelfContentDidChange()
        }
        var missingPicture = false
        for picture in pictures {
            let target = folder.appendingPathComponent(picture.file)
            if FileManager.default.fileExists(atPath: target.path) { continue }
            let data = await fetch(picture.url)
            guard latest == sequence else { return }
            guard let data else { missingPicture = true; continue }
            try data.write(to: target, options: .atomic)
        }
        guard latest == sequence else { return }
        try snapshot.write(to: snapshotURL, options: .atomic)
        // Pictures of titles that left the shelf.
        let keep = Set(pictures.map(\.file) + [Self.snapshotName])
        for name in (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? [] where !keep.contains(name) {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(name))
        }
        TVTopShelfContentProvider.topShelfContentDidChange()
        // The available pictures are already visible. Permit the next Home refresh to
        // retry only the missing files, even if its titles and progress are unchanged.
        if missingPicture { throw TopShelfError.missingPicture }
    }

    private struct ShelfOwner: Decodable { let owner: String }

    func clear(sequence: Int) throws {
        guard sequence > latest else { return }
        latest = sequence
        guard let folder = Self.folder else { throw TopShelfError.noAppGroup }
        if FileManager.default.fileExists(atPath: folder.path) { try FileManager.default.removeItem(at: folder) }
        TVTopShelfContentProvider.topShelfContentDidChange()
    }

    /// A picture as a JPEG no larger than the Top Shelf draws it; nil when it is not one.
    private func fetch(_ url: URL) async -> Data? {
        do {
            let (bytes, response) = try await session.bytes(from: url)
            defer { bytes.task.cancel() }
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  response.expectedContentLength <= Self.maxDownloadBytes else { return nil }
            var data = Data()
            for try await byte in bytes {
                guard data.count < Self.maxDownloadBytes else { return nil }
                data.append(byte)
            }
            // ImageIO downsamples while decoding and preserves orientation, including
            // very narrow images whose smaller dimension would otherwise round to zero.
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: Self.maxPixels,
            ]
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
            return UIImage(cgImage: image).jpegData(compressionQuality: 0.82)
        } catch {
            // The URL may carry a credential: only the host is logged.
            log.warning("Top Shelf picture from \(url.host ?? "", privacy: .public) failed with code \((error as NSError).code)")
            return nil
        }
    }
}

enum TopShelfError: Error, CustomStringConvertible {
    case noAppGroup
    case missingPicture

    var description: String {
        switch self {
        case .noAppGroup: return "This build has no App Group for the Top Shelf"
        case .missingPicture: return "One or more Top Shelf pictures were unavailable"
        }
    }
}

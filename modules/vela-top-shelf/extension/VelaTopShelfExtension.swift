import Foundation
import TVServices

/// Vela's Top Shelf (the TV Services extension plugin/index.js adds at an Apple TV prebuild):
/// Continue Watching from the snapshot the app keeps in the App Group (ios/VelaTopShelfModule.swift).
/// It reads files only: no network, no credentials. With no snapshot (signed out, nothing in
/// progress, a snapshot it does not understand) it returns nil and tvOS shows the static artwork.
final class ContentProvider: TVTopShelfContentProvider {
    override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
        completionHandler(TopShelfSnapshot.content())
    }
}

/// The snapshot's format (modules/vela-top-shelf/src/model.ts, TOP_SHELF_VERSION 1).
struct TopShelfSnapshot: Decodable {
    struct Item: Decodable {
        let id: String
        let title: String
        let image: String
        let shape: String
        let progress: Double
        let link: String
    }

    static let version = 1
    let version: Int
    let title: String
    let items: [Item]

    static func content() -> TVTopShelfContent? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "VelaAppGroup") as? String,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
        let folder = container.appendingPathComponent("Library/Caches/TopShelf", isDirectory: true)
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("snapshot.json")),
              let snapshot = try? JSONDecoder().decode(TopShelfSnapshot.self, from: data),
              snapshot.version == version else { return nil }
        let items = snapshot.items.compactMap { item -> TVTopShelfSectionedItem? in
            let picture = folder.appendingPathComponent(item.image, isDirectory: false)
            // A title whose picture could not be fetched is left out rather than drawn blank.
            guard !item.image.contains("/"), FileManager.default.fileExists(atPath: picture.path),
                  let link = URL(string: item.link), link.scheme == "vela" else { return nil }
            let entry = TVTopShelfSectionedItem(identifier: item.id)
            entry.title = item.title
            entry.imageShape = item.shape == "poster" ? .poster : .hdtv
            entry.setImageURL(picture, for: [.screenScale1x, .screenScale2x])
            if item.progress > 0 { entry.playbackProgress = min(1, item.progress) }
            // Selecting the card and the remote's Play button both resume it in the app.
            entry.displayAction = TVTopShelfAction(url: link)
            entry.playAction = TVTopShelfAction(url: link)
            return entry
        }
        guard !items.isEmpty else { return nil }
        let section = TVTopShelfItemCollection(items: items)
        section.title = snapshot.title
        return TVTopShelfSectionedContent(sections: [section])
    }
}

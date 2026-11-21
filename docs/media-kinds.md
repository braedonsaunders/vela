# Media kinds: music, books, audiobooks

Status: **v1, signed off by the Ether coordinator on 2026-11-20** (with the
edits folded in below). Ether puts the final contract text in its
`docs/plugin-kinds.md`; Vela builds against the mock server meanwhile. Any
further change is agreed with Ether before it is built.

Ether ships generic plugin infrastructure: a content plugin declares a kind with
levels, and a per-app `present` block says how each app sees it. This proposal
adds one generic idea to the Vela protocol, the **media class** of a library and
the **role** of each level, plus the delivery and progress needed for audio and
reading. All fields are additive. A server that sends none of them is unchanged
for every Vela build, and an older Vela build ignores them and keeps today's
movies/shows projection.

## 1. Classes and roles

```ts
/** What a library holds. Unknown values are read as 'video'. */
type MediaClass = 'video' | 'music' | 'audiobook' | 'book' | 'podcast' | 'photo';

/** What one level of a kind is. Unknown values are read as 'item'. */
type MediaRole =
  | 'item'                                   // any playable/openable leaf without a richer role
  | 'artist' | 'album' | 'track'             // music
  | 'series' | 'book'                        // books (series of books)
  | 'audiobook' | 'part'                     // audiobooks (a multi-file book's parts)
  | 'show' | 'episode'                       // podcasts (and video shows if wanted)
  | 'collection';                            // a grouping level with no richer role
```

Manifest (Ether side). Class and role are **facts about the kind**, not Vela
presentation: Ether derives every protocol from them (Jellyfin/Emby item types,
the Plex base, Vela, Silo, Stremio). An explicit `present.<app>` still overrides
the presentation for that one app.

```jsonc
{
  "key": "music",
  "media": "music",                                  // MediaClass
  "levels": [
    { "key": "artist", "role": "artist" },           // MediaRole per level
    { "key": "album", "role": "album", "container": true },
    { "key": "track", "role": "track", "playable": true }
  ]
}
```

When `media` and `role` are absent, Ether infers them from
`present.mediaBrowser.itemTypes` (`MusicArtist→artist`, `MusicAlbum→album`,
`Audio→track`, `AudioBook→audiobook`, `Book→book`, `Photo→photo`), then from the
level shape (album/track ⇒ music). That is one mapping table in Ether's
presentation inference (W184b), not per-content-type code.

## 2. Wire additions

### Library

```ts
interface Library {
  // existing: presentation?: { card: LibraryCard }, dateDisplay, tabs, kind, browse …
  media?: MediaClass;                // omitted = 'video'
}
interface LibraryTab {
  // existing fields …
  /** A 'library' or 'view' tab that lists one level instead of the root (e.g. Albums, Tracks). */
  level?: string;                    // level key; items carry the level's role
}
```

`presentation.card` is unchanged (`poster | landscape | square`). Vela draws the
cover treatment from the class and role: books get a 2:3 cover with a spine and
shadow, music and audiobooks a 1:1 cover, artists a round portrait. No new card
value reaches older clients.

### Title (every title in rows, search, libraries, children, detail)

```ts
interface TitleMedia {
  class: MediaClass;
  role: MediaRole;
  /** Position inside the parent: track number, book number in a series, part number. */
  index?: number;
  /** Disc / volume for multi-disc albums. */
  disc?: number;
  /** Ancestors nearest first, e.g. a track: [album, artist]; a book: [series]. */
  parents?: { id: ID; name: string; role: MediaRole }[];
  /** Number of direct children (tracks on an album, albums by an artist, books in a series). */
  childCount?: number;
  /** People by credit; personId is the plugin's people-facet person, so /people/:id pages work. */
  credits?: { name: string; role: 'artist' | 'albumArtist' | 'author' | 'narrator' | 'composer' | 'illustrator' | 'translator' | 'host' | string; personId?: ID }[];
  /** Readable documents only (role book). */
  reading?: { format: 'epub' | 'pdf' | 'cbz'; pages?: number };
  /** Optional plain facts a page shows as-is (label, publisher, ISBN, release type). */
  facts?: { label: string; value: string }[];
}
interface Title { /* existing … */ media?: TitleMedia }
interface WatchState { /* existing … */ reading?: ReadingProgress }
```

`Title.kind` keeps today's projection (movie/show/season/episode) so older
clients keep working; newer clients key on `media.role`.

Relations use the existing endpoints:

| Page | Data |
| --- | --- |
| Artist | `GET /titles/:artistId` (detail) + `GET /titles/:id/children` (albums, `media.role = album`). Optional `GET /rows?placement=detail&titleId=` row with `purpose: 'recommendation'` and id suffix `:top` for top tracks. |
| Album | `GET /titles/:albumId` + children (tracks with `index`, `disc`, `durationSeconds`). |
| Series (books) | detail + children (books with `index`). |
| Book / audiobook | detail; `chapters` (existing `TitleDetail.chapters`) for audiobooks; `credits` carry author and narrator. |

### Audio playback (no new endpoint)

Audio uses `POST /playback` with `titleId`, the same session, commands and
observations as video. Additions:

```ts
interface PlaybackPlan { /* existing … */ media?: 'video' | 'audio' }   // omitted = 'video'
```

- Paths: `direct` (file, Range) when the client's `audioCodecs`/`containers`
  accept the source, otherwise `transcode` to AAC (file or HLS). No `originalVideo`.
- `chapters` carries audiobook chapters (embedded or one per file part).
- A multi-file audiobook (`hints.parts`) exposes each file as a child title with
  role `part` (and `index`); Vela queues the parts as one book and shows a book
  position across them. One joined server timeline is a later improvement.
  Chapters inside one file still come through `chapters`.
- Gapless: client-side (Vela prefetches the next queued track's plan). No field.
- Progress: observations update `WatchState.positionSeconds` exactly as today.
  Resume policy by class (data, not code): `music` never enters Continue and
  never stores a resume point for tracks; `audiobook` and `podcast` do.

### Reading (new endpoints)

```ts
type ReadingFormat = 'epub' | 'pdf' | 'cbz';
interface ReadingRequest extends Mutation {}
interface ReadingGrant {
  titleId: ID; format: ReadingFormat; mimeType: string;
  /** Short-lived, range-capable URL (the kind-media ticket); no bearer needed to fetch it. */
  url: string; expiresAt: Timestamp; byteLength?: number;
  progress?: ReadingProgress;
}
interface ReadingProgress {
  /** Opaque to the server: an EPUB CFI, a PDF/CBZ page index as text. */
  locator: string;
  /** 0..1 through the whole document; what every other frontend shows. */
  fraction: number;
  /** Optional human label: chapter name or "Page 12 of 300". */
  label?: string;
  updatedAt: Timestamp;
}
interface ReadingProgressRequest extends Mutation { locator: string; fraction: number; label?: string; observedAt?: Timestamp }
```

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | /titles/:id/read | ReadingRequest | ReadingGrant |
| POST | /titles/:id/reading-progress | ReadingProgressRequest | Ack |

`fraction ≥ 0.98` marks the title played (same rule as video); `POST
/titles/:id/watch {played:false}` clears it. Reading progress is shared Ether
watch state, not a Vela side table: the same `{locator, fraction}` surfaces as
`PlayedPercentage`/UserData in Jellyfin and Emby and as a view offset or
percentage in Plex where a client can show it. The `/read` URL reuses the
existing kind-media ticket and Range path; there is no new media server.

Ordering (approved 2026-11-20, applies to every frontend progress write through
shared watch state): a write with `observedAt` (the client's time when the
reader was there) is kept only when it is the newest observed; `observedAt` is
clamped to the server's time + 5 min so a skewed clock cannot pin progress. A
write without `observedAt` wins on arrival. Played at `fraction ≥ 0.98` stays
played until `POST /titles/:id/watch {played:false}`.

URLs in grants and plans may be root-relative; clients resolve them on the
server origin and refuse other origins or credentialed URLs. Audio-only plans
offer `transport: 'file'` (progressive AAC with Range) alongside HLS. The last
write wins; the server stamps `updatedAt`. In-progress books join the library's
Continue row like video.

### Capabilities

```ts
interface ServerCapabilities { features: { /* existing … */
  /** Libraries and titles carry media classes and roles. */
  mediaClasses?: Feature & { classes: MediaClass[] };
  /** POST /titles/:id/read and reading progress, for these formats. */
  reading?: Feature & { formats: ReadingFormat[] };
  /** Audio-only plans (PlaybackPlan.media = 'audio'). */
  audioPlayback?: Feature;
} }
```

Ether advertises each flag only once its side ships. Vela gates every new
surface on them, with one exception: audio-only titles play through the
ordinary `POST /playback` path that servers already had, so listening (an
audiobook's Listen and a series' Start listening, which always agree) is off
only when a server explicitly sends `audioPlayback: { available: false }`;
an absent flag allows it. Reading needs its own endpoint and stays gated on
`features.reading`.

## 3. Vela behaviour (for reference; client-only)

- Cards: square covers for music/audiobook/podcast, round artist portraits, book
  covers with a spine for `book`. Library grids pick the column width per shape.
- Pages: artist (hero, top tracks, albums), album (cover, tracklist, play/shuffle),
  series (books in order), book (cover, author, Read, progress), audiobook (cover,
  narrator, chapters, Listen/Resume).
- Player: persistent mini player + Now Playing (queue, shuffle, repeat), audiobook
  mode (chapters, speed, sleep timer), web Media Session. Native lock-screen
  controls need AVAudioSession/MPNowPlayingInfoCenter (Apple) and Media3
  MediaSession (Android).
- Reader: EPUB first (paginated, font size, light/sepia/dark, contents, progress
  sync, keyboard/touch/remote page turns), PDF/CBZ when `reading.formats` lists them.

## 4. Where Vela stands (2026-11-20)

| Area | Web | Native (needs device work) |
| --- | --- | --- |
| Cards and pages | Square, round and bound-book covers in every document; album, artist, book, series, audiobook pages | Same React tree; not yet looked at on a device or TV focus engine |
| Audio | One HTMLAudioElement, Media Session (lock screen, media keys) | Reports unsupported. Apple: audio-only plans in the player module with AVAudioSession `.playback`, MPNowPlayingInfoCenter and MPRemoteCommandCenter. Android: Media3 MediaSessionService with a notification. |
| Reader | foliate-js: EPUB (paginated/scrolled), CBZ, PDF (PDF.js on the main thread) | Reports unsupported. Plan: the same engine in an Expo DOM component (`@expo/dom-webview`), remote paging on TV. |

Server notes for Ether are in section 2 (URLs, file transport for audio, progress ordering).

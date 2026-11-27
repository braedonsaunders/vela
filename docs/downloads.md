# Offline downloads

Vela keeps a title's original file, its text subtitle sidecars and its poster on the
device, plays them without the server, and replays watch progress when the viewer is
back online. Every client that can hold files reliably does this through one core
store and one UI. Clients that can't hold files never offer it.

| Client | Offered | Engine | Where files live | Plays with |
| --- | --- | --- | --- | --- |
| iPhone, iPad | yes | `URLSession` background session | `Application Support/vela-downloads/` (excluded from backup) | AetherEngine, `file://` |
| Android phone, tablet | yes | foreground `DownloadService` (data sync) with a notification | `noBackupFilesDir/vela-downloads/` (app-specific, never backed up) | Media3, `file://` |
| Android TV | yes, when the device can hold a film (below) | the same service | the same | Media3 |
| Mac, Linux (Electron) | yes | Electron main process (Node streams) | `userData/vela-downloads/` | AetherEngine (Mac) and mpv (Linux) from the local path; the web engine when there is no native host |
| Windows (WebView2) | yes | the C# host (`HttpClient`) | `%LOCALAPPDATA%\Vela\vela-downloads\` | mpv from the local path |
| Web browsers | yes, when storage is persistent; otherwise **Save file** | the page (`fetch` streams) | the Origin Private File System | the web engine from a `blob:` URL |
| tvOS | **never** | — | — | — |

## Shared core

`packages/core/src/store/downloads.ts` owns the index (`DownloadRecord`), the progress
outbox, space admission, viewer and server isolation, the local `PlaybackPlan` and
progress replay. Platforms implement only `DownloadsPort`:

- the existing calls: `readSnapshot`/`writeSnapshot` (atomic `index.json` and
  `outbox.json`), `freeBytes`, `startTransfer`, `pauseTransfer`, `resumeTransfer`,
  `removeTitle`/`removeViewer`/`removeServer`, `subscribe` (progress events);
- `traits` (new, required for new ports; iOS keeps its defaults):
  - `engine`: `background` (iOS), `service` (Android), `shell` (desktop), `page` (web);
  - `metered`: whether the Wi-Fi-only setting means anything (iOS, Android);
  - `reserveBytes`: free space to keep (2 GB on devices and desktops; on the web
    the larger of 10% of the origin's quota and 256 MB);
  - `reveal`, `export`: whether the desktop can show a file in its folder or save
    a copy elsewhere;
  - `minimumFreeToOffer`: Android TV's threshold (below);
- `fileUrl(relativePath)` (new, optional): the URL a player and an image view use
  for a stored file. Native ports leave it out, and the core resolves the relative
  path against `baseDirectoryUrl()` as today. Desktop shells return their own
  same-origin download URL (`vela-app://app/vela-downloads/…`,
  `http://vela.localhost/vela-downloads/…`). The web port returns a `blob:` URL of
  the OPFS file;
- `reveal`, `exportCopy` (new, desktop only), `storage()` and `persist()` (new,
  web only: `navigator.storage.estimate()` and `navigator.storage.persist()`),
  `saveFile(request)` (new, web only: the fallback below).

Index paths stay relative (`<serverId>/<viewerId>/<titleId>/…`) on every platform, and
every component is validated: no `..`, separators, NULs or empty segments. The core
rejects any base that isn't `file:///` or the port's declared same-origin
`/vela-downloads/` base.

New pure logic in core, with tests:

- **Resume after interruption.** A port reports a transfer that died with the app,
  the tab or the network as `paused` with `errorCode: 'interrupted'`. The core
  resumes those, and only those, as soon as it's online again. A pause the viewer
  chose stays paused. Resuming always re-resolves the download, which mints fresh
  headers or a fresh Ether grant (reused while it has at least 30 s left), so no
  port ever has to persist credentials.
- **Space admission.** `checkDownloadSpace` takes the port's `reserveBytes` instead
  of the fixed 2 GB constant. On the web, `freeBytes` is quota minus usage.
- **Offer gating.** One `downloadOffer(state)` decides what a title shows:
  `download`, `save-file`, or nothing. Its inputs are the platform's traits, the
  server's permission (`downloadsAvailable`), web persistence, and Android TV's
  free-space threshold.

UI (shared; `apps/vela/app/downloads.tsx`, `packages/skin/src/widgets/title-actions.tsx`):

- The confirmation becomes a cross-platform dialog. `Alert.alert` does nothing on
  react-native-web, so Delete currently fails silently on web and desktop.
- Every control is a focusable `Pressable`, with a visible focus ring for D-pad.
- Desktop rows add **Show in folder** and **Save a copy…**.
- The web library always explains where files are stored and when the browser may
  remove them.
- The Download/Wi-Fi-only and storage-cap settings move to Settings → Downloads.
  The Wi-Fi-only setting appears only where `metered` is set.

## Platform engines

### Android (phone, tablet, TV)

Code lives in `modules/vela-player/android` (`OfflineDownloads.kt`,
`DownloadService.kt`), and the bridge is the same `velaDownloads` port (`Platform.OS
=== 'android'`).

- **Service.** One foreground service of type `dataSync` (with
  `FOREGROUND_SERVICE_DATA_SYNC` and `POST_NOTIFICATIONS`) shows a progress
  notification with Pause and Open Downloads. It stops itself when the queue is
  empty. Transfers run one at a time, in queue order.
- **Transfer.** `HttpURLConnection` streams into `media.<ext>.part`, and
  `Range: bytes=<size>-` resumes it. A transfer pins the `ETag`/`If-Range` and
  restarts from zero if the file changed. On completion the file is renamed
  atomically, then the poster and sidecars are fetched.
- **Credentials and redirects.** Headers live in memory only. Redirects are
  followed manually and only within the request's exact origin (scheme, host,
  port). A redirect to another origin fails the transfer and never forwards
  headers. This matches `MediaScope` and the iOS rules.
- **Network.** `ConnectivityManager` callbacks pause on loss and resume on
  return. Wi-Fi-only requires `NET_CAPABILITY_NOT_METERED`. Transient errors back
  off from 2 s to 60 s.
- **Restart.** On `readSnapshot`, a record left `queued` or `downloading` with no
  live transfer is reported `paused/interrupted`, and the core resumes it with
  fresh headers.
- **Space.** `StorageManager.getAllocatableBytes` (or `StatFs`) gives free space.
  `ENOSPC` gives `no_space` and `neededBytes`.
- **Playback.** The local plan's `file://` URL plays through Media3's
  `DefaultDataSource`. `MediaScope` gains one narrow allowance: a `file:` URI whose
  canonical path lies inside the downloads root. Credentials never apply to it.
  Text sidecars attach as `SubtitleConfiguration`s from their local files.

### Android TV

Android TV runs the same APK and the same engine, but most boxes have 8–16 GB of
flash and only 2–5 GB free. With the 2 GB reserve, Download would fail on most of
them, which is worse than not offering it. So TV offers Download only while
`freeBytes ≥ reserve + 4 GB` (`minimumFreeToOffer`, enough for one typical film).
Below that, the action is hidden, and the Downloads library still shows any
existing downloads.

The library and its rows are D-pad focusable, Back leaves the library, and nothing
there needs touch. We'll verify this on the emulator and the lab's tx1-box. If
that check shows TV still isn't worth it, the fallback is to turn TV off with one
trait; nothing else changes.

### Desktop

- **Mac and Linux (Electron).** `apps/vela-desktop/downloads.js` runs in main:
  `net.request`/Node streams with the same Range, `If-Range` and same-origin
  redirect rules. Files go under `app.getPath('userData')/vela-downloads/`, with
  atomic `index.json` writes and free space from `fs.statfs`.
  - Preload exposes a fixed `__VELA_DOWNLOADS__` bridge, never `ipcRenderer`, and
    only the trusted main frame may call it.
  - `vela-app://app/vela-downloads/<rel>` is served from that folder with Range
    support, after the same path validation.
  - The native hosts map that URL back to the validated local path: Mac
    AetherEngine loads `file://`, and Linux mpv loads the path. Media access
    headers never attach to it.
  - Show in folder uses `shell.showItemInFolder`. Save a copy uses
    `dialog.showSaveDialog` and a streamed copy.
- **Windows (WebView2).** `apps/vela-windows/Downloads.cs` holds the same contract
  over the existing web-message channel (`downloads-*` kinds). It uses
  `HttpClient` with `AllowAutoRedirect = false` and stores files in
  `%LOCALAPPDATA%\Vela\vela-downloads\`.
  - `http://vela.localhost/vela-downloads/*` is served by `WebResourceRequested`
    with Range support.
  - `Playback.cs` loads a local URL straight into mpv as a path, bypassing
    `MediaProxy`, so its origin-scoped token proxy is untouched.
  - Show in folder runs `explorer /select,`. Save a copy uses `SaveFileDialog`.
- **Downloads continue while the app is open.** Closing the app stops them, and the
  next launch resumes them (`interrupted`).

### Web

The web port (`apps/vela/src/data/downloads.web.ts`) is chosen at startup: the
desktop bridge when present, else OPFS, else none.

- **Before the first download** the page calls `navigator.storage.persist()` and
  `navigator.storage.estimate()`.
  - **Persisted:** the title downloads into the OPFS. Writes go through
    `createWritable()` where available, else a sync access handle in a small
    worker. Each chunk is flushed, so a closed tab keeps its partial file.
  - **Not persisted:** Vela doesn't store the title in the browser, because the
    browser may silently evict it. Download becomes **Save file**, with the line:
    “This browser may clear stored videos, so Vela saves the file to your computer
    instead.”
- **Quota.** Space admission runs against quota minus usage, less the reserve,
  before any byte is fetched. A `QuotaExceededError` mid-transfer becomes
  `no_space`.
- **Interruptions.** A closed tab or lost network leaves the record
  `paused/interrupted`. It resumes with Range on the next launch or `online`
  event.
- **Playback.** The local plan carries a `blob:` URL for the OPFS file. The web
  engine opens a `blob:` URL of its own origin with a local byte reader
  (`Blob.slice`), with no fetch credentials and no media authorization.
  `permittedMediaURL` is unchanged, and server URLs still need an in-scope grant.
- **Save file.** Through an Ether grant, it's a plain `<a download>` of the
  capability URL, which carries no token, so it works in every browser, including
  Safari and Firefox. For header-authenticated servers (Plex, Jellyfin, Emby), it
  streams `fetch` with headers into `showSaveFilePicker` (Chromium). Where that API is
  missing, only that path is unavailable, and the title says: “This browser can't save
  videos from this server. Use the Vela app on your phone or computer to download it.”
  Vela never puts a token into a link the browser would remember.
- **The Downloads library always states:** “Downloads are kept in this browser's
  storage for this site. Clearing site data or uninstalling the app removes them.”
- **Offline launch** uses the existing PWA service worker and the core's
  `offline` phase.

### tvOS

Confirmed: tvOS gives apps no durable local storage. `Caches` and `tmp` can be
purged at any time, the Documents and Application Support persistent store is not
available, and local storage is capped at 500 KB of `NSUserDefaults`.
`velaDownloads` is `undefined` when `Platform.isTV`, so `downloads.supported` is
false, and the title action, the Downloads entry and the offline routes never
appear. A test pins this.

### Desktop bridge (version 1)

Both shells install `window.__VELA_DOWNLOADS__` before the page runs (Electron's preload over
IPC to main, Windows by an injected script over `chrome.webview` messages), and only the
trusted app frame may use it:

```ts
{ version: 1,
  base: 'vela-app://app/vela-downloads/' | 'http://vela.localhost/vela-downloads/',
  call(method, ...args): Promise<unknown>,  // readSnapshot, writeSnapshot, freeBytes, startTransfer,
                                            // pauseTransfer, resumeTransfer, removeTitle, removeViewer,
                                            // removeServer, reveal, exportCopy (DownloadsPort shapes)
  subscribe(listener): () => void }         // DownloadTransferProgress events
```

`apps/vela/src/data/downloads-shell.ts` turns it into the page's `DownloadsPort`.

### Local file routes

Every route from a URL to a stored file goes through the same steps, with a test on each
platform:

1. Decode the URL.
2. Refuse `..`, `.`, empty segments, backslashes, NULs and drive letters, and refuse encoded
   separators before decoding.
3. Join the result under the downloads root.
4. Resolve symlinks (`realpath`, `Path.GetFullPath` plus a reparse-point check, Android
   `File.canonicalPath`).
5. Require the resolved path to stay inside the resolved root.

These routes are the desktop shells' `/vela-downloads/` routes, the native hosts'
URL-to-path mapping, and Android's `MediaScope` local allowance.

## Viewers, sign-out and removed servers

Downloads belong to the server and viewer that made them, as on iOS. Files sit under
`<serverId>/<viewerId>/`. The library, `planFor`, `posterFor` and the offline routes
see only the active `(serverId, viewerId)`. Another Plex Home profile, another Ether
viewer or another server can't list, play or resolve them. All of this lives in core,
so every platform behaves the same.

Deletion is the same everywhere because core does it:

| Event | What happens to files |
| --- | --- |
| Sign out | That viewer's downloads and pending progress on that server are deleted |
| Remove a server | Every viewer's downloads for that server are deleted |
| Server refuses the session (401, "session ended") | That viewer's downloads are deleted |
| Switch profile or server | Nothing is deleted; the files are hidden until that viewer returns |

The UI asks first. Sign out and Remove server say how many downloads on this device
will be deleted and wait for confirmation. A refused session can't ask, because the
server has already ended it.

## Permission changes

This follows iOS today:

- A completed download stays playable offline after the server withdraws permission
  (Plex `allowSync` turned off, Ether downloads disabled or a grant revoked). The
  server allowed the copy when it was made, and Vela can't confirm a withdrawal while
  offline.
- Starting, resuming or replacing a download always asks the server again
  (`downloadsAvailable`, then the grant or part request). A refusal (`downloadsAvailable`
  false, or 401/403) ends the transfer as `failed`/`forbidden` with the server's
  message, and it is never retried automatically.
- Ending the viewer's session (401) deletes that viewer's downloads, as above.

## Servers and permissions

| Server | Permission | Transfer | Progress replay |
| --- | --- | --- | --- |
| Ether | `features.downloads.enabled` and the grant (`POST /titles/:id/download`: version, quota, `maxPerDay`, 403/409/429) | capability URL, no headers | `POST /titles/:id/watch` with `offline: true` |
| Plex | per-account root `allowSync` and per-title `allowSync`; the server enforces it on `?download=1` | `Part.key?download=1` with Plex headers | `/:/timeline` and scrobble (existing) |
| Jellyfin, Emby | `Policy.EnableContentDownloading` from `GET /Users/{id}`; the server enforces it on `/Items/{id}/Download` | `/Items/{id}/Download` with `X-Emby-Authorization` (never `api_key` in the URL); size and source from `MediaSources[0]` | user data `PlaybackPositionTicks` / `Played` (new) |

Every platform asks the same adapter, so permissions are identical everywhere.
`downloadOffer` hides Download when the server says no. A 401/403 during a transfer
fails it as `forbidden` with the server's message, and a 401 that ends the session
removes that viewer's downloads, as on iOS. Completed copies stay playable offline,
because the server allowed them when they were made; replacing or resuming a copy
always asks again.

## Safety

- **Credentials.** Tokens never appear in file paths, index records, URLs Vela
  stores or logs. Transfer headers are held in memory and never written to disk on
  Android, desktop or the web. Errors and events carry codes and messages only,
  never URLs.
- **Download hosts.** A download request goes only to the resolved server origin;
  redirects are allowed within the same exact origin only. Auxiliary fetches
  (poster, sidecars) follow the same rule.
- **Local media.** Local playback opens only paths inside the downloads root, or
  `blob:` URLs of the app's own origin. Media authorization (`protocol/media.ts`,
  Android `MediaScope`, `permittedMediaURL`, desktop `setAccess`) keeps its exact
  origin and path rules for every server URL. The new local branches are separate
  and carry no credentials.

## Tests

- **Core.** Interrupted versus user-paused resume, reserve-based admission (device
  and web quota), `downloadOffer` gating on each platform, port base validation,
  and a local plan with `fileUrl`.
- **Adapters.** Jellyfin/Emby policy, resolution and replay, against the routed
  fetch stand-in.
- **Mock e2e** (`tests/e2e/mock/downloads.e2e.ts`, `VELA_MOCK_DOWNLOADS=1`):
  - download a title into the OPFS;
  - interrupt it with a mock fault, then resume;
  - play it offline;
  - replay progress;
  - delete it;
  - the Save file fallback when persistence is denied.

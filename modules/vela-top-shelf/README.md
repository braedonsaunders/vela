# @vela/top-shelf

Apple TV's Top Shelf shows what the viewer is in the middle of: Home's Continue Watching row,
on any server, with each title's progress. Selecting a card (or pressing Play on it) opens Vela
and resumes the title. Signed out, or with nothing in progress, tvOS shows the static artwork
`@react-native-tvos/config-tv` sets (`apps/vela/tvos/topshelf-*.png`).

- `src/model.ts` (pure, tested): the snapshot. `topShelfPublication` takes the video titles of
  the first `continue` row that has any (at most `TOP_SHELF_LIMIT`, titles clipped), with a
  `vela://resume/<title>?owner=<viewer>` link each. `TopShelfSync` keeps the App Group in step with
  the session: written when the shelf changes, cleared on sign-out and for a new viewer (a server
  switch or a Plex Home profile) until their own Home is read; rows read for the previous viewer
  are never written for the next. `topShelfLinkAction` resumes a link only for the server and
  viewer it was written for; anyone else lands on Home.
- `ios/VelaTopShelfModule.swift` (tvOS only; the podspec is tvOS-only, so iPhone, iPad and
  Android link nothing): writes `snapshot.json` and the pictures into the App Group's
  `Library/Caches/TopShelf`, and tells tvOS the shelf changed. A server's image URL can carry a
  transient credential, so pictures are fetched once in memory, scaled to at most 1280 px and
  stored as JPEG files named by a digest; the snapshot holds file names, never URLs. Calls carry
  a rising sequence and a publish overtaken while it downloads never commits.
- `extension/VelaTopShelfExtension.swift`: the TV Services extension's `ContentProvider`. It reads the
  snapshot and pictures only (no network, no credentials) and returns one sectioned row, or nil
  for the static artwork.
- `plugin/index.js` (`app.json` plugins: `@vela/top-shelf`): at an Apple TV prebuild
  (`EXPO_TV=1`) only, adds the extension target `VelaTopShelfExtension` (bundle ID
  `<app>.topshelf`, embedded in PlugIns), the App Group `group.<app>` on the app and the
  extension, and `VelaAppGroup` in both Info.plists. iPhone, iPad and Android prebuilds are
  unchanged.

The app side is `apps/vela/src/top-shelf.ts` (the session and Home rows into `TopShelfSync`) and
`apps/vela/app/resume/[id].tsx` (the link: wait for the session, then the watch route with the
server's resume point, or Home). Signed out, the app's gate sends the link to sign in first; it
comes back without its owner and lands on Home.

Release builds: `tools/testflight.sh` gives the extension the app's version and build number.
Both App IDs need the App Group in their provisioning profiles. See the
[TestFlight signing instructions](../../docs/distribution.md#testflight-apple-tv-iphone-and-ipad).

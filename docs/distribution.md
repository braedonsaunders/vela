# Web distribution

Ether serves the Expo web/PWA artifact under `/vela/`. Native delivery is separate.
Build and signing do not publish. Production publication is a separate maintainer action.

### Expo packaging command and captured inputs

The exporter captures a committed workspace and builds the single Expo app:

```sh
source tools/env.sh
bun tools/release/build.ts --player-assets=<payload-directory> --committed
```

`<payload-directory>` is `<out>/player/<digest>` and contains only its exact inventoried
files. The exporter writes provenance to `<out>/PLAYER-ASSETS-MANIFEST.json`; packaging
places it at the release root, covered by the signed inventory. This is the new static player payload, not an old diagnostic/runtime archive.
The default command captures HEAD and refuses dirty build inputs; `--committed`
allows unrelated working edits while still using HEAD only. Release tooling itself
must be committed. Version comes from captured `apps/vela/package.json`.

Captured inputs are `apps/`, `packages/`, `modules/`, `tools/`, `brand/`, root
`package.json`, `bun.lock`, `bunfig.toml` and `THIRD_PARTY_NOTICES`. Core is in
`packages/core/src`, resolver/base in `packages/skin/src/resolve`, wire types and
fixtures in `packages/protocol`, web engine in `modules/vela-player/web/engine`,
and app assets in `apps/vela/assets`. No Exact checkout or native prebuild belongs
in the web build graph.

The staged build uses the frozen hoisted workspace install, app `assets.ts`,
`routes.ts /vela`, `tools/skin-documents.ts <dist>/skins` and
`tools/skin-renderer.ts`. Expo exports the single-page app with `VELA_WEB_BASE=/vela`
and verified `EXPO_PUBLIC_VELA_PLAYER_ASSETS=<digest>`. It preserves Expo's HTML
and import graph, adds `manifest.webmanifest`/PWA resources and the exact payload,
then inventories the final root. There is one archive/full manifest, recording
`skinRenderer` and `playerAssetsDigest`; no engines, Exact revision or universal key.
The signed descriptor also uses `playerAssetsDigest` and drops `engines` and
`universalRuntimeKey`.

Expo/Metro come from the captured workspace/lockfile. The base is export-only:
native builds omit it. Only deliberately public configuration belongs in
`EXPO_PUBLIC_*`; credentials, private keys and mock sessions never enter a release.
Native binaries have separate distribution and do not enter this web archive.
Keep generated capture/export/payload output outside source control.

### Preserve the export graph

The archive root is Expo's generated `index.html`, with no HTML replacement loader
or post-export JavaScript/URL string rewriting. A correct export has:

- `index.html` and `metadata.json` at export root;
- `_expo/static/js/web/` chunks named `entry`, `__common`, `_layout`, `index`,
  `[id]` and `__expo-metro-runtime`, each with a content-hash suffix;
- hashed files under `assets/`.

All emitted URLs are absolute under `/vela`. Configure the base at export time;
do not invent an Exact-style `/vela/app/V/` asset subtree. Preserve every chunk,
platform manifest, font, image, notice and linked resource, including chunks not
requested during an initial Home visit. Fixed-name `metadata.json` revalidates.

SPA mode does not emit a route manifest. The app's exporter provides one: run
`bun apps/vela/scripts/routes.ts [base]` from the captured repository root; base
defaults to `/vela`. Packaging writes its stdout as `routes.json` at the archive
root. Generate it from the captured tree rather than copying an older list. It
derives routes from the expo-router app directory: index
maps to its directory, `[x]` maps to `:x`, route groups disappear, and `_layout`
and `+` files are skipped. The table grows as real screens land; do not invent
routes that are absent from the captured revision.

Ether routes `/vela/v0/` before the SPA and returns index.html only for declared
app routes. Missing static files remain 404s, not HTML. Confirm deep links and
canonical `/vela` behavior against the real export before installer qualification.

`_expo/static/**` and `assets/**` content-addressed files are immutable while their
release is retrievable. HTML, routes, PWA/worker and mutable metadata revalidate.
The installer must keep previously verified hashed assets available to existing
tabs through an update, without overwriting new files or copying arbitrary old
HTML. Exercise an old tab requesting a previously unfetched chunk after update.

### Player assets and skins

Metro owns the web player JavaScript and view through `VelaPlayerView.web.tsx`.
Do not package a second browser runtime.js or resurrect an Exact native host.
Decoder WASM packages, worklets, subtitle resources and other non-Metro assets are
a separate player-build output under `player/<digest>/` within the export; the
player loads them relative to the configured `/vela` base. The player asset builder owns
the dependency/source/licence inventory. The static payload digest
is the full lowercase SHA-256 of the UTF-8 concatenation of sorted records:

```
relativePath + NUL + decimalByteCount + NUL + lowercaseFileSha256 + newline
```

Sort paths bytewise using ASCII names; reject control characters (including NUL
and newline), backslashes, absolute paths, empty/dot/parent segments, duplicate
paths and links. Byte counts are nonnegative safe integers in canonical decimal
form, without leading zeros except zero itself. Per-file hashes are 64 lowercase
hex characters. Exclude the payload manifest itself from this aggregate. Recompute
every file's size/hash before accepting the aggregate, and reject unlisted files.
The served base is exactly `/vela/player/<64-hex-digest>/` on the app's origin,
without credentials, query or fragment.

Only external asset files belong here, organized under `libraries/`, `sources/`
and notices; include worklets/subtitle helpers in that static inventory. Core/view
JavaScript remains in Metro. There is no runtime.js or diagnostic index. The
manifest retains full source revision, `sourceDirty:false`, exact dependency pins,
corresponding source archives, licences and the complete safe-relative file list.
Its own bytes are covered by the signed full release inventory even though the
aggregate excludes it. The manifest is named
`PLAYER-ASSETS-MANIFEST.json` and has fields `schemaVersion:1`, `digest`,
`sourceRevision`, `sourceDirty`, `dependencies` and `files`. The builder is now
`bun modules/vela-player/web/assets/export-assets.ts --libraries=<prepared-libraries> --out=<staging>`.
It writes `<staging>/PLAYER-ASSETS-MANIFEST.json` and prints the payload digest.
Revision-bearing provenance stays outside `player/<digest>/`, so identical payloads
retain byte-identical URLs across app releases.
The app export uses public `EXPO_PUBLIC_VELA_PLAYER_ASSETS=<digest>` to address that
same tree. A qualified prepared input and actual app playback remain delivery gates. A diagnostic payload or host seam proof is not a release
input. The old Exact runtime-key algorithm and CORE-MANIFEST input are not carried
forward.

The `tools/skin-documents.ts <out>` produces the catalog from
`packages/protocol/fixtures/skins`. Built-in skin documents and assets remain data, with real ids/names,
schema/renderer compatibility and the same complete release inventory. The release
packager owns the single catalog output at `<dist>/skins`, avoiding duplicate Metro
and packager copies. React renderer metadata comes
from `tools/skin-renderer.ts`, not the deleted Contract tables; theme values live in
`packages/skin/src/theme.ts`. Theme, artwork, API and media
requests retain their current same-origin/privacy rules. A PWA worker may cache
only digest-verified static resources; it must never cache API responses, artwork
grants or media. Expo web install/update handling must be qualified explicitly.

### Installation and release qualification

Distribution uses Ed25519 signatures over exact bytes, separate production and
test keys, compatibility and expiry checks, complete archive verification and
atomic activation. The app manifest uses `/vela/` as its base path and inventories
the final static root. Manifests remain outside the archive to avoid self-hashing.
The installer verifies the static player tree against `playerAssetsDigest`.

Before publishing a release, inspect the artifact for credentials and unintended
origins, exercise navigation and playback, and qualify installation, updates,
rollback and retained immutable assets against the server. Offline and native
behavior require their own qualification. Record what was actually observed;
packaging success alone does not establish platform readiness.

Production signing and publication are explicit maintainer actions for an exact
version. Keep private keys and local qualification records outside the repository.

## Desktop apps

The desktop apps carry the web release's own bytes and run standalone: the page is told it is a
desktop app (`window.__VELA_DESKTOP__`), implies no server, and connects to any Ether, Jellyfin,
Emby or Plex server the viewer adds. They update from Vela's GitHub releases, not from a server.

- **Windows** (`apps/vela-windows`): WebView2 serves the UI at `http://vela.localhost/vela/` and
  libmpv plays under it. `build.ps1 -Version <x.y.z> -Ui <release folder>` publishes the host, adds
  the pinned libmpv and builds `Vela-Setup-<version>-x64.exe` with Inno Setup 6.
- **macOS and Linux** (`apps/vela-desktop`): Electron serves the UI at `vela-app://app/vela/` and the
  in-app engine plays. `npm ci && node build.mjs --ui=<release folder> --mac|--linux` makes DMG and
  zip (ad-hoc signed unless a Developer ID is configured) or AppImage and deb.

`<release folder>` is the extracted `vela-<version>.tar.gz`. Attach the installers to the same
`v<version>` GitHub release after `publish.ts`, for example
`gh release upload v<version> Vela-Setup-*.exe Vela-*.dmg Vela-*.zip Vela-*.AppImage Vela-*.deb`.
The apps look for a `Vela-Setup-*-x64.exe` asset (Windows) and the release page (macOS, Linux).

## TestFlight (Apple TV, iPhone and iPad)

`tools/testflight.sh` archives the native app for tvOS and then for iOS (iPhone and iPad), signs it
for the App Store, uploads both builds to App Store Connect and hands them to TestFlight:

```sh
tools/testflight.sh                      # both platforms; prints "Vela <version> build <n>"
tools/testflight.sh --platform ios       # one platform
tools/testflight.sh --internal-only      # internal group only, no Beta App Review submission
tools/testflight.sh --whats-new notes.txt
tools/testflight.sh --no-upload          # archive and export an .ipa locally (no key needed to archive)
bun tools/release/asc.ts status          # processing and review state, and the public link
```

The app ships as one App Store Connect app, `app.ether.vela`, with iOS and tvOS platforms. Each
platform is a clean `expo prebuild` (with `EXPO_TV=1` for tvOS), so `apps/vela/ios` is left
generated for the last platform built. `tools/apple-tv.sh` and `tools/ios.sh` regenerate it when
they need the other platform. The version is `app.json`'s `version`. The build number
(`CFBundleVersion`, shared by both platforms) is Android's `versionCode` for the first upload of a
version, then `<versionCode>.1`, `.2` and so on. `asc.ts next-build` reads the uploads already in
App Store Connect, so the number always goes up. `--build-number` overrides it. Store builds
run standalone: `EXPO_PUBLIC_VELA_*` lab settings and `.env` files are ignored.

Signing is automatic and cloud managed. `xcodebuild` archives with the team's development
identity, then `-exportArchive` (`method` `app-store-connect`, `destination` `upload`,
`uploadSymbols`) re-signs with a cloud-managed Apple Distribution certificate and uploads. Both
steps authenticate with the App Store Connect API key, so the Mac needs no distribution
certificate, profile or Xcode account. Upload validation runs as part of the export, and its
errors (ITMS-*) are in `<build dir>/<platform>-export.log`.

The tvOS build embeds the Top Shelf extension (`modules/vela-top-shelf`), bundle ID
`app.ether.vela.topshelf`, in `Vela.app/PlugIns`. The app and the extension share the App Group
`group.app.ether.vela`. The script gives the extension the app's version and build number, which
App Store validation requires. Verify both provisioning profiles include that group before
uploading. If the archive reports an application-groups entitlement mismatch, an Account
Holder or Admin can register `group.app.ether.vela` in Certificates, Identifiers & Profiles,
then enable App Groups and assign that group on both `app.ether.vela` and
`app.ether.vela.topshelf`. Re-run `tools/testflight.sh --platform tvos --no-upload` to
regenerate the profiles and check the local App Store export. The iOS build has no extension
and no App Group. [Register an app group](https://developer.apple.com/help/account/identifiers/register-an-app-group/)
and [enable app groups](https://developer.apple.com/help/account/identifiers/enable-app-capabilities/).

Before the export, the script lowers the embedded frameworks' `MinimumOSVersion` to the app's
(18.0) and re-seals them. FFmpegBuild 3.15.0's frameworks claim 26.0, although their binaries
target 16.0, and validation refuses a framework that claims more than the app (ITMS-90208). On
iOS, Expo's precompiled modules embed `libavif`, `SDWebImage` and its coders as unsigned
prebuilt frameworks, and `libavif` has no privacy manifest. Apple accepted 0.2.49 that way. If an
upload ever fails with ITMS-91061 or ITMS-91065 for them, set `EXPO_USE_PRECOMPILED_MODULES=0` for
the store build so they build from source, as they already do on tvOS.

After the uploads, `asc.ts distribute` waits for Apple to process each build. It then adds the
"What to Test" notes, gives the builds to the internal group **Vela team** (which has every
build), adds them to the external group **Public**, submits them for Beta App Review and turns on
the group's public link. The first build of a version waits for Beta App Review, usually a day;
later builds of that version are normally approved automatically. Internal testers can install
as soon as processing finishes (5–30 minutes). Builds expire after 90 days.

### One-time setup

1. **API key.** App Store Connect > Users and Access > Integrations > App Store Connect API >
   Team Keys > +, access **Admin**. Cloud-managed distribution signing needs Admin; App Manager
   keys fail at export. Put the issuer ID, key ID and the `.p8` text in
   `~/.config/vela-release/asc.env` (mode 0600) as `ASC_ISSUER_ID`, `ASC_KEY_ID` and
   `ASC_PRIVATE_KEY`. `asc.ts key-file` writes the `.p8` beside it for `xcodebuild`. Never commit
   either file.
2. **App record.** The API cannot create apps. `asc.ts setup` registers the bundle ID. Then:
   App Store Connect > Apps > + > New App, platforms iOS and tvOS, bundle ID `app.ether.vela`,
   SKU `vela`. The record is "Vela for Ether" (Apple ID 6838376478); the public TestFlight link
   is https://testflight.apple.com/join/3stC2TNe.
3. **Test information.** `tools/testflight/beta.json` holds the public text: beta description,
   default "What to Test", privacy policy ([privacy.md](privacy.md)) and reviewer notes. Personal
   details live in `~/.config/vela-release/testflight.env`:

   ```sh
   VELA_TESTFLIGHT_FEEDBACK_EMAIL=...
   VELA_TESTFLIGHT_INTERNAL_TESTERS=owner@example.com   # App Store Connect users, comma separated (default: the account holder)
   VELA_REVIEW_CONTACT_FIRST_NAME=...
   VELA_REVIEW_CONTACT_LAST_NAME=...
   VELA_REVIEW_CONTACT_PHONE=...
   VELA_REVIEW_CONTACT_EMAIL=...
   VELA_REVIEW_DEMO_SERVER=https://...                  # a server Beta App Review can sign in to
   VELA_REVIEW_DEMO_KIND=Jellyfin
   VELA_REVIEW_DEMO_USER=...
   VELA_REVIEW_DEMO_PASSWORD=...
   ```

   `asc.ts setup` (run by every upload) creates the two groups and writes this information.
   Beta App Review signs in to Jellyfin's public demo (`https://demo.jellyfin.org/stable`, user
   `demo`, no password).
   Without the contact details and feedback email, builds reach the internal group only.

Export compliance is answered by `ITSAppUsesNonExemptEncryption = false` in `app.json`: Vela
uses only the system's TLS. The privacy manifest (`PrivacyInfo.xcprivacy`, from the Expo
template) declares the required-reason APIs: UserDefaults (CA92.1), file timestamps (0A2A.1,
3B52.1, C617.1), disk space (E174.1, 85F4.1; AetherEngine's cache budget) and system boot time
(35F9.1). It also declares no tracking and no collected data. React Native, Expo and the pods add
their own manifests. `NSLocalNetworkUsageDescription` covers servers on the local network. Vela
does no Bonjour or broadcast discovery, so it declares no Bonjour services.

**LGPL components.** FFmpeg (FFmpegBuild 3.15.0's AetherLib frameworks) and FriBidi 1.0.18
(`Fribidi.framework`, from `modules/vela-player/ios/ass/build.sh`) ship as separate dynamic
frameworks inside `Vela.app/Frameworks` (the Mac app keeps them, with `Libass.framework`, in
`Contents/Resources/native-mac`), so they stay replaceable. Their licence texts and source
pointers travel in the `VelaPlayerLicenses` bundle. AetherEngine is LGPL-3.0 with an App Store
exception, built from unmodified 7.70.0 source; see
`modules/vela-player/ios/AETHER.md`, "Distribution notices". libass, HarfBuzz and FreeType are
permissive and linked into `Libass.framework`. An App Store release should also show these
notices in the app.

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

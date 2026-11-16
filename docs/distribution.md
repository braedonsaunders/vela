# Vela web distribution

Vela is built separately from Ether. Ether installs a pinned static artifact and
serves it on its own origin under `/vela/`. No separate API hostname is part of
the production deployment. Build and signing commands never publish. Publishing is a separate owner-approved command, first shipping with Ether 0.3.13; Ether 0.3.12 did not ship Vela.

## Expo web export

Current orchestration: `thr_4q8296jknz`; release tooling: `thr_88bpxte5e5`.
RN/Expo is the current architecture. Web/PWA remains a delivery target: Ether
serves the `apps/vela` export at `/vela`. Ether 0.3.13 itself ships without Vela.
The old Exact 0.1.42 installer result below is historical evidence, not Expo
qualification. The dated Expo evidence below records the current local candidate;
no public publication has occurred.

Source relocation landed in `5d7a099` / `dfd862e`, renderer identity in `3b933a2`.
The Exact app/dispatch was removed in `d47098c`; exporter integration landed in
`a9d195c`. The legacy sections
below preserve prior installer/signing contracts and proof; their Exact commands
must not be used as the current RN build instructions.

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
Bulky capture/export/payload output stays under scratch-backed `.artifacts/release/`.

### Preserve the export graph

The archive root is Expo's generated `index.html`, with no HTML replacement loader
or post-export JavaScript/URL string rewriting. The migration lead verified:

- `index.html` and `metadata.json` at export root;
- `_expo/static/js/web/` chunks named `entry`, `__common`, `_layout`, `index`,
  `[id]` and `__expo-metro-runtime`, each with a content-hash suffix;
- hashed files under `assets/`.

All emitted URLs are absolute under `/vela`. Configure the base at export time;
do not invent an Exact-style `/vela/app/V/` asset subtree. Preserve every chunk,
platform manifest, font, image, notice and linked resource, including chunks not
requested during an initial Home visit. Fixed-name `metadata.json` revalidates.

SPA mode does not emit a route manifest. The app-owned exporter landed in
`99b47e9`: run `bun apps/vela/scripts/routes.ts [base]` from the captured repository
root; base defaults to `/vela`. Packaging writes its stdout as `routes.json` at
the archive root. The initial spike output contained `/vela` and `/vela/title/:id`; the current
route tree also has auth, watch, library, collection and live screens. Generate
from the captured tree rather than copying that old two-route observation. It derives routes from the expo-router app directory: index
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
HTML. Agree the exact retained paths and filename rules after inspecting Expo's
output. Exercise an old tab requesting a previously unfetched chunk after update.

### Player assets and skins

Metro owns the web player JavaScript and view through `VelaPlayerView.web.tsx`.
Do not package a second browser runtime.js or resurrect an Exact native host.
Decoder WASM packages, worklets, subtitle resources and other non-Metro assets are
a separate player-build output under `player/<digest>/` within the export; the
player loads them relative to the configured `/vela` base. Playback owns that
builder and dependency/source/licence inventory. The agreed static payload digest
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
aggregate excludes it. Playback confirmed the filename
`PLAYER-ASSETS-MANIFEST.json` and fields `schemaVersion:1`, `digest`,
`sourceRevision`, `sourceDirty`, `dependencies` and `files`. The builder is now
`bun modules/vela-player/web/assets/export-assets.ts --libraries=<prepared-libraries> --out=<staging>`.
It writes `<staging>/PLAYER-ASSETS-MANIFEST.json` and prints the payload digest.
Revision-bearing provenance stays outside `player/<digest>/`, so identical payloads
retain byte-identical URLs across app releases.
The app export uses public `EXPO_PUBLIC_VELA_PLAYER_ASSETS=<digest>` to address that
same tree. A qualified prepared input and actual app playback remain delivery gates. A diagnostic payload or host seam proof is not a release
input. The old Exact runtime-key algorithm and CORE-MANIFEST input are not carried
forward.

The release owner's replacement `tools/skin-documents.ts <out>` produces the catalog from
`packages/protocol/fixtures/skins`. Built-in skin documents and assets remain data, with real ids/names,
schema/renderer compatibility and the same complete release inventory. The release
packager owns the single catalog output at `<dist>/skins`, avoiding duplicate Metro
and packager copies. React renderer metadata comes
from `tools/skin-renderer.ts`, not the deleted Contract tables; theme values live in
`packages/skin/src/theme.ts`. Theme, artwork, API and media
requests retain their current same-origin/privacy rules. A PWA worker may cache
only digest-verified static resources; it must never cache API responses, artwork
grants or media. Expo web install/update handling must be qualified explicitly.

### Signed installer contract and gates

Keep the existing Ed25519 exact-byte signature, dedicated production/test key
separation, owner-triggered check/install, compatibility/expiry checks, complete
tar verification, atomic activation, additive preservation and two-rollbacks
policy. Build one archive and one finalized app manifest. The agreed app manifest
`basePath` is `/vela/`; its files cover the final static root and agree exactly
with the full build inventory. Both manifests stay outside the archive to avoid
self-hashing. Preserve clean source and pinned workspace/toolchain provenance.
Ether confirmed the unreleased signed descriptor uses `playerAssetsDigest` for
the full 64-hex static-payload digest, replacing `universalRuntimeKey` with no
legacy branch. The installer recomputes it from the installed `player/<digest>/`
tree and refuses a mismatch; the full build inventory also covers the payload
manifest's SHA-256. The first real Expo export supplies the signed fixture before
Ether implements this schema change. Do not reuse old runtime-key semantics. Ether has been told to
hold the Exact-specific app-schema change and keep the distribution implementation.

Implementation and qualification order:

1. The initial export/base/route spike has dated evidence. Source moves are now
   committed; obtain an integrated compile and a fresh release artifact from the
   final captured workspace and qualified player assets.
2. Finish/commit the release worker's exporter and signing changes above, preserving
   verification modules and retiring the Exact build path coherently. Implementation
   is not artifact or installer qualification.
3. Inspect the export for secret-free, same-origin URLs and complete dependencies;
   record entry raw/gzip and cold-load results. Drive deep links, login, skin
   switching, player asset loading, offline/update behavior and missing-asset 404s.
4. Sign a local test-key file-channel fixture using the real exporter. Ether repeats
   check/install/rollback/reinstall and verifies the app inventory, old-tab assets
   and owner-staged additive preservation, with no public upload.
5. Obtain owner approval for the exact version before production signing and the
   deliberate public publish command. No public release is authorized by this plan.

## Expo candidate evidence (2026-11-16)

The parent built Vela 0.2.0 from clean source
`a9d195c2378aad63adc7ed4d60264e7d5be4398a`. The archive is 98,321,945 bytes,
SHA-256 `c8acd01b86eb9c18e4a4181e840c9072f04bc344d724458d90602468c24c2c99`.
`verify-release.py` accepted all 245 files and player digest
`1ca493ce565369eb83a8c9479dfad9c397931e5b5686d4b66356ffd4ca4e1b80`.
The exported entry chunk is 1,117,094 bytes, or 293,015 bytes with gzip level 9.
These are file sizes, not cold-load timing measurements.

The actual exported HTML includes `/vela/manifest.webmanifest` and `/vela/pwa.js`
through the app-owned `public/index.html` template. A browser observed the active
service worker scoped to `/vela`. Through a temporary same-origin lab proxy, the
archive supported non-owner sign-in, Outlander episodes while extras were pending,
automatic detail refresh, completed Extras/trailer actions, and decoded Se7en video
with an advancing playback clock. Escape closed Audio while playback remained on
the watch route. This is web evidence; it does not qualify physical tvOS Menu behavior.

The existing `lab-test-v1` Keychain identity signed the exact fixture. Its local
publish dry run verified four signed/upload inputs and reported `publicActions:0`.
The fixture is under
`~/.scratch/vela-build/rn-spike/artifacts/release/signed-0.2.0-ready/`;
`lab-test-v1.pub` contains only the public pin. No production key or public channel
was used. Preserve this immutable fixture while qualification is pending.

Ether owner `thr_9jsg8ia37s` reports signed check/install and real 0.2.0 sign-in
passing. Rollback exposed an Ether retention defect: outgoing Expo chunk/player
requests returned old SPA HTML. The installer owner is correcting additive retention
and repeating rollback/reinstall and untouched-tab navigation. Until that completes,
the new distribution flow is not release-qualified. Offline/update PWA behavior,
physical native playback/preview transitions, and full phone/tablet interaction also
remain open. Later native sign-in/preview source commits are not in this web fixture;
any new release must capture and identify its own committed revision.

The later 0.2.1 fixture captures
`469c8006ff954b03d4c6a6908c5e2694d6d61cbd`, including the native sign-in/preview
attempts and the first-card preview alignment. Its archive is 98,322,068 bytes,
SHA-256 `579de1109659166602f82cd997157e99e1359a018a63d11b69e7599ffc057a1f`.
All 245 files and the same player digest verify; lab-test signing and a zero-action
publish dry run pass. The packaged app signs in with Enter and shows the first
card's actual synthetic preview and complete caption inside the viewport.
The immutable fixture is in the sibling `signed-0.2.1-ready/` directory. Ether
owns the actual 0.2.0-to-0.2.1 update/rollback check. Android's focused preview
still remains hidden after the later native build, so neither fixture is presented
as full native qualification or approval for production publication.

## Historical Exact packaging and installer reference

Everything from this heading through the historical payload section records the
Exact release baseline and its contracts. Per-engine manifests, `engines.json`,
`universalRuntimeKey`, `client/renderer/version.json` and Exact build commands are
legacy details. The Expo replacement uses one app and `playerAssetsDigest` as
specified above. Preserve signing/verification, privacy, rollback and source/notice
obligations; do not treat historical CLI examples as current migration instructions.

### Legacy local packaging

Run `source tools/env.sh` then `bun tools/release/build.ts` from this repository.
For an approved committed release while other workers have edits in progress, use
`bun tools/release/build.ts --committed`. It archives the captured HEAD's client
and protocol inputs without touching the shared working tree. Release tooling
must itself be committed. The manifest's sourceDirty describes those build inputs.
Version is `client/package.json`'s version when present, otherwise
`tools/release/VERSION`. Increment it for each release; existing outputs are never
overwritten. The checked-out Exact revision must match `EXACT_REVISION`.

External image/font assets receive content-hashed filenames, and complete static
data-URI images/fonts are emitted as hashed static files. ESM entry/import URLs
remain canonical. Dynamic symbol/mask expressions stay with their owning runtime.
See [bundle-size.md](bundle-size.md) for measured byte costs and remaining limits.
When byte attribution is requested, add `--map-report`: the same captured source
produces `vela-<version>.bundle.json` with raw/gzip9 entry bytes and plan node
counts by skin and component. This opt-in measurement is not part of routine builds.

Output under `.artifacts/release/`:

- `vela-<version>.tar.gz`: `index.html` and the complete static tree at archive root.
- `vela-<version>.manifest.json`: schema version 1, client version, supported wire
  protocol versions, Exact revision, UTC build time, source commit and dirty flag,
  base path and same-origin API policy, archive filename/size/SHA-256, and each static file's path/size/SHA-256.
- `.sha256` sidecars for both files, using ordinary sha256sum text format.

Builds use a temporary source snapshot inside that scratch directory. Only staged
route declarations are prefixed with `/vela`; staged HTML base URLs and the PWA
start URL is `/vela` and scope is `/vela` (which includes the canonical home URL). The packager runs the player bundle and Exact's
production `web-build --out` with prerendering disabled: sign-in and personalized
content are rendered at runtime. No viewer token, demo session, mock artwork or
mock media is included. Build intermediates are deleted when the command exits.
The sourceDirty field records current edits included in a local build; publish
only an artifact from an agreed, committed source revision. Generated release
outputs are local scratch and must be copied to durable hosting before publishing.

### Legacy installer inputs and verification

The installer trusts two dedicated Vela Ed25519 public keys (current and next),
pinned in the Ether binary through build ldflags, independently of Ether's own
updater key. Verify the detached signature over the **exact downloaded UTF-8 JSON
bytes**, including their final newline, before parsing or following any URLs.
The signature file is base64 of the 64-byte Ed25519 signature, plus a newline;
public pins are base64 of the raw 32-byte public key. No JSON canonicalization.

The stable URLs are:

- `https://github.com/braedonsaunders/vela/releases/download/vela-stable/channel.json`
- the same URL with `.sig` appended.

Both contain the same bytes as a versioned `vela-V.release.json` and `.sig`
under GitHub Release tag `vV`. Stable is mutable; versioned assets never change.
Fetches spanning a channel replacement can see mismatched bytes/signature and must
fail closed. Never fall back to unsigned metadata. No eager viewer-path work:
check only on owner Apps › Vela or an already-running updater cadence; install
only after an owner action. Reject expired descriptors, future publication times,
dirty sources, unsupported protocol ranges and an insufficient Ether version.
Refuse downgrade except explicit rollback. Retain the highest observed version
and publishedAt to reject older channel replays. Thirty-day descriptor expiry
bounds replay even on first check; renewing an expired channel requires a newly
signed descriptor, never changing archive bytes.

Descriptor schema (all these fields required; per-engine entries repeat):

```json
{
  "schemaVersion": 1,
  "kind": "vela-release",
  "channel": "stable",
  "version": "0.1.42",
  "publishedAt": "2026-11-15T16:00:00.000Z",
  "expiresAt": "2026-12-15T16:00:00.000Z",
  "sourceRevision": "dc943581511d95881acca986346129bf556baa6f",
  "sourceDirty": false,
  "protocol": {"minInclusive": 0, "maxInclusive": 0},
  "minimumEtherVersion": "0.3.13",
  "archive": {"url": "https://github.com/braedonsaunders/vela/releases/download/v0.1.42/vela-0.1.42.tar.gz", "bytes": 123, "sha256": "<64 lowercase hex>"},
  "manifest": {"url": "https://github.com/braedonsaunders/vela/releases/download/v0.1.42/vela-0.1.42.manifest.json", "bytes": 123, "sha256": "<64 lowercase hex>"},
  "engines": {"cinematic": {"manifest": {"url": "https://github.com/braedonsaunders/vela/releases/download/v0.1.42/vela-0.1.42-cinematic.manifest.json", "bytes": 123, "sha256": "<64 lowercase hex>"}}},
  "universalRuntimeKey": "3c579f70de6e1cfe"
}
```

The example sizes/hashes are schematic; `sign.ts` emits actual values. The signed
archive ref must agree with the complete existing build inventory. Each engine's
signed manifest ref is downloaded and checked as well, with matching version,
source, protocol and clean flag. The signing step derives finalized per-engine manifests from the complete archive
inventory: `{schemaVersion:1, version, engine, basePath, sourceRevision,
sourceDirty:false, protocolVersions, exactRevision, files:[{path,bytes,sha256}]}`.
Paths are relative to `engines/<id>/<version>/`. These describe the **shipped,
post-mount** bytes; verify every entry against that engine's extracted subtree,
and require exact agreement with the corresponding complete-release entries.
Pre-mount compiler child manifests remain local build provenance, not installer
inputs.

Use bounded, cancellable downloads, no request-path retries, and HTTPS only
(including redirects; allow GitHub's release asset host). An explicit owner-only
`vela.channelURL` override may permit `file://` for the lab; never accept it from a
viewer or an unsigned remote descriptor. Even a local descriptor needs a pinned
signature. Local tests use a separate test key pinned only in the lab binary.

Verify both downloads before extraction. Check manifest schema, pinned version,
protocol overlap, `/vela/` base path and archive hash/size. Reject absolute paths,
parent traversals, links, devices, duplicate paths and files outside the manifest;
normalize an optional leading `./` in tar entries. Apply reasonable compressed and
expanded size limits. Extract into a new staging directory and verify each file's
size and SHA-256 against the manifest, including index.html. Never extract an
unverified tarball over an active installation. Keep installer metadata outside the
served static root.

### Legacy installation and serving

Installer staging is `data/clients/.vela-staging-V`. The layout is:

```
<EtherDataDir>/clients/vela/
  # verified active static tree
<EtherDataDir>/clients/.vela-rollback-<timestamp>/
<EtherDataDir>/clients/.vela-staging-<version>/
```

This describes what the Ether installer should implement; the Vela packager does
not modify Ether's data directory. Verify staging completely, then rename the active directory to a timestamped
rollback and staging to `vela`, recovering the previous directory if activation
fails. Serialize installations and rollback; retain two verified rollbacks. Keep
installation metadata outside the served tree. Preserve owner-staged diagnostic
core/bootstrap directories and extra universal keys without overwriting new
release files. Keep active media/API sessions independent of this switch.
Redirect `/vela/` to `/vela` with status 308, preserving query; browsers retain the fragment. The console handoff targets `/vela#code=...`. Serve static files from `current`, including correct
JavaScript, CSS, JSON and WASM MIME types. For declared client routes such as
`/vela/title/:id`, `/vela/watch/:id` and `/vela/collection/:id`, return the release's
index.html. Use its routes.json to distinguish routes from missing static assets;
a missing `.js`, `.css` or other asset must return 404 rather than HTML.

Route `/vela/v0/` to the protocol handler before static fallback. Keep
`/sessions/media/` on Ether's session broker. Serving the app does not grant access
to either API or media. Web-code sign-in uses the same Ether identity instance.
Serve index/shell/manifest with revalidation. Content-hashed assets can be cached
immutably only while their owning release remains retrievable. Avoid mixing
files from different releases: retain the previous static tree through existing
page lifetimes or use version-qualified asset roots before turning on aggressive
caching. The packager emits the narrowly scoped shell service worker described below.

### Legacy compatibility and rollback

The client sends protocolVersions and device.appVersion in NegotiateRequest.
The build version must match the packaged release version. The server returns
protocolVersion and optional compatibleClientBuilds `{minInclusive,maxExclusive}`;
the bounds use semantic-version precedence, inclusive lower and exclusive upper.
Current Ether support is protocol 0 with client builds >=0.1.0 <0.2.0. Unknown or
unsupported versions stop with an honest unsupported-version/build response;
capability absence disables only the corresponding optional operation. Capability
negotiation never bypasses authenticated viewer or device policy.

On failed startup, compatibility rejection or owner rollback, atomically restore
the previous verified release and retain the failed release/manifest for diagnosis.
Do not rewrite a version's bytes. Restore previous releases through their original
manifest/hash; do not downgrade protocol or bypass authorization to force startup.
The installer must retain a known working release until the replacement has been
opened successfully. Viewer credentials remain in the shared client identity
store; changing static files must not create a different Ether viewer/device.

### Legacy runtime origin

Release builds clear API_BASE_URL and VELA_MOCK. The data module takes the page's
HTTP(S) origin once and pins API, event and media requests to it; dev builds may
still choose an explicit origin. Exact's baked admission ceiling contains HTTP(S)
scheme grants, while Vela enforces the narrower same-origin runtime policy. This
is an application policy boundary, not an Exact native `self` grant. Artwork and
media URLs must satisfy that boundary and redirects must not escape it. No
installer rewriting, instance hostname or viewer token belongs in the archive.

### Legacy pWA installation and updates

Exact emits the base manifest and icon links; it does not provide Vela's service
worker or install-prompt lifecycle. The release adds original sail-mark SVG and
180/192/512 pixel PNGs, Vela's standalone manifest, dark theme/background, an
Apple touch icon, and `pwa.js`. The canonical start URL and manifest/SW scope are
`/vela`; the asset base remains `/vela/`.

Ether must serve `/vela/sw.js` with `Service-Worker-Allowed: /vela` (needed because
the canonical `/vela` URL is above the script's default `/vela/` directory scope),
JavaScript MIME type and `Cache-Control: no-cache`. The manifest's serviceWorker
field records these required serving headers. Registration requires HTTPS or a
browser-trusted localhost secure context. It never broadens to the origin root.

The worker caches only exact allowlisted shell URLs, verified against build-time
SHA-256 values. Exact's entry, preloads and chunk imports retain their original
canonical URLs: generated chunks can import back into app.js, so qualifying only
the HTML entry with a cache query would create two ESM identities and boot twice.
Unversioned app.js, styles and native modules remain network-only; only existing
content-addressed chunks and the standalone digest-qualified PWA/offline resources
enter this cache. Serve fixed-name JS/CSS with revalidation as well as HTML.
Navigations use network responses, with a static “You're
offline” page when the network fails. `/vela/v0/`, artwork grants,
`/sessions/`, other media, non-GET and cross-origin requests bypass the worker.
There are no dynamic cache admissions, credential storage, API cache or offline
media features. The cache name includes both version and shell digest.

New workers install in the background and wait. `applyUpdate()` explicitly asks
the waiting worker to activate; activation removes only older Vela shell caches,
claims this scope and reloads existing controlled pages. An update can interrupt
playback, so the UI should offer it at a suitable moment. Installation or worker
failure never gates ordinary online browsing. Platform install prompts are offered
only when the browser actually emits beforeinstallprompt; Safari can use its own
Add to Home Screen flow without a fake installable state.

Page-host integration: `window.velaPwa.state` returns installable, installed,
updateAvailable and offline booleans. `subscribe(callback)` immediately reports
state and returns an unsubscribe function; `vela:pwa-state` is also dispatched on
window. `install()` must be invoked in a trusted user gesture and resolves whether
the prompt was accepted. `applyUpdate()` returns false when no worker is waiting.
Exact's data module cannot access this browser API directly; native-view controls
bridge it without exposing credentials or arbitrary DOM access to skins.

### Legacy per-engine release layout

This is the temporary shipping layout. The planned replacement below takes over
when all installed skins have been converted to documents.

The release packager compiles each installed layout engine as a separate supported
static Exact app. `engines.json` lists their immutable versioned bases under
`/vela/engines/<engine>/<version>/`, entry bytes and gzip9 bytes. The root
`index.html` loads only the small selector; it reads the viewer engine pick from
`vela.engine`, then the last server default from `vela.engine.default`. On a first
visit it makes a bounded public negotiation request for the server default.
Unknown or removed engines fall back to cinematic. The engine page is loaded at
the existing URL, retaining `/vela/...` routes, query and fragment.

Each engine uses the shared foundation and session storage. The native handoff
bridge owns preference changes, scroll restoration and the dissolve. The loader
exposes only the validated installed engine IDs through `window.velaEngines`.
Contract code has no dynamic import boundary; release staging statically removes
unselected dispatch arms through `prepareEngine`, with no Exact vendor changes.

The root service worker pre-caches only the tiny selector/PWA/offline resources.
Versioned engine files are digest-checked and cached when requested, so an unused
engine is never downloaded speculatively. API responses, signed artwork and media
are outside the immutable allowlist. Offline navigation shows the offline page.
An update activates through the existing explicit update action, clears obsolete
version caches and claims clients. The artifact remains one archive and manifest;
Ether performs the same atomic installation and rollback as before.

### Legacy skin document compatibility

Skins are documents (`protocol/v0/skin.ts`, `docs/skin-schema.md`) drawn by the
client's one renderer. Two numbers decide whether a client may draw a document:

- `schema` (document field, now `1`): the document language. A client draws only
  the schema it implements; a breaking change to the language is a new schema.
- `renderer` (document field) against the client's `RENDERER_VERSION`
  (`client/src/skin/vocabulary.ts`, generated): the vocabulary keys, style rows and
  motion presets a document may use. Additions bump the version; a document names
  the lowest version it needs, and a client draws it only when
  `document.renderer <= RENDERER_VERSION`. `tools/renderer.ts` keeps the tables'
  digest in `client/renderer/version.json` and refuses to regenerate changed tables
  without `--bump`, so the number cannot drift from the code.

The release manifest records `skinRenderer: {schema, version, digest}`, so Ether can
refuse to install, offer or make default a document this release cannot draw, and
can say which client release it needs. The client refuses such a document too (the
data module rejects it before the renderer sees it).

**Built-in default.** Every release ships the cinematic document and its assets as
versioned static files beside the app. The client draws it whenever the server's
default or the viewer's pick is unavailable: before `/appearance` answers (first
paint never waits on Ether), offline, for an unknown or incompatible document, or a
document that fails validation. The viewer's own pick is kept and retried when the
server next answers. Until the compiled skins are removed, the fallback is the
compiled cinematic engine.

### Legacy built-in skin documents

A release ships every skin document in `protocol/v0/fixtures/skins/` as a built-in
skin, so a viewer can pick a data skin with no server involvement:

    bun tools/skin.ts documents <out>

writes, from `fixtures/skins/<id>/document.ts` (default export) plus its `assets/`,
and the legacy `fixtures/skins/cinematic.ts`:

    <out>/catalog.json                    {schema: 1, documents: [SkinDocumentRef + renderer + sha256]}
    <out>/<id>/<version>/document.json    the document; asset URLs point at /vela/skins/<id>/<version>/
    <out>/<id>/<version>/<asset>          preview and assets

An owner-held conversion may be omitted from a release catalog with
`--exclude-document=<id>` (repeatable). The manifest records these exclusions;
the compiled engine remains installed.

The release serves `<out>` at `/vela/skins/` beside the app (immutable apart from
`catalog.json`). The client fetches `/vela/skins/catalog.json` from its own origin,
drops entries whose `renderer` exceeds its `RENDERER_VERSION`, and lists the rest in
the appearance picker beside the server's documents; a server document with the same
id wins. A conversion of a skin that is still compiled into the client ships as
`<id>-data`, named "<name> (data)", until the compiled skin is deleted. A missing or
failed catalog only means no built-in documents; a page a document does not draw
falls back to the cinematic default, as for server documents.

The production release runs this generator into `dist/skins` before inventorying
the static tree. Every catalog, document, font, image and licence is covered by
the same file hashes and atomic installation as the app. The service worker admits
versioned document/assets only on request; it never prefetches another skin.
`catalog.json` stays network-only and should be served with revalidation. No server
appearance API response or signed artwork/media grant enters this static cache.

### Superseded Exact single-renderer proposal

The Exact single-renderer proposal did not become the RN release architecture.
The current replacement is the Expo export plan above: one Metro app, JSON skin
assets, external player payload and one app manifest. Do not revive per-engine
profiles or a compiled Exact renderer to complete this migration.

### Legacy required player payload

Vela has one player: the Universal engine. Every production release requires
`bun tools/release/build.ts --committed --universal-assets=<prepared-payload-dir>`.
There is no player toggle or persisted player choice. Secure capable devices
advertise originalPlayback after the host capability probe. Native/MSE backends
are internal automatic fallbacks; Ether HLS is the last resort.

The directory contains `DIAGNOSTIC-MANIFEST.json`, `index.js` and `universal/`.
Every listed file, byte size and digest is verified; extra files, links and unsafe
paths fail closed. The reviewed upstream revision, asset key and aggregate
library/runtime hash must match. The diagnostic host is validated but never
replaces the production host, which comes from committed Vela source.

Runtime, workers, codec packages, notices and corresponding sources are copied
once to `/vela/universal/<assetKey>/`. Their digests remain in the release
inventory; the manifest records upstream revision and payload-manifest SHA-256.
`engines.json` always supplies `universalAssets: {baseURL,assetKey}`. Before engine
import the entry validates and publishes `window.velaUniversalAssets`; a missing
or invalid descriptor fails closed. The native host also validates origin, the
exact key-addressed path and runtime identity. Direct engine-build invocations
cannot produce a standalone production release without this shared payload.

The service worker caches immutable URLs only on request, including exact
`?v=<assetKey>` aliases. Unused codec packages and layout engines are not eagerly
prefetched. Installed codec families still undergo per-stream admission; payload
presence is not a promise of HDR, Dolby Vision or every format's support. Release
qualification and stream clearance remain separate from payload preparation.

Release output and temporary engine builds live through `.artifacts/release/`,
a symlink into `~/.scratch/vela-build/<worktree>/`. `client/.exact` and
`client/target` use the same scratch-backed layout. Source worktrees stay internal.

To retain an already-qualified runtime without its original diagnostic input, use
`bun tools/release/build.ts --committed --universal-from-release <previous-release.tar.gz>`.
Keep the adjacent `<previous-release>.manifest.json` and its `.sha256` file.
This mode verifies the manifest checksum, the archive checksum and every archive
file against the release inventory before copying only its shipped universal tree.
The payload manifest, upstream pin and runtime asset key are verified again. No
runtime is rebuilt, and the unshipped diagnostic host is neither needed nor copied.
Use exactly one universal input option per build.


## Signing and deliberate publication (Ether 0.3.13)

These are the existing key/publication controls. Final Expo CLI/manifest integration
belongs to the release worker; historical per-engine signing output below does not
prove a signed Expo fixture. No public publication is authorized by this plan.

`bun tools/release/signing.ts init production-v1` creates a **dedicated Vela**
Ed25519 identity in the macOS login keychain, service
`app.vela.release-signing.ed25519`. `public production-v1` prints only its public
pin. The helper has no private-key export operation; private bytes never enter
command arguments, files, repo, logs or chat. Keychain access failures stop signing.
Back up/rotate through an approved secure-store procedure; losing this key requires
shipping a new Ether public pin. Initialize `production-v2` and pin its public key as next before switching signing
keys; `sign.ts` and `publish.ts` take `--next-key` for that rotation.
The independent `lab-test-v1` identity is never accepted by production builds.

After an approved clean build:

```
bun tools/release/sign.ts 0.1.42
bun tools/release/publish.ts 0.1.42 --dry-run
# Only after the owner explicitly approves this public version:
bun tools/release/publish.ts 0.1.42 --approved=0.1.42
```

Signing verifies the entire existing archive before signing. Signed assets are
staged in `.artifacts/release/signed-V/`: archive, complete build inventory,
per-engine manifests, release descriptor/signature and identical stable-channel
copies. Publishing re-verifies the signature and asset hashes with the production
key, creates a draft versioned GitHub Release, uploads all assets, publishes it,
then changes stable **last**. It never runs automatically or from a build. A failed
upload leaves a draft/versioned release for deliberate recovery; do not rewrite
published version assets. No public command has been authorized for this work.

For the local end-to-end dry run, initialize `lab-test-v1`, then run
`sign.ts V --test-key --base-url=file:///absolute/signed-V-test/` and
`publish.ts V --dry-run --test-key`. Ether pins only that test public key in its
lab binary and sets its explicit owner-only channelURL to the local channel.json.
The owner console shows installed version, available version, Install/Update and
Roll back; an installer bundle may pin a specific signed descriptor and version
instead of following stable. Check expiry/signature/compatibility even when pinned.
All public publishing waits for the owner's approval after the lab result.

Use `--output-dir=<directory>` on signing and publish dry runs to stage a lab bundle
in a directory named by its file URLs; no descriptor edit is allowed after signing.

The helper executable is source-hashed and cached under release scratch output.
macOS may ask for Keychain permission when a newly compiled helper first accesses
an existing key; allow only the expected local signing helper. An operator may set
`VELA_SIGNING_HELPER=/absolute/path/to/already-authorized-helper` to keep using the
original trusted executable during a dry run. This changes no Keychain ACL and
never exports the private key. Do not delete the authorized helper while a release
is pending. The same key remains in the login keychain if scratch output is lost;
recompiling the helper may require normal macOS authorization again.

## Local installer qualification (2026-11-15)

The Ether 0.3.13 integration lab, pinned to the dedicated **test** key and explicit
local file channel, checked signed Vela 0.1.42 successfully: signature, expiry,
compatibility and a tampered-descriptor rejection (`release signature is not
trusted`). Owner rollback to 0.1.41 and a subsequent 0.1.42 install both ran through
the installer. The 193,700,293-byte archive streamed in about six seconds; all
1,117 installed file hashes matched and the served version was 0.1.42.

The initial dry run exposed two Ether defects (loss of newer additive assets on
rollback and retention pruning the newest rollback). Both were fixed in Ether
`857dffc36`, integrated as `84a5c9482`. The corrected owner-only cycle passed
without hand repair:

- Rollback 0.1.42 → 0.1.41 retained all 15 universal keys, including keys staged
  after the rollback point, 3 root CORE JSON files, 11 diagnostic/core-app items
  and 15 cinematic engine directories.
- Check reported installed 0.1.41 and available signed 0.1.42.
- Reinstall streamed the same 193,700,293-byte archive; all 1,117 manifest entries
  matched byte-for-byte and all additive items remained present.
- Retention kept exactly the two newest rollbacks by time (0.1.42 at 13:50:54 and
  0.1.41 at 13:50:59), pruning the older legacy-named directory.
- The lab served signed 0.1.42; checked runtime URLs returned 200, with zero
  playback sessions and zero pins.

**The historical Exact local signed-distribution dry run is complete.**
It does not qualify the replacement Expo artifact. No public GitHub release or
stable channel has been published by these commands. Before a public release:

1. Confirm the **production** Ether build pins the dedicated Vela production public
   key (not the lab-test key), with the optional next-key pin ready for rotation.
   The production public pin has been supplied to the Ether coordinator; the lab
   qualification deliberately used only its independent test pin.
2. Obtain the owner's explicit approval for the exact public Vela version. The
   completed dry run is evidence for that decision, not authorization to publish.
3. Sign that approved version with the production key and HTTPS GitHub asset URLs,
   validate it with `publish.ts V --dry-run`, then deliberately run
   `bun tools/release/publish.ts V --approved=V`. This publishes immutable versioned
   assets and advances the signed stable channel last. The local test-key/file://
   descriptor must never be published as the production channel.

# Vela web distribution

Vela is built separately from Ether. Ether installs a pinned static artifact and
serves it on its own origin under `/vela/`. No separate API hostname is part of
the production deployment. Nothing in the release tool publishes or uploads.

## Local packaging

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

Output under `~/.scratch/tmp/vela/release/`:

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

## Installer inputs and verification

An owner-approved release descriptor supplies the archive HTTPS URL, its trusted
SHA-256, manifest HTTPS URL and trusted manifest SHA-256. These are installer
inputs, not a mutable `latest` lookup. A hash fetched beside an untrusted download
is not an independent trust anchor. Distribution URL selection and release
publication belong to the orchestrator; this repository does not publish them.

Verify both downloads before extraction. Check manifest schema, pinned version,
protocol overlap, `/vela/` base path and archive hash/size. Reject absolute paths,
parent traversals, links, devices, duplicate paths and files outside the manifest;
normalize an optional leading `./` in tar entries. Apply reasonable compressed and
expanded size limits. Extract into a new staging directory and verify each file's
size and SHA-256 against the manifest, including index.html. Never extract an
unverified tarball over an active installation. Keep installer metadata outside the
served static root.

## Installation and serving

The proposed installer layout is:

```
<EtherDataDir>/clients/vela/
  releases/<version>/      # verified static tree
  manifests/<version>.json
  current                 # atomic pointer to active release
  previous                # last known working release
```

This describes what the Ether installer should implement; the Vela packager does
not modify Ether's data directory. Install new versions side by side, then switch
`current` atomically. Keep active media/API sessions independent of this switch.
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

## Compatibility and rollback

The client sends protocolVersions and device.appVersion in NegotiateRequest.
The build version must match the packaged release version. The server returns
protocolVersion and optional compatibleClientBuilds `{minInclusive,maxExclusive}`;
the bounds use semantic-version precedence, inclusive lower and exclusive upper.
Current Ether support is protocol 0 with client builds >=0.1.0 <0.2.0. Unknown or
unsupported versions stop with an honest unsupported-version/build response;
capability absence disables only the corresponding optional operation. Capability
negotiation never bypasses authenticated viewer or device policy.

On failed startup, compatibility rejection or owner rollback, atomically select
the previous verified release and retain the failed release/manifest for diagnosis.
Do not rewrite a version's bytes. Restore previous releases through their original
manifest/hash; do not downgrade protocol or bypass authorization to force startup.
The installer must retain a known working release until the replacement has been
opened successfully. Viewer credentials remain in the shared client identity
store; changing static files must not create a different Ether viewer/device.

## Runtime origin

Release builds clear API_BASE_URL and VELA_MOCK. The data module takes the page's
HTTP(S) origin once and pins API, event and media requests to it; dev builds may
still choose an explicit origin. Exact's baked admission ceiling contains HTTP(S)
scheme grants, while Vela enforces the narrower same-origin runtime policy. This
is an application policy boundary, not an Exact native `self` grant. Artwork and
media URLs must satisfy that boundary and redirects must not escape it. No
installer rewriting, instance hostname or viewer token belongs in the archive.

## PWA installation and updates

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

## Per-engine release layout

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

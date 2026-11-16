# React Native migration

Status: accepted direction (owner decision, 2026-11-16). This document is the plan for
moving Vela from Exact to React Native + Expo, the spec for the two spikes that prove it,
and the style matrix skin documents must stay inside. Architecture owner: thread
`thr_b57w7znkf9`. Orchestration: `thr_ucqnvk37fq`.

## Why

Exact renders natively, but Vela's player is a DOM web module (MSE, WebCodecs, WebGPU),
so the framework's native hosts never reach the feature that matters most. Contract has
no recursion, which is why the skin renderer is a generated, depth-unrolled interpreter
with per-level copies and widget depth limits. React Native + Expo gives first-class
iOS, Android, tvOS and Android TV from one app (react-native-tvos), web through
react-native-web, and macOS/Windows through Microsoft's forks. The playback engine on
native becomes libmpv, which already plays everything Vela's browser core was built to
reach (MKV, HEVC Main10, Dolby Vision, PGS/ASS, TrueHD/DTS) with hardware decode.

## Targets and pins

| Target | Host | When |
|---|---|---|
| Web / PWA | react-native-web, same app | Spike (a), then conversion |
| iOS, iPadOS | Expo prebuild | Spike (a) |
| tvOS | Expo prebuild with `EXPO_TV=1` (react-native-tvos) | Spikes (a) and (b) |
| Android, Android TV | Expo prebuild (`EXPO_TV=1` for TV) | Conversion |
| macOS | First "Designed for iPad" on Apple silicon; later a react-native-macos host | After conversion |
| Windows | react-native-windows host | After conversion |
| Linux | The web/PWA build | No separate host |

Pinned at spike start (checked against the registry 2026-11-16): Expo SDK 58
(`expo@58.0.25`), React 19.3.0, `react-native` aliased to `react-native-tvos@0.88.1-0`
(upstream RN 0.88.1), react-native-web 0.21.4, Reanimated 4.7.1 + worklets 0.13.0,
expo-image, expo-blur, expo-linear-gradient, expo-secure-store,
@react-native-masked-view/masked-view at the versions Expo 58 bundles. Moving a pin is
a deliberate commit, as `EXACT_REVISION` was.

react-native-macos (0.83) and react-native-windows (0.85) trail upstream and cannot share
one `react-native` dependency with the tvOS fork. They get their own host apps later.
That is the reason for the package rule below: packages depend on `react` and
`react-native` only as peers and use no API newer than the oldest host needs.

## Layout

```
apps/vela/              Expo app: routes (expo-router), screens that draw document routes,
                        platform storage, the player view wiring. Web, iOS, tvOS, Android, Android TV.
packages/protocol/      Wire types (today protocol/v0/types.ts, skin.ts) and fixtures.
packages/core/          Server adapters (Ether, Jellyfin, Plex), session and server registry,
                        discovery models, search generations, live/guide, telemetry, i18n catalogs.
                        No React, no DOM, no React Native.
packages/skin/          Document resolver (validation, inheritance from the Vela base, tokens,
                        variants, motion), the style translator, the React renderer, widgets.
packages/player-api/    The player view contract (types only) shared by every implementation.
modules/vela-player/    Expo module: Apple (Swift + MPVKit), Android (Kotlin + libmpv),
                        web (the existing WebCodecs/WebGPU core).
mock-server/            Unchanged.
```

Bun workspaces at the root. Metro needs a hoisted `node_modules`: set
`[install] linker = "hoisted"` in `bunfig.toml`. Generated native projects (`ios/`,
`android/`, CNG output) are not committed. DerivedData, Gradle caches and prebuild
output live under `~/.scratch/vela-build/<worktree>/`.

The routine compile check becomes `bun x tsc --noEmit -p apps/vela` (it covers the
packages through project references), plus `bun x expo export --platform web` when the
web bundle changed. Native builds are checked by building them, nothing more.

## Web and PWA stay first-class

The web app is not a side effect of the native apps. The Expo web export
(react-native-web) **is** the web artifact. It hosts the WebCodecs/WebGPU player, and Ether
serves it at `/vela` through the existing signed distribution and installer: archive,
signed manifest, verification, atomic install, two rollbacks and the shell service worker
(`docs/distribution.md`). Only what produces the static tree changes. The installer
contract does not.

- **Build:** `expo export --platform web` with `web.output: "single"` (one SPA
  `index.html`) and `experiments.baseUrl: "/vela"` (set by `VELA_WEB_BASE=/vela` in the web export only; native builds
  take no base URL), so every URL the export writes is
  under `/vela`. Routes are expo-router routes. The server-side route list
  (`routes.json`: `/vela/title/:id`, `/vela/watch/:id`, `/vela/collection/:id`, …) is
  generated from `apps/vela`'s route table, so Ether's index fallback and its asset 404s
  keep working.
- **Release tree** (archive root, owned by the packager `thr_tgszknwfsb`):

  ```
  index.html                      Expo's single page entry
  _expo/static/js/web/*.js, css   content-hashed bundles (immutable while the release is retrievable)
  assets/…                        Metro's content-hashed images and fonts
  player/…                        the web player's decoder packages, worklets and WASM, loaded by URL
  skins/<id>/<version>/…          bundled skin documents and assets, as today
  manifest.webmanifest, icons, pwa.js, sw.js, routes.json    the packager's PWA shell and route list
  ```

- The release manifest keeps `skinRenderer {schema, version, digest}`. The digest is now
  that of the React renderer's vocabulary and style matrix.
- The engine selector, `engines.json` and per-engine roots are gone. There is one app.

## What moves, what is rewritten, what is deleted

### Moves as is (by `git mv` at conversion, not during the spike)

- `protocol/v0/` → `packages/protocol/` (types, skin types, fixtures, skin documents).
- `client/src/adapter/**`, `discovery/`, `live/`, `search/`, `telemetry/`, `protocol/`,
  `session/servers.ts`, `appearance/` → `packages/core/`.
- `client/src/skin/` resolver pieces (`base.ts`, `vela-base/`, `inherit.ts`, `ui*.ts`,
  `client-strings.ts`, the validation half of `index.ts`) → `packages/skin/resolve/`.
- `client/foundation/i18n.ts`, `catalogs.ts`, `client/strings/` → `packages/core/i18n/`.
- `client/player/**` (the web core) → `modules/vela-player/web/`.
- `mock-server/`, `tools/skin*.ts` (validator and packager), `tools/locales.ts`.

### Adapted

- **Types generated from Contract.** Several files import `app.contract.d.ts` (the
  `Sources`/`Answer`/`Store` types and the model shapes). Those shapes become hand-written
  TypeScript in `packages/core/models.ts`, kept field-for-field so the adapters do not change.
- **`client/src/sources.ts`** (the Exact answer dispatcher, 942 lines) is replaced by a
  small store: `packages/core/store.ts` holds state and actions; React reads it through
  `useSyncExternalStore` hooks. The logic inside each source (session, negotiation, origin
  binding, server selection) moves into the store's actions, not into components.
- **Storage.** Exact's `secret.keep` becomes a `SecretStore` interface in core:
  expo-secure-store on native (Keychain on iOS and tvOS, Keystore on Android), and the
  current web behaviour on web. Non-secret preferences use a plain key-value store.
- **Fonts.** Document fonts load at run time with expo-font (`loadAsync` with a URL).

### Rewritten

- **The skin renderer** (`packages/skin/render/`): an ordinary recursive React renderer,
  below. It replaces `client/renderer/*.contract`, `tools/renderer.ts`, the level
  conversion in `client/src/skin/index.ts` and `vocabulary.ts`'s positional table.
- **Widgets**: search field, scrubber and track/quality menus, guide time grid, sign-in
  fields and quick-connect code, hero/card trailer previews, install/update, visibility
  sentinels, appearance picker. Each is a React component registered by name.
- **Foundation screens**: the route shell, navigation stack and restoration (scroll,
  focus, query), detail presentation (fullscreen/modal/stack), player chrome host, guide.
- **The native player** (spike b).

### Deleted after conversion

`client/` as an Exact app (`app.contract`, `foundation/*.contract`, `skins/`, `renderer/`,
`app.tamber`, `exact.mjs`, `modules/web/index.js`), `vendor/exact`, `EXACT_REVISION`,
`tools/check.ts`, `tools/engine.ts`, `tools/renderer.ts`, `tools/tvos.ts`, the Exact
sections of `AGENTS.md`, and the docs that describe compiled skins or Contract workarounds.

## The skin renderer

Documents stay schema 1 and are not changed for React Native. The renderer implements a
declared `RENDERER_VERSION` (15 at spike start, the version the Vela base needs); a
document that asks for a newer renderer is refused on version and falls back to the
built-in document, never half-drawn.

**Resolve once, render many.** `resolve(doc, base, viewport, locale)` validates the
document, applies inheritance from the Vela base, inlines templates, applies `small`/`wide`
variants for the viewport, substitutes tokens, expands motion presets, compiles templates
and conditions to small closures, and translates every style row once (next section). It
returns a plain tree. It re-runs only when the document, viewport class or locale changes.

**Render.** `<SkinNode node ctx />` is recursive. There is no depth table: the resolver
keeps sanity limits (4,000 nodes, 32 levels) as refusals, not as layout rules, and widgets
may sit at any depth.

**Bindings.** The vocabulary becomes a typed map from key to accessor,
`'card.name': (ctx, env) => ctx.card?.name ?? ''`. A compiled template calls only the
accessors it names, so a node costs what it binds, not the whole vocabulary.
`ctx` carries `card`, `hero`, `row`, `heroAct`, `dest`, `extra`, `person`, `fact`, `ch`,
`opt` and `index`; `env` is the store's view state. Unknown keys are refused at resolve
time, as today.

**Inheritance.** React Native views do not pass text style to children. The resolver
computes each node's inherited text rows (colour, font, size, weight, line height,
letter spacing, transform, alignment) down the tree and the renderer applies them only at
`text` nodes. `inherit` placeholders disappear.

**Repeat.** `repeat` over `home.rows` is a vertical `FlatList`, over `row.items` a
horizontal one, so long homes virtualize. Other repeats map over their items.

**Interaction.** A `press` box is a `Pressable`. `hover` overlays apply on pointer
platforms (web, iPad, Mac). On TV, `focus` drives the same overlays through the native
focus engine (tvOS) and D-pad focus (Android TV); a node with `hover` but no `focus`
uses its hover overlay as its TV focus look. The overlays of the active `states` entry replace the node's own (hover, focus, groupHover,
groupFocus); a state without one keeps the node's. A focus look written only inside states is
still the node's TV and keyboard focus look, and it replaces the platform focus ring unless it
says `outline: auto`. The focus look and any ring are drawn on the press box itself, the
clipping element, never on the transparent button inside it. A node keeps up to 16 states; more are refused. `group`/`groupHover` is a context flag set
by the nearest group's hover or focus. Rows use `TVFocusGuideView` so focus moves
between rows the way the server ordered them.

**Motion.** Presets map to Reanimated 4 CSS animations (`animationName` keyframes,
duration, delay, easing, iterations, direction, fill), and `transition` to Reanimated CSS
transitions. Under reduced motion (`AccessibilityInfo` and Reanimated's `ReducedMotion`)
the document's reduced alternative runs, or nothing.

**Visibility.** The `observe` widget reports a receipt only when the element is actually
on screen: `onViewableItemsChanged` inside virtualized lists, layout-in-viewport checks
elsewhere, never on prefetch, and never while the app is backgrounded.

## Style matrix (React Native 0.88, new architecture)

This is the boundary for skin documents from now on. **Supported** and **Mapped** rows
draw the same on every platform. **Approximated** rows draw close to their meaning, and
the validator notes the approximation. **Web only** rows draw on web and are ignored
silently on native. **Unsupported** rows are refused by the validator. Do not add new uses
of Approximated or Unsupported rows.

| Class | Rows | On native |
|---|---|---|
| Supported | `display` (`flex`, `none`), `position` (`relative`, `absolute`), `top`/`right`/`bottom`/`left`/`inset`, `z-index`, `width`/`height`/`min-*`/`max-*`, `aspect-ratio`, `flex`, `flex-grow`/`-shrink`/`-basis`, `flex-direction`, `flex-wrap`, `align-items`/`-self`, `justify-content`, `gap`/`row-gap`/`column-gap`, `order` (resolver reorders), `margin*`, `padding*`, `overflow` (`hidden`, `visible`), `color`, `background-color`, `opacity`, `border*` (width, colour, radius, style, per side), `outline`, `box-shadow` (incl. inset, several), `font-family`, `font-size`, `font-weight`, `font-style`, `line-height`, `letter-spacing`, `text-transform`, `text-align`, `font-variant-numeric`, `translate`/`scale`/`rotate`/`perspective`, `transform-origin`, `pointer-events`, `transition`, `animation` | As written |
| Mapped | `background-image: linear-gradient(...)` / `radial-gradient(...)` → `experimental_backgroundImage`; `background-image: url(...)` → an absolutely filled expo-image under the content; `line-clamp` → `numberOfLines`; `text-overflow: ellipsis` → `ellipsizeMode`; `white-space: nowrap` → one line; `text-shadow` → `textShadow*` (the first shadow); `object-fit` → expo-image `contentFit`; `overflow-x/-y: auto/scroll` → a `ScrollView` on that axis; units `rem`, `em`, `vw`, `vh`, `clamp()`, `min()`, `max()` and simple `calc()` → resolved to numbers per viewport; `color-mix(in srgb, <colour> p%, <colour or transparent>)` → folded to one hex colour at resolve, after `$ui.*` and document tokens are filled (`currentColor` stays unfolded: it draws on the web and is dropped natively) | Same result |
| Approximated | `backdrop-filter: blur(n)` → expo-blur `BlurView` (other functions dropped); `mask-image: linear-gradient(...)` → MaskedView + gradient (`url()` masks unsupported); `display: grid` with `grid-template-columns` of equal or fixed tracks → wrapped flex rows with computed widths (`grid-row`, `grid-column` spans, named areas unsupported); `filter` → `filter` where the platform supports the function, else dropped; `corner-shape: squircle` → `borderCurve: 'continuous'` on Apple, round elsewhere; `scroll-snap-type`/`-align` → `snapToInterval` when items have a fixed width, else none; `position: sticky` only on a **direct child of a vertical scroll box**: the route root (the renderer wraps every route root's children in the route's vertical ScrollView) or a box the document itself scrolls (`overflow-y: auto`/`scroll`) → that ScrollView's `stickyHeaderIndices`, pinned at its top (a non-zero `top` is ignored); anywhere else it is refused | Close, noted by the validator |
| Web only | `cursor`, `scrollbar-width`, `scroll-behavior`, `scroll-padding-*`, `color-scheme`, `box-sizing: border-box` (React Native is always border-box) | Ignored |
| Unsupported | `-webkit-text-stroke`, `position: fixed`/`static`, `position: sticky` outside a scroll box's direct children, `box-sizing: content-box`, `display: block`/`inline`/`contents`, multiple text shadows, `mask-image: url()`, grid placement (`grid-row`, `grid-column`, `grid-template-rows`, areas) | Refused |

Decided 2026-11-16 (finding in 177d4ce): document owners rewrite `box-sizing: content-box`, `display: block`/`contents`, multiple text shadows and `grid-column`; constrained sticky (above) stays.

## Player view contract (`packages/player-api`)

One contract, three implementations (Apple, Android, web). It is the browser contract in
`client/player/model.ts`, with typed props instead of JSON strings.

```ts
<VelaPlayerView
  session={PlaybackSession}          // or plan={PlaybackPlan}; a newer revision/generation replaces it
  command={Command}                  // { id, type, ... }; each id is consumed once, older ids ignored
  onSnapshot={(s: Snapshot) => …}    // at most 4 per second, and on every state change
  onError={(f: Failure) => …}        // network | source | decoder | unsupported | action
  onObservation={(o: { sessionId, observation: PlayerObservation }) => …}  // at most 1 per second
  style={…} />
```

Commands: `play`, `pause`, `seek {seconds}`, `volume {value}`, `audio {trackId}`,
`subtitle {trackId|null}`, `quality {renditionId|null}`, `lowDelay {enabled}`, `pip`,
`fullscreen`. Snapshot fields are those of `model.ts` (`Snapshot`); a value the
implementation cannot observe is `null`, never estimated.

**Media credentials** never travel through props, snapshots, errors or logs. The trusted
host (the app's playback controller, not skin code) calls
`VelaPlayer.setMediaAccess({ origin, pathPrefix, headers })` before loading. The
native side attaches the headers only to requests inside `origin + pathPrefix`, and
refuses redirects that leave it. Implementations must show this holds for redirects
before shipping.

Player chrome stays in JavaScript (skin-styled widgets over the view). The view draws
video and bitmap subtitles; text subtitles may be drawn by the engine (`sub-ass`) for
exact ASS styling.

### Apple implementation (spike b: tvOS on the Basement Apple TV)

- Expo module `modules/vela-player/ios`, Swift. `VelaPlayerView` is an `ExpoView` hosting
  a `CAMetalLayer`.
- libmpv from **MPVKit 1.0.0, the LGPL `MPVKit` product** (not `MPVKit-GPL`). Link it with
  React Native's `spm_dependency` in the module podspec, or vendor the release
  xcframeworks if that fails on tvOS. Record which one in this document.
- mpv options to start from: `vo=gpu-next`, `gpu-api=vulkan` (MoltenVK), `wid` = the
  layer, `hwdec=videotoolbox` (fall back to `videotoolbox-copy`), `keep-open=yes`,
  `cache=yes` with a bounded `demuxer-max-bytes`, `audio-channels` matching the output.
- Map mpv state to the snapshot: `time-pos`, `duration`, `pause`, `paused-for-cache`,
  `demuxer-cache-time` (buffer ahead), `cache-speed` (throughput), `frame-drop-count`,
  `track-list` (tracks, ids, codecs, languages, forced, default), `aid`/`sid`/`vid`.
  Observe properties with `mpv_observe_property`, never by polling.
- tvOS display matching: set `AVDisplayManager.preferredDisplayCriteria` from the video's
  frame rate and dynamic range before the first frame, and clear it on stop.
- Lifecycle: `destroy` terminates the mpv handle, releases the layer and clears criteria.

**Spike (b) passes when** a lab MKV with HEVC Main10, PGS subtitles and a TrueHD or
E-AC-3 track plays on Basement through the view, from a real lab `PlaybackPlan`:
first frame, steady playback with A/V sync, seek, audio and subtitle switching, pause and
resume, a clean stop, and correct snapshots. Record what HDR/Dolby Vision output it
actually achieves (tone-mapped SDR is acceptable for the spike; say which).

#### Spike (b) result (2026-11-16, Basement, Apple TV 4K 3rd gen, tvOS 27)

Passed on the device with 1917 from the lab Ether: a 74 GB MKV, HEVC Main10 3840x2160 HDR10 with
Dolby Vision profile 7, TrueHD Atmos 7.1, E-AC-3, AC-3 and 26 PGS tracks. Ether offered the original
(`primary`, `direct`, `file`, `original: true`) to the libmpv capabilities, so nothing was converted.
The view played it from the plan (resuming at the server's position), with steady 4K playback (0 to 2 dropped
frames over minutes), pause and resume, seek (+10 min and back), client-side audio switching (TrueHD to AC-3 5.1)
and PGS subtitle switching (rendered by mpv into the picture), snapshots and observations, and a stop.
`modules/vela-player/ios`, `apps/vela/app/(spike)/player.tsx`, `tools/apple-tv.sh`.

- **Linking.** `spm_dependency` on MPVKit's `MPVKit` product resolved, but through CocoaPods only `Libmpv`
  reached the app's link (FFmpeg, libass and the rest were undefined). The podspec vendors the release
  xcframeworks instead: the 28 binary targets of the LGPL product, pinned by the SHA-256 in MPVKit's
  `Package.swift` (`ios/mpvkit-1.0.0.txt`), fetched by `ios/fetch-mpvkit.sh` into the scratch drive.
  They are static libraries: the LGPL's relinking obligation applies to a distributed build (object files).
  AVKit is linked explicitly (`UIWindow.avDisplayManager`).
- **Rendering.** `vo=gpu-next`, Vulkan on MoltenVK into a `CAMetalLayer`, `hwdec=videotoolbox`.
  Dolby Vision profile 7 plays its HDR10 base layer (FFmpeg warns about the enhancement layer's NAL units).
- **HDR.** With `target-colorspace-hint=yes`, mpv's output target is PQ/BT.2020 (HDR10 passed through, not
  tone-mapped). The TV is HDR10-eligible (`AVPlayer.availableHDRModes`: hdr10; no Dolby Vision display).
  Basement has Match Content off, so `AVDisplayManager` reports matching disabled and neither range nor frame
  rate is switched; the view sets `preferredDisplayCriteria` before the first frame (mpv paused until the switch
  ends) when it is on. Not verified on a display with matching on.
- **Audio.** TrueHD and DTS are decoded by FFmpeg inside mpv to PCM; AC-3/E-AC-3 too (no bitstream passthrough).
  Output channels follow the session (`audio-channels=auto-safe` when the output takes more than two).
- **Ending a session.** mpv raises `eof-reached` for a moment while it switches tracks on a network stream.
  Ether ends a session on an `ended` observation and its media URL then answers 404, so the view reports
  `ended` only at the file's end.
- **Redirects**: answered below ("Media credentials and redirects").
- **Client build.** The lab Ether admits client builds below 0.2.0; the app is 0.2.0, so the spike reported 0.1.43.

#### Session commands (agreed with the migration lead, 2026-11-16)

- **Seek.** On an original file (direct play) the view seeks locally and emits nothing; observations carry the
  position. On a server path (Ether's HLS) it emits `onSessionCommand` `{kind: 'seek'}` and moves only when the
  plan with the next `seekGeneration` arrives (the web engine's server-controlled behaviour).
- **Tracks.** An audio or subtitle track the playing file carries switches locally and is reported client-only
  (`audioClientOnly`/`subtitleClientOnly`, so observations leave it out). Any other track change emits
  `{kind: 'tracks'}` and is applied from the answering plan. `quality`/`switchPath` emit `{kind: 'switch'}`.
- **Stop.** The view never emits it. The playback controller (`playbackController` in packages/skin) sends
  `{kind: 'stop'}` through core when it closes the player; unmounting the view only releases mpv.
- **Refresh.** `onSessionRefresh` once per source when a media request is refused with 401, 403, 404 or 410
  (an expired or revoked grant, read from FFmpeg's log), or when a command reply is stale.

#### Media credentials and redirects (proven 2026-11-16)

Stock FFmpeg, and so stock mpv, sends `http-header-fields` to wherever a redirect points: `ffprobe -headers
'Authorization: …'` against a local origin A that answers 302 to origin B delivered the credential to B.
The Apple view therefore never lets FFmpeg follow a redirect with credentials attached
(`ios/MediaRedirects.swift`):

1. A URL whose media access gives it headers is resolved first, hop by hop, with redirects refused
   (`Range: bytes=0-0`). A hop inside `origin + pathPrefix` keeps the headers; a hop outside drops them for good.
2. mpv loads the final URL with those headers and FFmpeg's `max_redirects=0` (`stream-lavf-o`), so a redirect on
   a later request (a seek, a reconnect) fails instead of being followed.

On Basement against the same local pair: a redirect from A to B sent the probe to A with the credential and
every request to B without it; a redirect within A's `/media/` kept it. A URL without headers (Ether's broker
URLs) is loaded as is, redirects and all.

#### Releasing a build with libmpv (LGPL-2.1-or-later)

MPVKit's LGPL product is linked as **static** libraries (libmpv, FFmpeg, libass, libplacebo, gnutls and the rest
of `ios/mpvkit-1.0.0.txt`). A distributed app that statically links LGPL code must let its users relink it
against a modified version of those libraries. Before any build leaves this team (TestFlight, the App Store,
an ad hoc install for someone else), the release must provide one of:

- the app's object files (or an Xcode archive's intermediate objects) and the link command, plus the exact
  corresponding source of every LGPL library used (MPVKit 1.0.0's sources at the pinned hashes, with any
  patches), and the licence texts; or
- a build where the LGPL libraries are dynamic frameworks the user can replace (MPVKit publishes static
  xcframeworks, so this means building them as frameworks ourselves).

The App Store's own terms complicate the first option; record the choice in the release checklist before the
first external build. The GPL product (`MPVKit-GPL`) is never linked.

### Android implementation (conversion)

Kotlin, the same contract, libmpv from mpv-android's build on a `SurfaceView`,
`hwdec=mediacodec`. Android TV uses the same module; display mode matching through
`Surface.setFrameRate` and `Display.Mode`.

### Web implementation

The web keeps the Vela-owned WebCodecs/WebGPU core (`client/player/core`) behind the same
contract, as `VelaPlayerView.web.tsx`, which mounts the engine into a DOM node through
react-native-web. Native `<video>`/MSE remains its last resort. The old player paths the
playback lead is excising stay excised.

## Spike (a): the React skin renderer

Owner: `thr_b57w7znkf9`. Location: `apps/vela`, `packages/skin`. It moves no existing file:
it imports `client/src`, `protocol/v0` and the Vela base by path alias.

Scope: the home route and the title route of two documents, the Vela base as Cinematic
and Mochi, drawn with live data from an Ether adapter. Hero, rows, cards, title detail,
the search field widget filtering titles, the appearance switch between the two
documents, and focus navigation on tvOS. Not in scope: player, live, guide, library,
the auth screens (the spike signs in from configuration).

**Spike (a) passes when** both documents draw home and title on web (1440 px and
390 px), the iOS Simulator and the Basement Apple TV, side by side with screenshots of the
Exact build of the same documents, with focus moving through hero, rows and cards on tvOS
by remote. Known differences go in this document, row by row.

### Spike (a) findings (web and tvOS Simulator, 2026-11-16)

Drawn from live mock data: the Vela base (Cinematic) and Mochi home and title on the web at
1440 and 1920 px, and on the tvOS Simulator at 1920x1080. Native differences found and fixed in
the renderer, each a rule now:

- **Native masks wrap their box in flow.** The mask takes the box's geometry and the box fills
  it. An absolutely filled child left the mask with no height, which hid every masked shelf
  and the nav natively.
- **Column items keep their size natively.** CSS's `min-height: auto` keeps a column's items at
  least as tall as their content; Yoga has no automatic minimum. Natively a column item shrinks
  only when the document sets `flex`/`flex-shrink`. Row items shrink, as in CSS.
- **Native font weights** round to the nine named steps (`650` → `700`).
- **No base URL natively**: `/vela` is the web export's alone (it broke `export:embed`).
- **Hermes formats `Intl` units through the platform** (90 minutes came out "5,400s").
  Duration and percentage labels use catalog strings around plain numbers (`@vela/core` i18n).
- **SVG assets** are bundled as data URIs (`apps/vela/svg-transformer.js`): Metro rejects SVGs
  sized `100%` as image assets.
- **Mixed-percentage lengths** (`calc(100% + 6px)`, `min(560px, 80%)`) are exact on the web.
  Natively `calc(P% ± …)` keeps the percentage, and `min`/`max` keep the argument that wins at
  the viewport's size.
- **A text drawn as a centring flex box** (a badge, an initial in a circle) centres its line.

Still differs from the Exact build: the framed title page draws as its own route, without home
underneath.

## After the spikes

1. Move files into `packages/` with `git mv` once the adapter redesign has landed.
2. Renderer to the full vocabulary and every route; all widgets.
3. Player module integrated on iOS and tvOS; player chrome as widgets.
4. Android and Android TV (player module in Kotlin).
5. Web parity with the existing web core.
6. Release and distribution: signed skin documents unchanged; app builds through
   `xcodebuild`/Gradle locally (or EAS, owner's call).
7. Delete the Exact client (list above).
8. macOS host, Windows host.

## Open questions

- Whether mpv's HTTP stack can be held to "no headers after a cross-origin redirect", or
  the host must resolve redirects before loading. Spike (b) answers this.
- HDR/Dolby Vision output path on tvOS through MoltenVK (EDR, HDR10 passthrough). Spike
  (b) records what it gets; full HDR may need a Metal presenter later.
- Audio passthrough (TrueHD/DTS-HD bitstream) on tvOS is not available to third-party apps
  in general; decoded multichannel PCM is the expected path.

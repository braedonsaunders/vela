# Skin distribution: from "make me a skin" to every viewer's screen

Owner requirements, verbatim:

> I want the user on the server to be able to download a new skin and set that as the
> default skin for all his users, his remote users, on their app, and it take place right away.

> If the skins need to be built into the binary, how is some dude going to tell his coding
> agent to make him a new skin and then load it into his server and push it to his clients?

Short answer: a skin is **source**, and the server builds it. An owner (or their coding agent)
writes a skin package against Vela's slot contract, `bun tools/skin.ts build` (or Ether's
sandboxed builder) compiles it with the pinned Vela and Exact into a signed client build,
Ether installs that build and makes it the default, and every connected viewer switches on a
server event. Simple reskins (colours, fonts, imagery) skip the build entirely: they are
**skin packs**, data that applies live over a compiled engine. Native apps (Apple TV) are a
separate, harder story, covered at the end.

## End state: every skin is data (owner directive)

> Once skins are data, completely remove the old compiled skin code. One build, no skin code baked in.

This supersedes the compiled-package path below (sections 5.3 builder and container,
per-engine builds): those remain only until the conversion finishes, then they are
deleted. What ships at the end:

- **One client build:** the foundation (routes, data, auth, playback engine), the
  generic renderer (`client/renderer`, generated) and a small set of compiled
  **widgets** the documents place and style through `params`: search field, player
  scrubber and track/quality menus, guide time grid, sign-in fields and quick-connect
  code, hero/card trailer previews, install/update, visibility sentinels, the
  appearance picker.
- **Every skin is a document plus assets** (`docs/skin-schema.md`): Cinematic, Index,
  Jelly Twin, Marquee, Mochi and example included. Ether stores and serves them; the
  picker lists them with previews; the server default (and force) switches viewers live.
  `tools/skin.ts` becomes the document validator and packager (no compile).
- **Two renderer call sites in the whole app** (Exact inlines a component per call site,
  `docs/skin-authoring.md` "Performance"): the shell, and one route view inside the
  navigation stack that draws whichever route's tree the document has (home, title,
  collection, library, live, watch), with that route's models in its environment.
  Today's per-slot call sites (Shell, Home) become these two; Detail, Search, Library,
  Collection, Status, Auth, Player chrome and Guide are trees in the document, not
  compiled slots. Heavy widgets are drawn only by the first levels.
- **Deleted at the end:** `client/skins/<id>/`, the dispatch in `foundation/skin.contract`
  and its slot API, `tools/engine.ts` profiles, `client/player/engine-handoff.ts` and the
  engine loader, per-skin tokens/icons/strings in `app.tamber` and `strings/`, and the
  docs on compiled skins (`docs/skins.md` slot tables, compiled sections of this file and
  of `docs/skin-authoring.md`).

**Rough sizes.** Compiled skin source today: Cinematic 2,483 lines, Mochi 2,435, Marquee
2,274, Jelly Twin 1,823, Index 497, example 225 (about 9,700 lines of Contract plus their
`app.tamber` blocks). The all-skins entry is 2.6 MB gzip; one compiled engine is about
300 KB. The renderer measured about 20 KB gzip per level copy (doc engine 503 KB gzip
with 16 copies plus cinematic's remaining compiled slots). The end-state build carries
16 level copies (shell 6, route view 10), the widgets and the foundation: estimated
450-550 KB gzip for all skins together, against 2.6 MB today; each further reduction of
the per-level element (about 85 bound rows) shrinks every copy.

**Order.** Each step ends with side-by-side screenshots (compiled vs document) at 1440 and
390 and a measured size, then deletes that skin's compiled code.

1. **Renderer to the end-state shape** (architect): the route view call site, route
   environments (home, detail, search, library, collection, live, watch, auth), the
   widget set, detail/search/library/player/guide vocabulary. Cinematic's compiled slots
   stay as the reference while this lands.
2. **Cinematic** (architect + UI lead): Shell and Home are done as data; then Row,
   Search, Detail, Library, Collection, Status, Auth, Player chrome, Guide. Delete
   `client/skins/cinematic`.
3. **Index** and **example** (small; prove a light, split-detail layout).
4. **Jelly Twin**, **Marquee** (skin owners convert their own once the schema is stable).
5. **Mochi** last (mascot, pixel art and playful motion: animated SVG assets and the
   motion presets).
6. Delete the dispatch, engine profiles and hand-off, the per-engine release path, and
   the compiled-skin docs; one build.

## 1. What Exact can and cannot do (evidence, Exact `29e5bbd`)

| Question | Answer | Evidence |
| --- | --- | --- |
| Load Contract or a plan at runtime? | No. The web target is the plan compiled to one ES module; a computed `import()` is refused and code from strings throws. | `vendor/exact/AGENTS.md:153-154`; `docs/reference.md:3903` |
| Swap design tokens at runtime? | Only in development. Live token batches (`design`/`setTokens`) rewrite the tuple rules' custom properties, but a release build strips that runtime. | `host/web-js/modes.js:21-23`, `:197-302`; `host/web/build.mjs:243` (`withoutDev`) |
| Are tokens CSS custom properties in release? | Only tokens that **vary by an app axis**. A release build folds every other token inline. | `host/web-js/src/modes.rs:25-28`, `:105` |
| Does a `when` line with the same value make a token vary? | No: equal CSS text clears the slices. | `contract/lower/src/theme/bind.rs:229-231` |
| App modes switchable live? | Yes: `setMode(axis, value)`, and a dynamic `-exact-mode` pin per subtree. | `docs/contract-grammar.md:2921`; `apps/theme-fixture/app.contract:37` |
| Signed OTA updates (`deploy.activate: "immediate"`, `push.mjs`)? | Native hosts only. A manifest that names no native platform ships the web root alone, with no stream and no envelope. | `scripts/deploy.mjs:772`; `scripts/app.schema.json:1173-1180`; `AGENTS.md:232-245` |

Consequences for Vela (a web host today, `client/app.json` `host.web`):

- A genuinely new layout is new Contract, so it needs a compile. There is no way around
  that in Exact, and Vela does not need one: compiling is cheap, and the server can do it.
- Runtime theming is possible in release builds if Vela opts its engine tokens into an app
  axis. Vela does that (section 3), with a workaround for the equal-value rule.
- Web delivery is Vela's own: Ether serves the static release and Vela's service worker
  updates it (`docs/distribution.md`). Exact's signed streams are the native path (section 9).

## 2. Three tiers

| Tier | What changes | Needs a build | Who makes it | Reaches viewers |
| --- | --- | --- | --- | --- |
| **Skin pack** | Colours, display font, radii, imagery, swatches over a compiled engine | No | Owner, designer, agent (JSON + assets) | Instantly: a server event; no reload |
| **Skin package** | Any layout: new Contract against the slot contract | Yes: `tools/skin.ts build`, or Ether's builder | Owner's coding agent, community | Ether installs the signed build as the client release; viewers switch on the next event |
| **Official engine** | Vela's own engines (cinematic, index, jellytwin, mochi, marquee) | Vela release | Vela | Ether's Apps card auto-updates the client from the release channel |

All three share one switch: the server's **Appearance** (`protocol/v0/types.ts`):
`defaultSkinId` (an engine, a built skin, or an installed pack), `defaultEngineId`, the
owner's `force` flag and the installed packs, with a monotonic `revision`.

## 3. The live default (prototyped)

- `GET /vela/v0/appearance` is public (the server's look is not viewer data), so even the
  sign-in page wears the default. `GET /vela/v0/events` is a viewer-level SSE stream (not a
  playback session): the current appearance on connect, then one event per owner change.
- The foundation resolves `requestedSkin = (skin == "" or appearance.force) ? serverDefault : skin`.
  A viewer's own pick wins unless the owner forces the default; the pick is kept, so
  un-forcing restores it. Unknown ids fall back to cinematic, as before.
- A pack id runs its engine with the pack applied; an engine id runs that engine.
- Retry: the event stream reconnects every 3 s (up to 30 attempts), and starts from a fresh
  `/appearance`. A client ignores an older revision.

Files: `client/foundation/appearance.contract`, `client/src/appearance/index.ts`,
`client/foundation/behavior.contract` (`activeSkin`), `client/app.contract` (root pin and
`vela-theme`), `mock-server/appearance.ts`.

## 4. Skin packs: data over an engine (prototyped for cinematic)

**How it works.** `client/app.tamber` declares `axes: pack = house | installed`. Every
engine-facing colour token (cinematic, surface, ink, brand, media), the cinematic display
family and three radius tokens carry a `when pack=installed:` value one invisible step from
house (one alpha unit, 0.01 px, a `ui-serif` fallback), because equal values are dropped and
then folded (section 1). So a release build keeps them as `--x-*` properties in a
`[data-x-modes="pack=installed"]` rule. The root pins `-exact-mode="pack=installed"` while
a pack is active, and the `vela-theme` native view (`client/player/theme.ts`) adds one
stylesheet that redeclares those properties from the pack:

- **Palette roles.** Each engine names roles by the token that anchors them (cinematic: page,
  raised, ink, inkSecondary, inkQuiet, inkInverse, accent, ember, tide, dusk, live). Every
  token within RGB distance 48 of a role keeps its offset from that role, so one accent change
  moves the focus halo, guide highlights and live-edge tints together, alpha preserved.
  House values come from the build's own CSSOM, never duplicated in code.
- **Explicit tokens.** `tokens: {"cinematic.guide-now": "#ff6b5e"}`, only for properties the
  build exposes.
- **Display font.** Same-origin woff2/woff/ttf/otf through `FontFace`, family namespaced
  `vela-pack-<id>-display`, prepended to the house stack, with `sizeAdjust` (50-150 %) so a
  face with other metrics keeps the engine's line lengths.
- **Radii.** `card`, `panel` (0-48 px) and `pill` (0-999 px), applied where cinematic uses the
  radius tokens (fields, pills, the auth panel). Literal radii elsewhere in cinematic are not
  yet tokens; the UI lead agreed to use tokens going forward.
- **Imagery.** `preview` (picker), `backdrop` and `wordmark` (cinematic AuthStage: the owner's
  brand on the sign-in page).

Switching packs, or back to house, is a pin flip and a stylesheet swap: no reload, no rebuild.

**Validation (data only).** The data module (`src/appearance`) admits a pack only with schema
1, an id that is not an engine, a known engine, at most 64 KiB, colours `#rrggbb[aa]`, lengths
in range, at most 4 font files, and image/font URLs on the server's own origin under
`/vela/v0/appearance/` with no query or fragment. The view builds CSS only from values it
derives itself; no pack text reaches CSS except a sanitized URL inside `url("")`. Ether serves
pack assets with `X-Content-Type-Options: nosniff` and the CSP of section 7.

**Verified** with one drive (mock, `bun exact.mjs agent web`): the Harbor default re-themes
cinematic (sea-glass palette, rounded display face) and an owner switch to cinematic over
`/events` restores the house look in the open page without reload (revision 2 to 3).

**Gaps.** Packs exist for cinematic only; other engines need the same axis lines and a role
table in `theme.ts` (an hour each). The picker does not yet list packs: `SkinPicker` takes
`skins: string[]` and resolves manifests from compiled skins, so packs need the slot API to
pass manifests (`looks: SkinManifest[]`), a change across six skins for the UI lead. Until
then packs are reachable as the server default, which is the owner's requirement.

## 5. The coding-agent flow (the centre of this design)

```
owner: "make me a skin that looks like an old cinema marquee"
  agent: bun tools/skin.ts init ./marquee-night --id marquee-night     # package from the reference skin
  agent: edits slots.contract against docs/skins.md (the slot contract)
  agent: bun tools/skin.ts check ./marquee-night                        # rules below, no build
  agent: zip the directory, or bun tools/skin.ts build ./marquee-night  # local, signed
owner: Ether > Apps > Vela > Skins > Upload   (source zip, or a signed build)
  Ether: validates, builds in the sandboxed builder (if source), verifies signature, installs
owner: "Make default for everyone" [ ] Override viewers' own choice
  Ether: Appearance revision+1, event to every connected viewer
viewers: the client takes the new release and switches skin with the dissolve
```

### 5.1 The skin package (source)

```
marquee-night/
  skin.json          {"schema":1,"id":"marquee-night","name":"Marquee Night","version":"1.0.0",
                      "tagline":"…","slotApi":2,"vela":">=0.1.0 <0.2.0",
                      "preview":"assets/preview.jpg","swatches":["#101010","#f5f1e9","#e8b33b"]}
  slots.contract     the slots it implements (below)
  *.contract         more components, imported as ./name.contract
  strings/en.json    optional, keys "skin.<id>.*" only
  assets/            png, jpg, webp, avif, svg, ttf, otf, woff, woff2
```

**Slot ABI 2** (`slotApi: 2`): a package implements any of the slots in
`docs/skins.md` (`Shell`, `Home`, `SearchSurface`, `Detail`, `PlayerChrome`, `Guide`, ...)
as components that each take one record prop `p` (`foundation/slot-api.contract`) and
`inject` the actions they call, plus optional `detailPresentation(width)` and
`detailSplit(width)`. Slots it leaves out are the default skin's. It may import the shared
models (`foundation/models`, `player-models`, `skin-picker`, `slot-api`, `live/models`) and
any official skin's components (`../index/player.contract`) as a base, as
`client/skins/example` does. Official skins are packages of exactly this shape, installed
by the same generator.

### 5.2 Rules (`tools/skin.ts check`)

- No `resource`, `mutation`, `members`, `send`, `refresh` or `persist`: a skin receives props
  and calls the actions it is given; it cannot reach the app's sources or storage.
- No native views (`vela-*`), no URL outside the app in Contract or SVG; SVG without script,
  handlers or external `href`.
- Imports only from the package and the allowlist above.
- Only package file types; no links. Limits: 200 files, 512 KiB Contract, 1 MiB per asset,
  4 MiB total. At least one slot, each taking its record; `slotApi` and the id checked.

The static rules are the first line. The binding guarantees are structural: Contract cannot
perform I/O, the data module holds credentials, and the page's CSP (section 7) refuses any
foreign image, font, media or connection a hostile skin might build at runtime from data.

### 5.3 The builder

**Local (prototyped): `bun tools/skin.ts build <dir> --key <id>`.**
1. `check` the package.
2. Stage the **committed** Vela client (`git archive HEAD client protocol`), never the
   working tree; require `vendor/exact` at `EXACT_REVISION`.
3. Install the package as `client/skins/<id>/` (asset paths rewritten to
   `assets/skins/<id>/`, assets and strings merged), then generate the build's registry
   with `--only <id>` (`tools/skin-registry.ts`, the generator every build runs): the
   dispatch holds the package and the default skin's fallback slots; the skin list and
   manifests cover every installed skin.
4. `player/build.ts`, then Exact's production `web-build --out dist --render none`.
5. Write `~/.scratch/tmp/vela/skins/<id>-<version>/webroot.tar.gz` and `skin-build.json`:
   id, version, slot API, Vela version and revision, Exact revision, the source digest per
   file, the archive digest, every output file's size and SHA-256, and an Ed25519 signature
   over the canonical manifest (sorted keys, no whitespace, as Exact's update envelope).
   `bun tools/skin.ts keygen <id>` makes the key (`~/.config/vela/keys`, mode 0600).

Measured on the reference package (`init --id noir` from the example skin, Vela 0.1.21
`d405cf5`): 1 min 39 s on this Mac, 114 files, `webroot.tar.gz` 3.4 MB, `app.js` 2.0 MB gzip
(all official skins plus the package); the signature verifies and a tampered manifest does
not. The build compiles; it has not been served and driven (it needs a same-origin server).

The output is a **complete Vela client release** with every official skin plus this one.
Installed as the server's client, viewers keep all official skins and gain the new one, and
the server default names it. That works with today's single-bundle client; nothing waits
for the paused per-engine loader.

**Server-side: the builder container** (for owners with no toolchain). One image per Vela
release, `vela-skin-builder:<vela-version>`, containing that release's committed client source,
the pinned Exact checkout and its built compiler, Bun, and `tools/skin.ts`. Input: the package
directory read-only. Output: the build directory. Run with no network, read-only root, a
tmpfs work dir, 2 CPU, 3 GiB memory, a 15-minute wall clock, and an unprivileged user. Ether
signs the result with its own server key (the container never sees it). Packages are data to
the compiler: Contract and assets are parsed, not executed, so third-party source is safe to
compile; the container contains a compiler bug, not a skin.

**Rebuilds.** A package is source, so it survives Vela upgrades: when the Apps card installs a
new official release, Ether rebuilds every installed package against it in the builder of that
release; a package whose `slotApi` or `vela` range no longer matches stays on its last build
(and its client release) or is disabled, with the reason shown to the owner.

**Engines.** Each package is its own single-engine build, served beside the official
engines; several custom skins are several builds. Keep icons as `symbol:` assets.

### 5.4 Agent quickstart (paste into a coding agent)

```
Goal: a Vela skin package named <id> that looks like <description>.
1. In a Vela checkout (Exact at EXACT_REVISION), run: bun tools/skin.ts init ./<id> --id <id>
2. Read docs/skins.md (slot props and rules) and the package's slots.contract.
   Keep every exported component and fn and its props. Change only presentation.
3. Use Tamber token names or literal colours; put images and fonts under ./<id>/assets and
   reference them as "assets/<file>". No resource/mutation/members/send/refresh/persist,
   no vela-* views, no http(s) URLs. Text: existing Vela keys via t(), or your own
   "skin.<id>.*" keys in strings/en.json.
4. Edit skin.json: name, tagline, swatches, preview (a 16:10 screenshot under assets/).
5. bun tools/skin.ts check ./<id>  until it says valid.
6. bun tools/skin.ts build ./<id> --key <key-id>  (keygen once) to test-compile, or
   zip ./<id> and upload it in Ether > Apps > Vela > Skins, which builds it for you.
```

## 6. Delivery to web viewers, right away

1. **Pack or default change:** the `appearance` event; applied in the open page (prototyped).
2. **New client build (official update or an installed skin package):** Ether switches the
   `current` release pointer (`docs/distribution.md`), then sends `{type:"release",
   version}` on `/events`. The client asks its service worker registration to `update()`;
   when the new worker is waiting and the viewer is not playing, it applies it (the existing
   `applyUpdate`) at once behind the skin dissolve, preserving the route; during playback it
   waits for the session to end. A cold client simply loads the new release. Not yet built:
   the `release` event type and the pwa.js hook (packaging owner).
3. **Offline / cached:** the service worker shell serves the last release; the last appearance
   is not cached, so an offline client shows its persisted pick or the build's default, and a
   pack only applies once `/appearance` answers. A pack stays applied after a dropped stream.

## 7. Security

- Packs are data; skin packages are Contract compiled by Exact. Neither ships JavaScript.
- Ether serves `/vela/` with a CSP that leaves skins no channel out of the page:
  `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self';
  connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`,
  plus the script and style sources Exact's index.html needs (inline bootstrap: hash or
  nonce; to verify against the release build before shipping).
- Signed builds: Ether verifies every build's signature and every file hash before
  extraction, accepts keys it trusts (its own builder key; keys the owner adds), and never
  extracts over the active release (as `docs/distribution.md`).
- Limits: packs 64 KiB and 32 per server; packages as 5.2; built releases as the release
  installer's size limits.
- Credentials never move: skins receive presentation props only; packs carry no viewer data.

## 8. Versioning, compatibility, rollback

- Pack `schema` (1) gates the format; a client skips unknown schemas and unknown engines and
  shows that engine's house look. A pack's `engine` must be one the client has.
- Package `slotApi` (1) gates the slot contract; `vela` names the client range it builds
  against. Built releases carry `velaVersion`, so negotiation's `compatibleClientBuilds` still
  applies unchanged.
- Rollback: appearance revisions are cheap (Ether keeps the history and can re-publish any);
  client releases keep `current` and `previous` (`docs/distribution.md`); a skin build that
  fails to start rolls back automatically and stays installed for diagnosis.

## 9. Native apps (Apple TV, iPhone, Mac)

**How Exact native hosts run a skin.** A native binary embeds one bundle (`app.plan` plus
assets): "entry zero" (`update/src/lib.rs:28-29`). Its update store can boot a newer signed
bundle instead (`update/src/lib.rs:1-20`): a whole new plan, so a new skin is just a new plan;
there is no partial plan loading. tvOS is a supported Apple target
(`host/apple/build.mjs:10-11`, `:148`). Vela's `app.json` names only `web` today, so none of
this is wired yet.

**Can Exact deliver a new plan to an installed Apple TV app without an App Store release?**
Yes, for Vela's own releases: `deploy.mjs` publishes signed bundles per stream, `push.mjs`
publishes an edit in about a second, and `deploy.activate: "immediate"` applies it while the
app is open (`AGENTS.md:232-245`; `host/apple/Sources/ExactUpdates/Updates.swift:128-129`,
`:322-325`). A stream is bound to the binary's compatibility id, which covers its native
modules (`update/src/lib.rs:8-10`), so new native code or a new native module always needs a
binary release; Contract and assets do not.

**Can each owner's Ether be the update origin and sign its own skins?** Not with Exact as
pinned. The origin and verification keys are baked into the binary (`update/src/binary.rs:1-6`,
`:107-114`); a production binary checks only its baked origin (`binary.rs:218-229`); the
`EXACT_UPDATE_ORIGIN` override is development apparatus, and even it "changes where a client
looks, never what it trusts" (`update/src/client.rs:10-15`, `:141-144`; the Apple host
honours it only in agent mode, `Updates.swift:232`). So an owner-built skin cannot reach an
App Store Apple TV app today, and no Vela-side workaround is honest. What Exact would need
(for the orchestrator, not done here):

1. A runtime origin per server: the host opens its store at an origin the app supplies
   (the Rust API already takes one: `Client::open_at`, `client.rs:147-157`), with one store
   per server so one Apple TV paired to one Ether only ever boots that server's bundles.
2. A runtime trust root: a key added after install, pinned on first pairing (the sign-in
   or Quick Connect exchange carries the server's skin-signing key; later changes need
   re-pairing), alongside the baked Vela key, which keeps signing official releases.
3. A fallback rule: a server bundle whose compatibility id or schema mismatches is never
   booted; entry zero or the last Vela-signed bundle runs instead.

**App Store.** Exact plans are interpreted by the runner compiled into the binary, the same
shape as downloaded JavaScript run by JavaScriptCore, which App Review Guideline 2.5.2 allows
when it does not change the app's primary purpose or create a store; skins only re-present
the same media client. Unverified: no Exact app has been through review with OTA plans that
we know of, and per-server unsigned-by-us content is a further step reviewers may question.
Lower-risk native path until then: native apps take packs (data) and official engines, and
custom packages stay web-only.

## 10. Exact gaps found (notes for the orchestrator)

- No release-build way to keep a token as a CSS property without an axis; equal `when`
  values are dropped (`bind.rs:229`). Vela works around it with a pack axis and
  one-step-off values. An `export`/`runtime` mark on a token would remove the hack.
- No runtime theme API in release (`modes.js` dev-only live table); Vela uses its own view.
- Native update origin and trust are build-time only (section 9).
- No lazy plan loading, so N skins means N builds or one bundle with all of them.

## 11. Ether-side requirements (hand to the Ether orchestrator)

**Appearance and events (protocol v0, `protocol/v0/README.md` "Appearance and server events").**
- `GET /vela/v0/appearance`: public, ETag/304, `Appearance` with a monotonic `revision`.
- `GET /vela/v0/events`: authenticated SSE per viewer device; first event the current
  `appearance`; then each change; `id:` = revision; 15 s keepalive; closes on revocation.
  Reserve `{type:"release", version}` for client updates (section 6).
- Pack assets: `GET /vela/v0/appearance/packs/<id>/<version>/<file>`, public, immutable
  cache, `nosniff`, image/font MIME types only.

**Apps card: Vela > Skins (owner only).**
- List: official engines, installed skin packs, installed skin builds, each with preview,
  swatches, version, source (catalog, upload, builder), status.
- Install a pack from the catalog or an upload (JSON + assets zip): validate exactly as
  `client/src/appearance` does (schema, sizes, colours, same-origin asset paths it rewrites),
  store under the data dir, assign immutable asset URLs.
- Install a skin package (source zip): validate with the rules of 5.2, build it in the
  builder container of the active Vela release, sign with the server's build key, install.
- Install a signed skin build (`webroot.tar.gz` + `skin-build.json`): verify the signature
  against trusted keys (server key; owner-added keys, shown with fingerprints), verify every
  file hash, check `velaVersion` against the active release and `protocolVersions`.
- Activate a build: it becomes the client release (`current`, keeping `previous`), then
  send `release` on `/events`. Reverting is one click (the previous release and appearance).
- Default: "Default skin for everyone" selector (engines, packs, builds) and "Override viewers'
  own choice" (`force`). Saving bumps `revision` and pushes `appearance` to every open stream.
- Uninstall: refuse while it is the default; viewers who picked it fall back to the default.

**Builder container.** Image per Vela release (`vela-skin-builder:<version>`), run as in 5.3:
no network, read-only root, tmpfs, CPU/memory/time limits, unprivileged, package mounted
read-only, output directory only. Rebuild installed packages after each official update;
surface failures with the builder's message.

**Release channel and auto-update.** The Apps card follows Vela's signed release channel
(`docs/distribution.md` installer rules), installs updates side by side, switches `current`
atomically, rebuilds installed packages, and sends `release` so open clients update now.

**CSP and headers** for everything under `/vela/` as section 7.

## 12. What is built, and where

| Piece | State | Where |
| --- | --- | --- |
| Appearance protocol, events, mock owner switch | Done | `protocol/v0/types.ts`, `protocol/v0/README.md`, `mock-server/appearance.ts` (`POST /__admin/appearance {defaultSkinId, force}`) |
| Live default, force, viewer pick precedence | Done, verified live | `client/foundation/appearance.contract`, `client/src/appearance/` |
| Skin packs over cinematic (palette, display font, radii, auth imagery) | Done, verified | `client/app.tamber` pack axis, `client/player/theme.ts`, `client/skins/cinematic/{look,auth}.contract` |
| Packs in the picker | Not built (slot API change, UI lead) | section 4 |
| Skin package check / init / keygen / build + signing | Done | `tools/skin.ts` |
| Builder container, Ether install/activate/default UI, `release` event, CSP | Ether / packaging | section 11 |
| Native OTA of owner skins | Blocked on Exact (runtime origin + trust) | section 9 |

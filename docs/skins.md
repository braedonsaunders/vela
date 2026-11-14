# Vela skin contract, v0

Skins are compiled Contract packages, selected by the foundation. They execute no
JavaScript, hold no credentials, make no requests, and never rank or reorder data.
The cinematic implementation is `client/skins/cinematic/slots.contract`.
A replacement exports the same component names and prop names/types. Shared records
are imported from `client/foundation/models.contract`; these are total projections
of `protocol/v0/types.ts`, not a second wire protocol. The data module alone converts
optional artwork, metadata and capabilities to these presentation records.

| Slot | Props and content |
| --- | --- |
| Shell | `viewer:string`, `skin:string`, `skins:string[]`, `chooseSkin(string)`, `signOut()`; one children slot containing the route scroll surface |
| Home | `model:HomeModel`, `query:string`, `small:bool`, `still:bool`, `selectTitle(id,kind,receipt)`, `observe(receipt,IntersectionObserverEntry)`; children slot holds the foundation search field |
| SearchSurface | `query:string`, `model:SearchModel`, `descriptive:SearchModel`, `ai:SearchModel`, `generation:number`, `loading:bool`, `error:bool`, `aiAvailable:bool`, `small`, `still`, `selectTitle`, `observe` |
| Row | `row:FeedRow`, `small`, `still`, `selectTitle`, `observe` |
| TitleCard | `card:Card`, `small`, `still`, `selectTitle`, `observe` |
| Detail | `model:DetailModel`, `small`, `still`, `play(id)`, `playExtra(id)`, `selectTitle`, `observe` |
| PlayerChrome | `model:PlayerView`, `title:string`, `visible:bool`, `small:bool`, `still:bool`, `serverError:string`, `busy:bool`, `command(kind,value)`, `seek(seconds)`, `editing(bool)`, `close()`; presentation-only cinematic controls over engine observations and server-authorized seeks/path changes |
| Guide | `model:GuideModel`, `small:bool`, `watch(channelId)`, `previous()`, `next()`; the model is one local day (`day` 0-6 from today): channels in server order with favourites first, programmes by start time with `at`/`span` in minutes from the day's start, re-projected every minute (airing, progress, now/next) without refetching. Cinematic also takes `still`, `zoom` (0-2, persisted) with `setZoom(z)`, and `chooseDay(offset)`, and owns its scroll containers; other skins are wrapped in a route scroll. |

Action props are declared `action` in Exact; arguments above document their inferred
signatures. Every prop is required. See models.contract for exact field definitions.

Card IDs remain protocol identities: movies, shows, seasons and episodes are distinct.
`kind` preserves that distinction. A blank artwork URL means absent, not a request to
invent an image. `facts` is server metadata formatted by the data module. `receipt`
is the server interaction receipt; an empty receipt means no report can be made.
Hero/title are zero-or-one arrays to represent optional records in Contract.
Rows and items must remain in incoming order. Non-title row kinds require their own
navigation support before being exposed as playable title cards.

The foundation owns query URL/generation, requests, navigation, selection receipts,
and deduplication. The search model must match the active query AND generation before
any lane is displayed; `loading` hides stale content. AI appears only with capability
advertisement and nonempty server job status. It never gates ordinary matches.

A skin reports geometric visibility through `intersect=observe(card.receipt)` with
zero overscan. It must not call observe during preload, mount or rendering. The
foundation only accepts positive intersection for the active home route with a visible document and sends
at most one receipt per app lifetime. Hidden/recycled cards cannot create more views.
Exact currently exposes threshold-zero snapshots, not continuous ratio/dwell tracking.

The root retains `stack(nav)` entries and uses Exact modal navigation for detail.
Skins must preserve focusable semantic buttons/links, accessible names, headings and
search input. Keep mobile layouts usable under a keyboard; use `small` to recompose,
not scale. `still` means reduced motion; all nonessential motion must be disabled.
Hero artwork always appears immediately. A preview is mounted only for a server-confirmed cached, unexpired playable grant; without that grant it stays artwork-only.

Colors are Tamber tokens in `client/app.tamber`. A skin may add its own namespaced
tokens and choose entirely different layout, typography and geometry. Asset access
continues to follow server viewer policy. Unknown skin IDs fall back to cinematic.
Both compiled skins are dispatched by the foundation state.

Auth slots (cinematic only, used for every skin before sign-in): `AuthStage(still)` is the
ambient stage with one children slot; inside it the foundation shows `AuthNotice(kind, still)`
(`offline`, `connecting`, `redeeming` a web code), `SignIn` (username, password,
passwordAvailable, quickAvailable, error, busy, still and editUsername/editPassword/submit/quick
actions) or `QuickConnect` (model:QuickModel, error, still, cancel). Foundation owns auth
state, silent webCode redemption, URL cleanup, server poll interval and terminal grant handling.

`Status(skin, kind, message, small, still)` presents waiting and failure moments the
foundation reports (`home`, `detail` skeletons, `loading`, `failure`). Cinematic draws
shimmer skeletons and designed failures; Index and example keep a plain status line.

PlaybackModel carries `sessionId` and serialized `planJson`. The foundation seeds the
engine from uiPlayback, then uses matching sessionEvents stream plans. Stream failures
retry at most three times. Chrome never interprets the transport or invents recovery.

## Complete slot API

Shell also receives `viewport:Viewport`, `canLive:bool`, `canLibrary:bool` and
`home()`, `search()`, `live()`, `library()` navigation callbacks. Omit unsupported
destinations using capabilities; Library currently has no route and stays hidden.
`SearchField(query:string, edit(string))` owns all field presentation. Home's content
slot receives that skin's SearchField, with shared behaviour in the foundation.

Each skin exports `detailPresentation(width:number):string` (modal, fullscreen or
empty for ordinary stack presentation) and `detailSplit(width:number):string`
(none or the split list width). The root binds these to Exact navigation attributes.
Index splits at 900 pixels; cinematic uses a fullscreen route with a 90vw by 90vh artwork overlay on desktop and a full-screen mobile sheet.
Retained stack entries preserve browse state, scroll and focus across both.

Card additionally exposes year:number (0 means absent), rating:string,
durationSeconds:number (0 means absent) and genres:string[]. Keep facts for compact
labels; use structured fields for semantic columns. Selection callbacks now take
`selectTitle(id, kind, receipt)` so title, channel and collection identities route
correctly. Collection contents are supplied in server order via uiCollection.

Foundation dispatch supports installed cinematic and index packages, with editorial
as an alias for index for older mock bootstrap responses. Unknown skin IDs use
cinematic. The persisted picker overrides the server bootstrap default. Switching
skins preserves the foundation's current query, navigation and receipt deduplication.

PlayerView is declared in `client/foundation/player-models.contract`. It exposes
actual playable buffer ranges, position, duration, backend/path/quality, available
track/quality/path options, chapters and supported browser actions. An absent audio
menu means the backend cannot actually switch the offered tracks. WebVTT menus
contain only tracks the plan supplies with renderable URLs. Buffering, recovering
and failed are distinct engine states; server rejection is shown verbatim.

The shared player foundation owns command sequencing, transport authorization,
keyboard shortcuts (Space/K, J/L or arrows, F), and the 3.5-second chrome idle task.
Focused controls and paused/recovering playback keep chrome visible. Skins receive
`still` for reduced motion and disable the opacity transition when it is true.
Source/seek authorization comes back as a PlaybackPlan; the newest revision wins
over an older command reply. Controls never claim a local source change when the
server rejects fallback availability or capacity.

Cinematic profile controls live in a viewer popover. Cards receive progressSeconds
for an optional watched-progress indicator; lift/scale is disabled for reduced motion.
DetailModel mediaFacts contains only server-verified format/audio information; absent
resolution/HDR/audio metadata produces no badge. Related rows remain server-ordered.

Related recommendations load independently through uiRelated(id):FeedRow[]. The
foundation merges only the current answer into DetailModel.related; loading or failed
recommendations never delay title metadata, capabilities or playback actions.

Hero preview fields are trailerReady:bool, trailerUrl:string and trailerExpiresAt:number
(Unix milliseconds). The native vela-preview view cross-fades only on actual playing,
removes its source when inactive, offscreen, Save-Data or reduced motion, and stops at
grant expiry. It creates no playback session or synthetic viewing receipt. An autoplay
refusal leaves the artwork visible. Search removes the preview surface immediately.

Cards expose played:bool, seasonId:string, seasonNumber:number and episodeNumber:number.
Both skins use shared cardName() labels including title, year and watched progress.
Cinematic show details select distinct season IDs, render episode progress and offer
the first unfinished episode in the server's episode order. Crew, cast, verified media
facts, extras and related rows are omitted when absent rather than filled with samples.

The cinematic viewer popover and Index navigation include native vela-install views:
pwaAction="install" appears only when installable; pwaAction="update" appears only
when a service-worker update is ready and directly invokes applyUpdate on a trusted
click. Unsupported or unavailable actions occupy no button. Auth/bootstrap waits for
the host's real media capability probe as well as its trusted page origin.

Home also receives active:bool from foundation route/page visibility. Cinematic
preview pauses for covered routes as well as search, document hiding and viewport
exit; a retained home behind a detail cannot keep its preview playing.

## Cinematic design tokens

`client/skins/cinematic/look.contract` is the one source for the official skin's motion,
type and surfaces; reuse it rather than writing literals.

- Curves: `glide()` (arrivals and lifts, `cubic-bezier(0.16, 1, 0.3, 1)`), `sweep()`
  (symmetric drifts), `release()` (exits). Durations: `quick()` 180, `base()` 360,
  `slow()` 640, `reveal()` 1100 ms.
- Ready-made animations taking `still`: `enter(still, delayMs)` (rise into place;
  dissolve when still), `open(still)` (surface zooming open), `expose(still)` (artwork
  exposing from black), `drift(still)` (32 s Ken Burns; none when still), `chrome(still)`
  (fade + short slide for chrome that shows and hides), `stagger(i, step, cap)`.
- Exit and layout values must be literals on the JS target: exits use
  `vanish 320ms ease-in both` (`vanish 160ms linear both` when still); layout moves
  `640ms ease-out` (`none` when still).
- Keyframes: rise, dissolve, vanish, pop, open, expose, drift, shimmer, spin, breathe,
  glow and the aurora set. Import the names you use.
- Type: `Display`/`DisplayItalic` (Instrument Serif, SIL OFL, bundled under
  `client/assets/fonts`) for titles; the platform UI face for everything read. `Eyebrow`
  (11 px, 0.24 em tracking, uppercase) for labels; `Meta` for tabular facts.
- Surfaces: `Glass`, `PrimaryPill`, `GhostPill`, `IconButton`, `Field` styles; the
  `Skeleton` component for shimmer placeholders. Colours are `cinematic.*` tokens in
  `client/app.tamber` (glass, glass-edge, scrims, skeleton, player scrims, ember/tide/dusk).
- Reduced motion replaces movement with dissolves and holds artwork still; it never
  removes state changes.

Live channels flick with Up/Down (PageUp/PageDown, ChannelUp/ChannelDown) through the
guide's channel order; the target tunes after a 1.1 s pause or Enter, replacing the watch
route. `MiniGuide(model, playing, target, small, still, tune())` shows the pending target;
skins without one show nothing. Cinematic `LiveControls` also takes `zap(step)`.

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
| Home | `model:HomeModel`, `query:string`, `small:bool`, `still:bool`, `selectTitle(id,receipt)`, `observe(receipt,IntersectionObserverEntry)`; children slot holds the foundation search field |
| SearchSurface | `query:string`, `model:SearchModel`, `descriptive:SearchModel`, `ai:SearchModel`, `generation:number`, `loading:bool`, `error:bool`, `aiAvailable:bool`, `small`, `still`, `selectTitle`, `observe` |
| Row | `row:FeedRow`, `small`, `still`, `selectTitle`, `observe` |
| TitleCard | `card:Card`, `small`, `still`, `selectTitle`, `observe` |
| Detail | `model:DetailModel`, `small`, `still`, `play(id)`, `playExtra(id)`, `selectTitle`, `observe` |
| PlayerChrome | `titleId:string`, `command(kind:string)`; foundation owns plan and engine-event forwarding, chrome sends play/pause/pip/fullscreen commands |
| Guide | Initial unavailable placeholder; live worker owns the final guide contract |

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
No hero trailer starts without a prepared and ready playback hook. The initial
cinematic skin intentionally renders immediate artwork only.

Colors are Tamber tokens in `client/app.tamber`. A skin may add its own namespaced
tokens and choose entirely different layout, typography and geometry. Asset access
continues to follow server viewer policy. Unknown skin IDs fall back to cinematic.
The v0 root exposes selection state; alternate compiled slot dispatch is added when
the next skin package exists, rather than pretending a color change is another skin.

Auth slots: `SignIn` receives username, password, passwordAvailable, quickAvailable, error, busy and editUsername/editPassword/submit/quick actions. `QuickConnect` receives model:QuickModel, error:string and cancel action. Foundation owns auth state, silent webCode redemption, URL cleanup, server poll interval and terminal grant handling.

PlaybackModel carries `sessionId` and serialized `planJson`. The foundation seeds the
engine from uiPlayback, then uses matching sessionEvents stream plans. Stream failures
retry at most three times. Chrome never interprets the transport or invents recovery.

## Contract gaps

- Shell has no viewport input or route actions, so Index cannot recompose its rail for mobile or offer Search, Live and Library navigation honestly. Add responsive state and supported navigation actions, with capability information for unavailable destinations.
- The Home child is a fully styled cinematic search field. A search field slot receiving query and edit action would let each skin control its presentation while keeping search behaviour shared.
- Detail is wrapped in a root-owned modal, preventing Index from choosing a true split-pane route. Expose presentation selection to the root while preserving the navigation stack and focus restoration.
- Cards expose a preformatted facts string rather than structured metadata, limiting accessible table columns; expose stable display fields alongside the formatted string.

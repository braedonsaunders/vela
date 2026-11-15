# Data module status

The Ether adapter implements the v0 JSON endpoints used by discovery, authentication,
search, interactions and session snapshots. Credentials are supplied through an
interface backed by Exact secret storage. Contract sources use opt-in mock sign-in
when `VELA_MOCK=1`; password, web-code and quick-connect sources support real
sign-in. Production binds its API origin once to the trusted serving page origin.
For an explicit `VELA_MOCK=1` development build, `API_BASE_URL` overrides that
origin and defaults to `http://127.0.0.1:7777`. Fast, descriptive and AI searches use
independent resources; AI jobs are cancelled on replacement. A bounded queue
coalesces visible receipts and flushes on hide, selection and sign-out. Device
grant UI and end-to-end playback verification remain open.

Session events use Exact's HTTP `exactStream` resource under `net.fetch`. Each
connection reads a fresh authoritative snapshot (also refreshing credentials on
401), then resumes from the last observed cursor or the snapshot cursor. The
server supplies a snapshot on a retention gap. Unknown or malformed events fail
the resource so a retry starts with a new snapshot. The UI owns bounded retries
and releases the stream when playback leaves the view. End-to-end behavior still
requires the mock server and player to be exercised together.

Exact currently lacks a serving-page same-origin grant, so the app holds
`net.fetch http:` and `net.fetch https:`. Every data-module request, including
the session stream, passes through the adapter, which pins its URL to the bound
origin and `/vela/v0/` path and refuses redirects. Only this wrapper attaches
bearer credentials and device IDs. Skins are Contract code and cannot issue
requests. Replace the scheme grants and application-level pin when Exact adds a
trusted same-origin grant that also scopes redirects. Ether can serve the same
static build at each origin; no per-server HTML template is needed.

## Native-server adapter interface (integration in progress)

The data module will select one configured server at a time. A server record has a
stable local ID, type (`ether`, `jellyfin`, `emby`, or `plex`), origin and optional
base path. The selected record is presentation-safe: it never contains credentials.
Ether remains the default when the app is served by Ether. Configuration and sessions
are scoped by server ID; changing servers invalidates the previous viewer's cached
answers, negotiation, event cursors and preview state.

Adapters translate their server's real behavior into the v0 types consumed by
`ServerAdapter`. They expose only supported features in capabilities and return an
honest unavailable error for unsupported operations. Authentication is per adapter:
its session validation returns a current viewer or a signed-out state; a transient
validation error is not sign-out. Native non-expiring tokens need no invented refresh.
Credentials and the stable client identifier remain in Exact secret storage, never
in the server registry or Contract-facing models. Sign-out invokes the selected
server's revocation operation and clears only that server's local session.

Each adapter pins authenticated requests and redirects to its configured origin and
normalized base path; credentials for another origin are never forwarded. Plex PIN
and resource discovery use their own explicitly scoped plex.tv authority, separate
from the selected PMS token. Ether retains its existing strict `/sessions/media/`
broker validation. Native adapters must explicitly validate their own media and image
paths against the selected origin and base path; adding them must not relax Ether's
rules. Universal and MSE playback send native-server credentials in request headers, never
in media URLs. Only native-element fallback may use a URL credential: Plex uses a
short-lived delegation token; Jellyfin may use its api_key in memory only. Such URLs
are never persisted, logged, sent in diagnostics or observations, or exposed to skins,
and errors must redact them. The private data-to-host transfer needed for header
authorization remains to be confirmed with Exact; it is not yet implemented.

Session updates use the adapter's stream when supported, including cursor resume and
snapshot fallback. A server without an event stream uses bounded, cancellable snapshot
polling while the session is active; it must not invent cursors or event semantics.
Appearance and distributed skins are optional server features; absence uses the local
built-in appearance rather than an invented remote endpoint. The concrete registry,
source signatures and polling cadence will be defined with the UI and adapter owners
before integration; these are intended boundaries, not implemented capabilities.

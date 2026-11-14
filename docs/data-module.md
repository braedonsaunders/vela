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

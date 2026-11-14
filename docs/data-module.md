# Data module status

The Ether adapter implements the v0 JSON endpoints used by discovery, authentication,
search, interactions and session snapshots. Credentials are supplied through an
interface backed by Exact secret storage. Contract sources use opt-in mock sign-in
when `VELA_MOCK=1`; password, web-code and quick-connect sources support real
sign-in. Set `API_BASE_URL` at build time to the Ether origin; the default is
`http://127.0.0.1:7777` for development. Fast, descriptive and AI searches use
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

A portable multi-origin deployment is blocked by the pinned Exact runtime. Its
`net.fetch` admission supports fixed origins, subdomain and scheme patterns,
and local-network grants, but no serving-page same-origin grant. Grants are
baked from `app.ts`; templating a page setting cannot change them. Ether must
serve the static artifact without an origin template until Exact provides a
same-origin grant bound to the trusted serving-page origin (including redirect
checks). The current build-time `API_BASE_URL` works for development and
per-origin builds only; a scheme-wide grant would violate Vela's boundary.

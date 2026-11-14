# Data module status

The Ether adapter implements the v0 JSON endpoints used by discovery, authentication,
search, interactions and session snapshots. Credentials are supplied through an
interface backed by Exact secret storage. Contract sources use opt-in mock sign-in
when `VELA_MOCK=1`; real sign-in UI is still needed. `API_BASE_URL` configures
the network grant and defaults to `http://127.0.0.1:7777`. Fast, descriptive and AI search use independent resources; AI jobs are
cancelled on replacement. Receipts are sent immediately; the bounded queue
exists but is not yet connected. Playback sources require integration verification.

Session events use Exact's HTTP `exactStream` resource under `net.fetch`. Each
connection reads a fresh authoritative snapshot (also refreshing credentials on
401), then resumes from the last observed cursor or the snapshot cursor. The
server supplies a snapshot on a retention gap. Unknown or malformed events fail
the resource so a retry starts with a new snapshot. The UI owns bounded retries
and releases the stream when playback leaves the view. End-to-end behavior still
requires the mock server and player to be exercised together.

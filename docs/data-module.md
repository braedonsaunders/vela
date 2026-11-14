# Data module status

The Ether adapter implements the v0 JSON endpoints used by discovery, authentication,
search, interactions and session snapshots. Credentials are supplied through an
interface backed by Exact secret storage. Contract sources use opt-in mock sign-in
when `VELA_MOCK=1`; real sign-in UI is still needed. `API_BASE_URL` configures
the network grant and defaults to `http://127.0.0.1:7777`. The UI currently
uses only fast search and sends receipts immediately; the bounded queue exists
but is not yet connected. Playback sources require integration verification.

Session events remain unimplemented. Exact supports HTTP SSE directly through a
resource returning `fetch` with `exactStream` under `net.fetch` (reference.md,
"An answer that keeps coming"). Its mapper receives parsed events and the host
closes the stream when the resource is released. The Contract still needs a
session-event resource and a shaped state; resume cursors, snapshot fallback,
reconnect and bearer refresh must be wired into that resource. Until then,
snapshots are the only available session-state read; they are not a live stream.

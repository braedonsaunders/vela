# Data module status

The Ether adapter implements the v0 JSON endpoints used by discovery, authentication,
search, interactions and session snapshots. Credentials are supplied through an
interface: Exact secret storage and Contract sources are not connected yet. The
adapter's origin and network grant must be configured together at build time.

Session events remain unimplemented. Exact supports HTTP SSE directly through a
resource returning `fetch` with `exactStream` under `net.fetch` (reference.md,
"An answer that keeps coming"). Its mapper receives parsed events and the host
closes the stream when the resource is released. The Contract still needs a
session-event resource and a shaped state; resume cursors, snapshot fallback,
reconnect and bearer refresh must be wired into that resource. Until then,
snapshots are the only available session-state read; they are not a live stream.

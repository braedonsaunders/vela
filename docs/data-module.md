# Data module status

The Ether adapter implements the v0 JSON endpoints used by discovery, authentication,
search, interactions and session snapshots. Credentials are supplied through an
interface: Exact secret storage and Contract sources are not connected yet. The
adapter's origin and network grant must be configured together at build time.

Session events remain unimplemented. Exact's `socket-ticket` recipe uses a synchronous
`fetch` with `exactStream`, but v0 specifies authenticated HTTP SSE rather than its
WebSocket ticket flow. The stream fixture also uses `exactStream` for HTTP bytes;
the SSE framing, reconnection, credential refresh and resource lifecycle still need
to be implemented and checked against the host. Until then, snapshots are the only
available session-state read; do not present them as a live event stream.

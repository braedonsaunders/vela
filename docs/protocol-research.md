# Protocol research and coordination

Status: research notes and candidate design directions, not a ratified wire specification. No protocol implementation exists in this repository yet.

The [proposed architecture](protocol-design.md) expands these principles into session behavior, a recovery walkthrough and the first end-to-end proof.

## Objective

Design an Ether-native protocol that enables fast discovery and resilient, high-quality playback. Distinguish the application/session contract from media transport and containers. Own the former; evaluate established HTTP media delivery and segment formats for the latter. Novelty is useful only when measurements show an improvement in reliability, efficiency or experience.

A compact metadata encoding alone cannot fix playback stalls. The whole system includes available representations, packaging, server read-ahead, upstream recovery, network scheduling, browser decode and buffering.

## Sources reviewed

- [Exact README](https://github.com/expo/exact): Contract interfaces, TypeScript/Rust data logic, DOM web output, native hosts, optional GPU module, unstable pre-1.0 APIs. Qualify actual media and dynamic-layout integration before selecting a design.
- [Jellyfin WebGPU plugin](https://github.com/alchemyyy/jellyfin-plugin-webgpu-player): separate player engine, downloadable decoder modules, tone mapping and audio downmixing; alpha status and device-specific limitations. The client should not depend on Jellyfin's protocol merely to use similar player ideas.
- [WebGPU Player engine](https://github.com/alchemyyy/WebGPU-Player): identified for deeper implementation and license review; not yet adopted or fully audited.
- [DASH-IF adaptive bitrate overview](https://dashif.org/dash.js/pages/usage/abr/): throughput, buffer-based selection, insufficient-buffer protection, abandoned requests, dropped frames and switch history.
- [Netflix buffer-based research](https://arxiv.org/abs/1401.2209): experiments showing that buffer-based selection can reduce rebuffering. Historical research, not a claim about Netflix's exact current algorithm.
- [Shaka network and buffering configuration](https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/network-and-buffering-config.md): different retry and buffering controls for different request types.
- [HLS RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216): timeline and discontinuity requirements across variants. A useful compatibility foundation, not a new Vela protocol specification.

Further review should include current client/server media-data signaling, modern HTTP delivery behavior, live gap recovery, browser resource limits, and real implementations of the target playback paths. No claim has been made that research is complete.

## Ether foundations inspected

Paths below belong to the separate Ether repository:

- `internal/app/frontend_experience.go`: shared search, ranked row sources, visibility, layout and interaction receipts.
- `internal/personalize/ranker.go`: feedback-driven ranking with guarded activation and bounded influence.
- `internal/personalize/homelayout.go`: automatic default ranking and owner layout policies.
- `internal/personalize/homelead.go`: cross-surface recommendation deduplication.
- `internal/core/neutral_home.go`, `internal/frontend/contracts.go`: protocol-neutral rows, context, entry types and interactions.
- `internal/collections/vibe_parse.go`, `internal/experience/vibe.go`: deterministic descriptive queries and viewer-scoped generated collection integration.
- `internal/app/frontend_identity.go`: local sign-in, device grants, refresh, revocation and quick-connect approval. Reuse these services through a new wire contract.
- `internal/transcode/session_swap.go`: input replacement, compatibility checks and preservation of published buffered media.
- `internal/transcode/recovery_buffer.go`: distinction between publication and delivery; replacement output readiness is not client decode confirmation.
- `internal/transcode/dash_session.go`: existing representation/segment machinery.
- `internal/playback/failover.go`: source selection and failover; raw direct responses cannot always continue across source replacements.
- `internal/livetv/proxy.go`, `internal/livetv/stream_sources.go`: upstream media handling and source-health/recovery foundations, identified for deeper review.

This is an implementation inventory, not an audit or proof of end-to-end behavior.

## Candidate protocol principles

- Explicit version and capability negotiation. Clients must tolerate optional capabilities being absent and compatible additive fields being introduced.
- Stable content/session identities, explicit source and seek generations, and idempotent state-changing operations.
- A small fast bootstrap and cacheable/paginated discovery data; expensive media engines and skins load outside the initial discovery critical path.
- Immediate deterministic search results; independently cancellable asynchronous AI work. Never wait on an LLM in normal browsing or playback requests.
- Server-ranked rows, scoped viewer state, and authentic interaction receipts rather than client-computed recommendation order.
- Separate ordinary state synchronization from media delivery; evaluate reconnectable events with cursors and snapshot fallback instead of repeated whole-page polling.
- Player observations include actual playable ranges, throughput, decode pressure and current generation. Server observations include source health and preparation state. Avoid conflating server publication, HTTP completion and client decode.
- Quality switches should use aligned playable boundaries. Source replacements additionally need content/edition and track identity checks.
- Preserve buffered media and avoid duplicate recovery actions. Cancel obsolete preparation on seeks, source changes and session termination.
- Bounded retries, deadlines, queue sizes and caches. Ensure concurrent viewers remain fair when preparing fallbacks.
- Keep all provider credentials server-side. Scope client access and keep skin execution separate from credential authority.

Wire encoding, transport choices, endpoint names, cache keys, buffer thresholds and event schemas are intentionally not selected yet. Compare candidates using realistic payloads and behavior before claiming efficiency.

## Server ownership and release handoff

Client interview thread: `thr_ifgifn4add`.
Ether orchestrator: `thr_daerp5pbp7`.

Owner explicitly instructed the client thread to hand off proactive fallback preparation for v0.3.11. The orchestrator replied:

> Recorded for v0.3.11 (not .10): proactive lower-bitrate fallback preparation while direct play continues, with your acceptance evidence and seam notes. I will coordinate the neutral server contract with this thread when that work starts.

The handoff included risk-triggered preparation, resource limits, generation-safe cancellation, timeline/edition/track alignment, truthful readiness and controlled failure scenarios. Server scheduling and implementation remain with the orchestrator. Do not modify its active release or independently schedule a competing server implementation.

## Verification to design

Use controlled media and network failures: falling/rising bandwidth, latency spikes, short disconnects, failed/truncated segments, upstream stalls, unavailable alternatives and encoder exhaustion. Exercise recovery during seeks and track changes as well as steady playback. Distinguish missing live content from a recoverable delivery gap.

Compare first-frame latency, total stall duration/count, recovery time, delivered quality, switch frequency, A/V continuity, memory, network bytes and server compute. Record exact browser, device, media and network conditions. Establish thresholds through qualification; no universal stall-free guarantee is possible.

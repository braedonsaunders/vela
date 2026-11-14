# Vela protocol: proposed architecture

Status: design proposal, not implemented and not a frozen wire specification. This document captures the architecture described during the owner interview. See [research and server coordination](protocol-research.md) for sources, inspected Ether code and ownership, and [the product spec](design.md) for accepted launch scope.

## One session through playback changes

A playback session identifies the content, viewer, position and track preferences independently of the current source, delivery format and quality. Compatible changes should preserve that session rather than presenting a new playback attempt to the viewer.

The proposed playback plan describes available playback paths, device compatibility, audio/subtitle tracks, chapters, available qualities, media availability, fallback preparation/readiness and safe switch boundaries. Field names and serialization are not selected yet.

Prefer original-quality playback. Repackaging without re-encoding is an available strategy when container compatibility or segmented delivery requires it; transcoding remains a fallback. These are distinct operations and should be reported distinctly.

Changing releases requires validating content identity, edition, timestamps, codecs and track mappings. Arbitrary direct-file byte streams cannot be spliced merely because they describe the same movie. If continuity cannot be established, use an explicit recovery path rather than pretending the replacement is seamless.

## Shared observations, local immediate decisions

The player reports actual playable ranges, playhead, download throughput, decoder pressure/dropped frames, selected tracks and current seek/source generation. Ether reports source health, cache/media availability, preparation progress, encoder readiness and compatible alternatives.

Keep the following states distinct:

1. The server has produced media.
2. The network transfer has completed.
3. The browser has accepted media into a playable buffer.
4. Playback has actually progressed through it.

These distinctions prevent false recovery confirmation. Determine practical observability for each browser backend; do not invent decode acknowledgments a backend cannot provide.

The player makes immediate buffering and quality choices locally within the negotiated plan. A server round trip must not be required for every adaptation decision. Server coordination adds information and prepares alternatives without becoming a synchronous dependency in the decoding loop. Telemetry is bounded and coalesced; cadence and event transport require measurement.

## Recover before the buffer empties

Illustrative scenario, not a benchmark or guaranteed threshold:

- An original stream requires approximately 25 Mbps and the connection drops to 6 Mbps.
- The player sees declining playable buffer and reports risk while continuing playback.
- Ether prepares an appropriate sustainable fallback if the owner resource budget and media source allow it.
- The server advertises actual readiness and a compatible timeline boundary.
- The player obtains playable replacement media and transitions while preserving useful buffered footage, position and track preferences.
- Quality increases conservatively after sustained recovery, avoiding repeated oscillation.

The player can abandon an obsolete or too-slow download when a better recovery path is available. Account for variable segment size, encoder startup, decode compatibility and upstream availability rather than treating nominal bitrate as a guarantee.

Proactive fallback preparation is recorded with the Ether orchestrator for **v0.3.11**, outside v0.3.10. Preparation must respect compute, cache and concurrency limits, yield to active playback, and stop when obsolete. If the server cannot prepare a fallback, the client must receive an honest capability/state result.

## Recovery and synchronization semantics

Use stable session identity plus explicit seek/source generations. Reject stale commands and replies and cancel superseded work. Retried state-changing commands must not create duplicate sessions, encoders or recovery actions; exact idempotency and revision rules remain to be specified.

Reconnectable events should carry cursors/revisions. When retained history is insufficient, return a current snapshot so the client can resume from authoritative state. A reconnect must not restart otherwise healthy media playback unnecessarily.

Classify connection, source and decoder failures separately. Apply bounded retries and deadlines appropriate to the failure; repeated retries of permanently corrupt media are not recovery. Preserve watch progress and track preferences through recoverable transitions.

Live TV uses bounded adaptive buffering, upstream recovery and controlled catch-up toward live. Low-delay mode changes that tradeoff. Do not confuse an upstream interval that never existed with a delayed segment that can still be obtained. Buffer targets, allowable gaps and catch-up behavior require qualification.

## Discovery and search

A compact bootstrap returns enough information to render the first useful home view. Use stable identities, pagination, cache validation and incremental updates to avoid retransmitting unchanged metadata. Load artwork and the heavy playback engine independently of the initial metadata path. Scope caches to the authenticated viewer and policy context.

Ether owns recommendation ordering and owner layout policy. Vela reports actual visible impressions and selections through the server's interaction contract; prefetching or rendering offscreen is not a viewed impression.

Search has independent fast catalogue/descriptive results and optional asynchronous AI results. Query generations and cancellation prevent stale results from replacing newer searches. AI must not block home rendering, ordinary search or playback.

## Application contract and media delivery

Vela owns a versioned application/session contract: discovery, capabilities, identity integration, viewer state, interaction reporting and recovery coordination. Proven HTTP media delivery, containers and segment formats remain candidates underneath it. Evaluate timeline/discontinuity rules and browser support before choosing the media paths.

JSON versus binary encoding, event transport, endpoint names and precise wire schemas are unresolved. Compare realistic payloads, cache behavior, reconnect costs and implementation complexity before asserting an efficiency advantage. Supporting future server adapters must not force Ether to copy another server's wire protocol.

Skin packages control presentation. Credentials, permissions, session state and recovery logic belong to shared services and the playback engine, not arbitrary skin logic. Skin execution and asset isolation still require design and validation.

## First end-to-end proof

Demonstrate a real browser playback session through both bandwidth collapse and upstream failure, preserving position, audio and subtitles through compatible recovery. Include seeks, unavailable fallbacks and capacity exhaustion so failure handling is also exercised.

Measure startup time, stalled seconds/count, recovery time, delivered quality, switch frequency, A/V continuity, client memory/network use and server compute/cache use. Record media, device, browser and network conditions. Establish comparison baselines against existing clients before claiming superiority. Numeric acceptance thresholds and the qualification matrix are still to be set.

No protocol can guarantee uninterrupted playback when all usable media and buffered content are unavailable. The goal is to anticipate and absorb recoverable problems and expose the remaining failures accurately.

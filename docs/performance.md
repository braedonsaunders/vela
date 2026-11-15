# Local performance baseline

Measured 2026-11-13/14 on a 24 GB Mac, macOS 26.6.2, Chrome 157.0.8103.51, using the Exact development web host and Bun mock on loopback (app :8765, mock :7777). This is a local, unthrottled development build, not a production release, remote Ether or a formal acceptance threshold. Other applications were running. Chrome was driven in an isolated Playwright session; values are single-run observations unless noted.

- **First useful home:** a fresh isolated session showed the first named home row 102 ms after navigation (DOM MutationObserver; not a screenshot or paint measurement). By observation completion there were 46 `/vela/v0/` requests: sign-in 1, capabilities 4, negotiate 1, bootstrap 2, and 38 artwork requests. Some image requests can begin in the interval between the row appearing and the observer being read; this is not a precise count at the instant of paint.
- **Bootstrap:** 92,616 raw bytes for the observed browser response; gzip in-browser estimate 10,087 bytes. The mock response had no Content-Encoding, so the 10,087 bytes are not measured network transfer. Another fresh session returned 92,268 bytes (session-specific grants vary). A direct same-session ETag check returned 200 with ETag, followed by 304 with zero body bytes; the app trace also showed a 200 followed by 304. This tests revalidation, not persistence of the in-memory ETag across a browser reload.
- **Search:** 30 sequential local title queries; input fill to the matching `Title matches` DOM becoming visible, median 11 ms and nearest-rank p95 17 ms (range 9–23 ms). This includes Playwright driving overhead, and the loopback mock has no real server or internet latency. Descriptive search was enabled; the mock advertised AI unavailable.
- **AI independence:** with temporary browser-only interception advertising AI and holding its synthetic job response for 2,000 ms, title matches rendered in 77 ms while the AI request was still pending. This demonstrates lane independence for that simulated delay; it does not measure an actual AI service or its production resource contention.
- **JavaScript:** development `app.js` 565,866 bytes and native player `modules/index.js` 56,569 bytes, raw (gzip estimates 96,489 and 14,150 bytes respectively). These are two individual assets, not the full application transfer: the development host loads additional runtime chunks and dev tooling. Production release sizes can differ.
- **Five minutes browsing:** 25 alternating search/scroll interactions over 301 seconds in one Chrome tab. `performance.memory.usedJSHeapSize` was 18,356,759 bytes at start and 12,738,686 bytes at end; `totalJSHeapSize` was 31,234,435 and 17,601,242 bytes. These are GC-dependent JavaScript heap snapshots, not total renderer, GPU, process, or system memory; they do not establish a leak bound.

## Findings

The initial run exposed a reactive bootstrap timestamp that produced over 14,000 revalidations within seconds. That run was stopped and excluded; UI commit `456c0df` captured a stable request timestamp. In the clean search run, 30 queries produced roughly 30 extra capability revalidations in addition to fast and descriptive searches. The data module now reuses the latest authenticated bootstrap capability snapshot instead of fetching capabilities for each search; a post-change browser count was interrupted when the measurement session closed, so the reduction has not yet been remeasured. Startup still showed duplicate capability and bootstrap revalidations and eagerly requested many artwork images; further profiling should distinguish concurrent initial calls and viewport loading before changing policy.

## Skin documents

Measured on an M4 Pro in Chrome at 1440×900 with the release build of the doc engine against compiled Cinematic, using the
same mock and the same script (scroll, hover 10 cards, open a title, sections). These figures set the document budgets in
`client/src/skin/budget.ts`.

Cold scroll means the first pass down the home page, where rows mount as they arrive; warm scroll is a later pass over
the same rows.

| | Doc engine (51228f0) | Compiled Cinematic |
| --- | --- | --- |
| Cold scroll | 83 fps | 101 fps |
| Warm scroll | 112–118 fps | 110 fps |
| Hover | 114–121 fps, no long tasks | 120 fps |
| Load script | 0.76 s | 0.30 s |
| Heap on home | 68 MB | 20 MB |
| Card | 13 elements, ~8 nodes | 3 elements |

What a document page costs is the nodes it mounts. A repeated item, such as a card, is mounted about 20 at a time as a
row arrives, and the cold-scroll cost is linear in its nodes. An endless animation or a blur inside a card exists once
per card, and every blur is an offscreen pass over its area on every frame. `bun tools/skin.ts check <document>` prints
these costs per page. The resolver refuses a document over a limit.

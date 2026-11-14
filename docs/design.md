# Vela product specification

Status: accepted product decisions from the owner interview, with unresolved engineering decisions explicitly identified below. This is not evidence of implemented or verified behavior.

## Product and delivery

- Product name: **Vela**. Repository: **vela**. Ether Apps card: **Vela**.
- Separate source repository from Ether; Ether serves the client build and implements the server protocol.
- Integrate through Ether's existing Apps architecture: a protocol card with configuration and enable/disable controls, like its other apps.
- Launch on desktop and mobile browsers, installable as a PWA. Native applications follow.
- The serving Ether instance is already known. Standalone hosting and an Add Server flow are outside the launch scope.
- Ether is the only server implementation at launch. Define an adapter boundary for future servers without adopting Plex's or Jellyfin's wire protocol.
- Use Expo Exact. Pin and qualify a specific revision; upstream describes itself as pre-1.0 without API stability.
- Owner chose Vela after being informed that other media players use the name. Naming is settled for this project.

## Official appearance

Cinematic restraint with fluid transitions and an expressive search centerpiece. Near-black surfaces, prominent imagery, warm white typography, restrained translucent treatment around search, and accents informed by the featured artwork are the design direction. The precise typography, spacing, colors and motion curves require a visual prototype.

The first viewport has a cinematic upper region, a beautiful rounded search box centered in the composition, and the beginning of the recommendation rows below it. The first visible recommendations must be useful immediately. Layout adapts to mobile keyboards and small screens rather than reproducing desktop dimensions.

The hero features a personalized title. Artwork appears immediately; a muted trailer may play when it is cached and ready. Do not delay the home or search for trailer resolution. Pause the trailer while searching and when the hero is offscreen. Respect reduced motion, autoplay limits and constrained devices. Trailer-cache policy, byte limits, allowed sources, expiry and production ownership still need engineering definition. Reuse Ether's extras machinery where appropriate; YouTube embeds or downloads are not yet a selected architecture.

## Search and details

- The home transforms around search rather than navigating immediately to an unrelated search page.
- Fast ordinary title matches appear beneath the centered box while typing.
- Support Ether's existing descriptive/vibe search and generated collections.
- When the owner has configured AI, support richer natural-language discovery and follow-up refinement into browsable collections. AI runs separately and never gates ordinary title results, home rendering or playback.
- Define cancellation and query generations so late results cannot overwrite a newer query. Exact trigger/debounce timings and the asynchronous AI contract remain engineering work.
- A title opens into an immersive detail surface over the current view. Mobile uses a full-screen sheet.
- Details have their own shareable URLs and normal history semantics. Back restores the exact query, scroll position and focused card.
- Show real server metadata and capabilities. Episodes, seasons and shows retain distinct identities and playback semantics.

## Automatic home and personalization

Ether already owns this engine. Vela displays the automatic feed, including its ordered rows and titles, and honors existing owner Home Designer rules. Do not create a second client ranker or a viewer row-layout editor at launch.

Relevant existing capabilities include viewer taste, contextual ranking, feedback-driven learned ranking, discovery diversity and cross-surface deduplication. These capabilities are foundations, not a guarantee that every recommendation will appeal to every viewer.

The new protocol must preserve ranking, stable row/item identities, interaction receipts and appropriate visibility reporting. Report what actually becomes visible or is selected; do not treat prefetching as viewing. Coordinate playback attribution with the server's existing feedback path. Hidden tabs, recycled cards and skin transitions must not inflate impressions.

Skins can radically change presentation while preserving the meaning and order of the server's personalized content and the integrity of interaction reporting.

## Content at launch

Movies, TV shows, seasons/episodes, trailers, extras, live television and a channel guide. Keep the protocol extensible for future content types. Music is not part of the first release.

All presentation paths must preserve Ether's viewer restrictions and availability rules, including artwork, search, recommendations, guide data, deep links and playback. Reuse server policy rather than reimplementing its decisions in the browser.

## Playback

Launch includes in-browser streaming, fullscreen, picture-in-picture where the platform and playback path support it, subtitle and audio-track selection, and resume. Casting/AirPlay integration and offline downloads follow later. Installing a PWA does not imply offline media support.

Prefer direct playback, try compatible sources, and allow server transcoding as the last resort. WebGPU is useful for rendering and processing; actual decode capability must be established using WebCodecs and/or qualified decoder modules. Do not equate WebGPU availability with universal real-time decoding. Keep a platform-appropriate playback path where WebGPU is unavailable or unsuitable.

Research the independent WebGPU Player used by the Jellyfin plugin, particularly modular decoding, tone mapping, multichannel audio handling and separation of playback engine from UI. Dependency use or code adaptation requires reviewing its license and suitability; no reuse decision has been made.

Playback resilience is a first-class requirement. The server and player should cooperate on measured throughput, playable buffer, decoding pressure, source health, fallback preparation and timeline-safe handoff. Quality should decrease before a stall when feasible and recover conservatively when conditions improve. Preserve session identity, position and track preferences across compatible changes.

Source changes are not automatically seamless: different cuts, timestamps, codecs or audio/subtitle layouts require validation. Never silently substitute a different edition to conceal failure.

### Proactive fallback

Owner approved preparing a lower-bitrate fallback when risk rises while direct playback continues, within owner-controlled compute/cache/concurrency limits. This server feature belongs to the Ether orchestrator and is scheduled for **v0.3.11**, explicitly outside the current v0.3.10 release.

The orchestrator acknowledged recording the feature and will coordinate the neutral server contract with this client thread. The wire schema remains unsettled. Capability negotiation must let Vela operate honestly when the feature is unavailable.

### Live television

Adaptive resilience is the default: start promptly, then build more buffer when the source or connection is unstable. Offer an explicit low-delay mode. Bound buffer and live-edge drift; use clear recovery states when uninterrupted delivery is impossible. Exact buffer targets and catch-up policy require measurement.

## Deep skinning

- Skinning encompasses layout, typography, colors, imagery, component shapes, motion and navigation presentation, not merely color themes.
- The official cinematic skin uses the same supported skin system available to other authors.
- Launch skins are installable packages authored in code, with documentation and examples. A visual editor follows later.
- The server chooses the default skin. Every viewer can select the official skin or another installed skin.
- Search, playback, identity, accessibility semantics, permissions and recommendation feedback are shared foundations.
- Skin format, validation, versioning, execution isolation, asset loading, update/rollback and failure recovery require technical design. Code-authored packages do not yet imply permission for arbitrary third-party JavaScript in the authenticated client origin.
- Resolve how Exact compiles and loads layouts before committing to a runtime skin API. Prototype substantially different layouts to prove the promise.

## Quality and verification

The ambition is a visibly better and more resilient experience than existing media-server clients. Demonstrate this with measurements rather than branding claims.

Define a named browser/device matrix, reproducible network traces and representative codec/content fixtures. Measure startup, search latency, scroll/input responsiveness, stalled time, recovery duration, quality changes, A/V sync, memory and server resource use. Include small mobile viewports, keyboard/screen-reader navigation, reduced motion, failed skins, disconnected sessions and damaged/slow media.

Exact's published runtime budgets are not Vela's measured performance. Set Vela's numeric acceptance thresholds after initial baselines and make the test conditions explicit. Keep local checks focused; coordinate server-wide release gates with the orchestrator.

## Engineering decisions still to resolve

1. Exact revision, PWA/service-worker packaging and external media surface integration.
2. Supported browser/device/codec matrix, subtitle rendering and PiP behavior for each playback backend.
3. Skin package contract and isolation with genuinely replaceable layouts.
4. Versioned server/client protocol, event recovery, cache validation, capability discovery and authentication mapping to Ether's existing identity services.
5. Quality preparation and handoff contracts with the v0.3.11 server work.
6. Trailer cache policy and personalized hero selection through shared server services.
7. Concrete layout prototype, performance budgets and a coherent translated-copy strategy.
8. Distribution versioning between a separately released Vela build and compatible Ether servers.

These are research/prototype decisions, not permission to assume unverified guarantees or silently broaden launch scope.

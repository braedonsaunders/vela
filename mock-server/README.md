# Vela mock Ether

From repository root, put `.tools/bun-darwin-aarch64` first on PATH.
Install once: `cd mock-server && bun install`. Start from root:
`bun run mock-server/main.ts` (127.0.0.1:7777). Override `PORT` and
`DEV_ORIGIN` (default http://localhost:3000) as needed. Loopback only; admin is unauthenticated dev tooling.

Sign in: POST `/vela/v0/auth/sign-in`, JSON
`{"idempotencyKey":"login-1","username":"demo","password":"vela","device":{"id":"vela-dev","name":"Browser","platform":"web","appVersion":"0.1"}}`.
Use returned bearer plus `X-Vela-Device-Id: vela-dev` on authenticated API calls.
Optional `VELA_MOCK_TOKEN=dev-token` seeds that fixed bearer/device for development.
For device/quick-connect pairing, approve the displayed code using an already
signed-in grant. Poll every three seconds; pairing expires after ten minutes.
POST `/__admin/web-code` issues a single-use sixty-second console handoff code.

API and caching follow [v0](../protocol/v0/README.md). All state is in memory;
restarts invalidate credentials, cursors, receipts and sessions. The fixtures are
fictional titles and synthetic SVG artwork; no copyrighted images are fetched.
Descriptive search uses text/genre matching. AI and proactive preparation are
unavailable. Live channels/guide are metadata fixtures; starting live playback
returns source/live_fixture_unavailable rather than presenting VOD as live.

Generate media once: `bun mock-server/scripts/make-media.ts` (requires ffmpeg).
Output: `~/.scratch/tmp/vela/media/`, synthetic sixty-second H.264/AAC direct MP4,
three aligned four-second fMP4 HLS qualities, two tone audio tracks and WebVTT.
Each Quality URL is a complete muxed A/V media playlist, suitable for MSE.
Native HLS master includes alternate audio groups. Generated files are scratch;
regenerate if aged out. Plan and media remain unavailable until generation finishes.
Movie metadata describes fictional full-length titles; all playback is explicitly
this sixty-second test fixture. Remux copies the original 720p video; transcode
alternatives are generated offline. No actual on-demand encoder scheduler exists.

GET/POST `/__admin/faults` reads/patches:

```json
{"bandwidthBps":0,"failEvery":0,"truncateEvery":0,"stallMs":0,"fallbackUnavailable":false,"capacityExhausted":false}
```

Zero disables each numeric fault. Bandwidth applies per response (bits/s).
failEvery/truncateEvery affect every Nth requested CMAF media segment globally;
failed segments return 502; truncated bodies abort after half the advertised bytes.
stallMs delays first media bytes (capped sixty seconds). Query overrides of the
four numeric fields also work on media URLs. Faults snapshot per request.
Capacity blocks new playback and transcode switch attempts. Unavailable fallback
removes transcode offers from new plans and rejects switches on existing plans.
These are controlled faults, not a production resource or network simulator.
Reset by POSTing the all-zero/false object. Media uses the broker path
`/sessions/media/<session>/<token>/...` with byte ranges and session grants.

Only routine check: `cd mock-server && bun x tsc --noEmit`.

Initial API track selection and in-session track mutation are advertised unavailable
in this mock: native HLS alternate-audio selection and the external WebVTT are
real, but the mock cannot reconfigure an active muxed MSE source. Unsupported track
commands return policy/feature_unavailable rather than only changing metadata.
SSE replacement, revocation, session end and disconnect release heartbeat timers;
streams also close when their bearer grant expires.

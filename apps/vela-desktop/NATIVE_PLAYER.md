# Desktop native player bridge v1

Electron main loads `./mac/host.js` on Darwin or `./linux/host.js` on Linux.
The module exports synchronous `available(): boolean`, async
`capabilities(): Promise<PlayerCapabilities>` and async
`create({ window, emit }): Promise<Host>`. `window` is the BrowserWindow;
`emit(event, value)` delivers player events. No host is advertised unless its
binary and dependencies are available. The renderer retains the browser engine.

Host methods (may return promises):
- `update(props)`: JSON subset of VelaPlayerProps: plan, command, active,
  metadata, serverError. All wire models are packages/player-api. Commands have
  monotonically consumed ids; session generations must never regress.
- `setAccess({origin, pathPrefix, headers})`: immutable media grant, or null to
  revoke. Replacing/revoking stops old requests before accepting new props.
  Resolve relative URLs against origin. Never forward credentials outside the
  exact origin and path boundary, including redirects or secondary requests.
- `setBounds({x,y,width,height,scaleFactor})`: player rectangle in Electron
  content coordinates, DIP, top-left origin. Zero size hides the surface.
- `destroy()`: idempotent stop, release surface, credentials, timers, children.

Host emits `snapshot`, `observation`, `session-command`, `session-refresh`,
`command`, `error` with the same payload as corresponding VelaPlayerProps callback.
`fallback` means native cannot continue: release native surface and allow browser
playback of latest props. Never include URLs/headers in diagnostics or errors.
Snapshot normalization currently uses src/windows/snapshot.ts. Recovery must be
bounded per session, prefer server paths as Apple PathRecovery does; live stays
at rate 1.0 with no automatic catch-up. Do not claim unsupported HDR/Atmos.

Preload exposes `window.__VELA_NATIVE_PLAYER__ = {version:1, postMessage,
addEventListener, removeEventListener}` only when host available. Renderer uses
messages matching the Windows adapter: capabilities/requestId, media-access,
mount/id/props, update/id/props, dispose/id; plus bounds/id/bounds. Main replies
capabilities/requestId/value or event/id/event/value. Only trusted main frame of
vela-app://app/vela may invoke it. One mounted player per BrowserWindow; stale
ids are ignored. Events must not escape after disposal.

Main owns transparent BrowserWindow creation (required before first show),
background switching, lifecycle, host teardown and fullscreen window behavior.
Renderer clears player ancestors only while native mounted and restores them on
dispose/fallback. Renderer owns DOM fullscreen and reports rectangle changes on
resize, scroll, ResizeObserver and fullscreen changes. Native views must remain
below web content, accept no input, and follow bounds/fullscreen/backing scale.

Ownership: shared main.js/preload.js/build.mjs/package.json and renderer bridge:
macOS/Electron agent. Linux agent owns linux/** and its packaging helper; send
required build hook changes to shared owner. Native addon is preferred on macOS
because an in-process NSView can be ordered below Electron's web contents
without cross-process window compositing.

## Apple authorized HLS attachment

`setAccess` includes monotonically increasing `generation`. Renderer waits for
headers and calls the current adapter's `nativeURL` for header-dependent HLS.
Private update props include `mediaAuthorization: {planId,generation,ok}` and,
when prepared, `nativeMedia: {planId,source,authorized,generation}`. `planId` is
`sessionId:sourceGeneration:seekGeneration:revision:selectedPathId`, identical to
Apple mediaIdentity. Host validates all fields against current plan and grant,
then calls the shared media store's attach before applying authorization and
plan. A stale/mismatched attachment is refused; failed preparation uses the
Apple bounded recovery path. Attachment URLs never enter diagnostics/events.

macOS distribution targets Apple silicon (arm64) only. Native builds and
Electron packages must use arm64; Linux continues to target x64.

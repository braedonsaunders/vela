# Native SDR with unknown container colour

`CoreVideoPresenter.prepare` admits native non-HDR VideoFrames when the
container omits primaries or matrix. The browser owns their external-texture
conversion. Vela supplies no invented BT.709 metadata.

At the pinned WebGPU player revision
`a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2`, `startSession` resets the external
identity chain to `metadata:null`; `seek` retains colour configuration and the
public `configureColorPipeline` API requires source metadata. The unknown-colour
route therefore calls `startSession(epoch)` on every prepare, including seek and
presenter reuse, before attaching the surface and preparing stream dimensions.
This retains the component's reusable device resources while clearing previous
HDR/frame-pool state. Existing epoch and abort checks reject superseded prepares.
Known HDR and raw GPU frames retain the qualified primaries/matrix gate and HDR
authorization. Rotation and interlacing admission are unchanged.

## Local evidence (2026-11-15)

The scoped core asset build used `tools/player/prepare-upstream.ts --core` under
the shared build lock, with verified reusable asset input
`core3374cb5b3bf41329`. The resulting private payload key was
`69774fd0f7a9a5bc`; no all-skins build or upstream checks ran.

A local FFmpeg-generated H.264 baseline 640x360/24 SDR test pattern supplied
16 seconds of fMP4 HLS in two-second segments. FFprobe reported no primaries,
transfer or matrix tags. The temporary server omitted ENDLIST and supplied exact
`X-Ether-Live-Media-Sequence: 0` and `X-Ether-Live-Window-Start: 0` headers.
The actual core track had `color:{fullRange:false}` throughout.

Installed headed Chrome drove the real Vela core, native WebCodecs decoder and
WebGPU presenter. At 11.65 seconds it had decoded 288 frames and presented 280,
with zero drops. Seeking back to 8 seconds completed in 17.055 ms; playback then
advanced to 9.90 seconds, 342 decoded / 326 presented frames, with no failures or
drops. One screenshot visually showed the generated pattern at 9.417 seconds.
The runtime reported a live window 0–16 seconds, delivery available, no retries.

This proves admission and seek for this generated native SDR case, not HDR
qualification, colour calibration, long-running live publication or playback of
any external channel. No lab stream was accessed. The fixture server and owned
browser were stopped; runtime disposal removed every canvas. Generated media and
payload were temporary scratch output, not repository assets.

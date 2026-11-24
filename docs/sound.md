# Sound: AutoMix, loudness levelling and the equalizer

The audio app's Sound settings: AutoMix (crossfades between songs), volume levelling from Ether's
loudness measurements, and a ten-band equalizer. This page is the engine plan; stage 1 built the
settings, the decisions and the contract, and no engine applies them yet.

## What exists (stage 1)

| Part | Where |
| --- | --- |
| Settings, presets and every decision, all pure and tested | `packages/core/src/audio/sound.ts`, `packages/core/test/audio-sound.test.ts` |
| Settings in the store (`audio.sound`, `store.audio.setSound`), kept across sign-in and stop | `packages/core/src/store/audio.ts` |
| Saved per device (`vela.pref.sound`: localStorage on the web, beside the Keychain/Keystore secrets natively) | `apps/vela/src/media/audio.tsx` |
| The panel as self-contained rich blocks: `SoundBlock` (the whole panel) and `EqBlock` (the bands). Drawn beside the page in the wide audio app (the bar's Sound button) and as Now Playing's Sound tab on phones, TVs and full screen | `packages/skin/src/blocks/sound/` |
| Wire contract (`features.loudness`, `TitleMedia.loudness`/`bpm`, `PlaybackPlan.loudness`) | `packages/protocol/types.ts`, protocol README "Loudness and AutoMix markers" |
| Mock: loudness on every fixture track (some measured with album gain and fades, every fourth album hinted or unmeasured) | `packages/protocol/fixtures/media.ts`, `mock-server/main.ts` |

Following the experiences design (docs/experiences.md on `plugin-screens/main`), the engine and decisions live in core, and the UI is a rich block that imports nothing from `widgets/music`. When the Listen documents replace `widgets/music`, they draw `SoundBlock` and `EqBlock` unchanged. The only caller-specific input is `tv` (remote focus: − and + instead of sliders).

Settings belong to the device, not the account: the right EQ for headphones is wrong for a TV's
speakers. Defaults: AutoMix off (Smart length, albums kept gapless), levelling Smart with 0 dB
pre-amp and clipping protection, EQ off (Flat).

## The decisions (shared by every engine)

All of these are pure functions, so each platform gets the same answer.

- **Gain**: `levellingGain(loudness, settings.levelling, { albumInOrder })`.
  - Smart uses the album gain while an album plays in order (`albumInOrder`: the queue's source is the track's album, unshuffled) and the track gain otherwise.
  - Album mode falls back to the track gain until Ether has measured the whole album.
  - Pre-amp adds −6 to +6 dB. Clipping protection caps the gain at `−20·log10(peak)`.
  - A provider hint has no peak, so it is not capped.
  - Unmeasured tracks get no gain (unity).
- **Which loudness**: `PlaybackPlan.loudness` (measured on the exact file the plan plays) wins; the card's `media.loudness` is used only until a plan arrives, and by the panel.
- **Transition**: `transitionBetween(from, to, settings.automix)` returns `gapless` or `{ crossfade, seconds, at, nextFrom }`.
  - Gapless when AutoMix is off, for spoken word, and between consecutive tracks of one album (by default, including disc changes).
  - Smart length is the outgoing song's own fade-out (`trim.endMs − trim.fadeOutStartMs`). It is held to whole bars when `media.bpm` is known, falls back to 6 s, and is clamped to 2–12 s and to a third of either song.
  - Below 2 s it stays gapless.
  - `at` is when the incoming song starts, measured on the outgoing song's clock: its audible end (`trim.endMs`) minus the length. `nextFrom` skips the incoming song's leading silence (`trim.startMs`).
- **EQ**: ten peaking bands at 31 Hz to 16 kHz (low shelf at 31 Hz, high shelf at 16 kHz), ±12 dB, Q ≈ 1.41 (one octave). The curve drawn in the panel is the target response. Every engine computes the same RBJ-cookbook biquad coefficients; on native these become a small pure module beside `sound.ts` with tests.
- **Headroom**: an EQ boost can clip what levelling left at full scale. With the EQ on, the engine lowers the signal by the largest positive band gain before the filters ("auto pre-gain", as most players do). No compressor or limiter sits in the chain.

## The engine contract (stage 2)

`AudioEngine` grows two optional members. An engine without them plays exactly as today: unity gain, no EQ, gapless.

```ts
/** The playing item's gain (linear) and the EQ; applied with a short ramp, never a click. */
setSound?(sound: { gain: number; eq: { on: boolean; bands: number[] } }): void;
/** preload gains what the handover needs. */
interface AudioPreload { url: string; startSeconds: number; gain?: number; transition?: Transition }
```

The store already asks for the next plan up to 20 s before the end (`preloadLead`); that covers the longest crossfade (12 s).

With the next plan in hand, the store:

1. computes the next item's gain from `plan.loudness`, and the transition from both items' loudness;
2. hands both to the engine with `preload`.

The engine performs the crossfade on its own clock, not on a JavaScript timer, so it still lands on time with the screen off or the tab in the background. Once the incoming song is audible the engine emits `advanced`, and Now Playing, the media session and the queue all follow it.

AutoMix needs `features.queuedPlayback`. While songs overlap, two Ether sessions play at once. A server without queued sessions ends the playing one when the next is asked for, so there AutoMix stays gapless.

How the overlap works on Ether (agreed with the Ether music lead, 2026-11-24; Ether change pending):

- When a queued successor takes over, Ether records the outgoing item as played through, once. Vela doesn't mark it played.
- The outgoing session stays alive for up to 15 s after takeover: its byte reads keep serving, and its progress and stop are accepted. It retires at Vela's stop or at 15 s, whichever comes first. It no longer owns the device and doesn't count as a second stream.
- Vela stops it at the fade point and reports the real position.
- Ether advertises the grace as `features.queuedPlayback.handoverSeconds` (proposed). Vela crossfades only when it is present, or when the outgoing tail is already fully buffered; otherwise it stays gapless. Today's Ether interrupts the outgoing session's reads at takeover.

### Beat alignment

- **Web**: the gapless player decodes PCM itself, so the next track's first seconds and the current track's last seconds are already in memory.
  - A small onset detector runs on a decimated (≈11 kHz mono) envelope: spectral flux on 1024-sample frames, then autocorrelation over 60–200 BPM.
  - It finds both tempos and beat phases, then moves `at` by under one beat so the outgoing downbeat meets the incoming first beat. `nextFrom` moves to the incoming first beat.
  - Cost is a few milliseconds per track, done once per transition, never ahead for the library.
  - With low confidence, it falls back to the native rule below.
- **Native**: neither AVQueuePlayer nor ExoPlayer exposes PCM before it plays. Ether can't compute beats without a second decode, so there is no measured beat grid in the contract.
  - Lengths are held to whole bars when the provider's `media.bpm` is known, with no phase alignment.
  - Otherwise the fade markers set the length.
  - Phase alignment on native is a later option (an AVAudioEngine player, below).

## Web (and the desktop hosts)

Electron (`apps/vela-desktop`) and WebView2 (`apps/vela-windows`) run the web build, so this covers them too.

```
item A: decoded chunks → GainNode(levelling × crossfade envelope) ┐
item B: decoded chunks → GainNode(levelling × crossfade envelope) ┴→ pre-gain → 10 × BiquadFilterNode → volume GainNode → destination
```

- **Gapless player** (`modules/vela-player/web/gapless/player.ts`): it already schedules every chunk on one AudioContext clock and connects them to one output gain.
  - Each item gets its own `GainNode` (levelling), feeding a shared EQ chain before today's volume node. `BiquadFilterNode` gives the peaking and shelf filters natively.
  - A crossfade schedules the next item's first chunk at `at` instead of at the current item's scheduled end. Both item gains then get an equal-power `setValueCurveAtTime` over `seconds`.
  - Two decode streams run together only during the overlap.
  - Gapless album playback is unchanged: same scheduling, unity envelope.
- **`<audio>` path** (speed ≠ 1, HLS, codecs the page can't decode): `MediaElementAudioSourceNode` into the same graph.
  - A cross-origin element without CORS plays silence once routed through Web Audio. Ether's media URLs on the web build are same-origin or CORS-enabled; for any that aren't, the engine leaves the element out of the graph.
  - Outside the graph, levelling falls back to `element.volume`, which can only turn down. There is no EQ on that path, and the panel says so.
  - A crossfade on this path ramps two elements' volumes from the engine's own clock.
  - Spoken word at speed keeps `preservesPitch` through the graph.
- **Keep-alive**: the silent media element that holds the browser's media controls is unaffected.

## Android (Media3 ExoPlayer)

```
decoder → [VelaSoundProcessor: gain + 10 biquads] → Sonic (speed) → AudioTrack
```

- **Gain and EQ**: a custom `AudioProcessor` added to `DefaultAudioSink`'s processor chain, built in `AudioPlayback.kt`'s renderers factory.
  - It processes 16-bit and float PCM at the file's own rate (hi-res stays hi-res) and runs before Sonic, so speed doesn't change the EQ.
  - I chose our own biquads over `android.media.audiofx.Equalizer`: that one has device-dependent band counts (often five) and curves, so the presets would sound different on every phone.
- **Per-item gain across a gapless boundary**: Media3's renderer moves the sink to the next item's stream offset between the last buffer of one item and the first of the next, and the sink drains and flushes its processors there. `VelaSoundSink` passes that change on, and the processor switches gain at the flush, on the item's first sample, with no ramp and no timing guess (measured: on the boundary sample).
- **Gain and EQ changes** glide over 10 ms.
- **Crossfade**: one ExoPlayer plays one item at a time, so AutoMix uses a second player (a "deck"), prepared paused with the preloaded item.
  - The outgoing deck's processor fades its own samples out from `at`, so the fade-out is sample-exact. The incoming deck's processor fades in from its item's first sample.
  - The only timed step is the incoming deck's `play()`. It is posted on the main thread against the outgoing sink's heard position (ExoPlayer's `currentPosition` is only as fresh as the playback thread's last update), early by a start lead learned from each crossfade: a prepared player takes 70–90 ms to its first heard sample. Measured start error on the emulator: −8 to +15 ms.
  - The incoming deck becomes the active player at once (`advanced`, status, the media session). The outgoing one keeps the audio focus while it fades, then stops as the spare deck.
  - Gapless album runs stay in one player's playlist, exactly as before.
  - Everything happens in the service, without JavaScript, so it survives screen-off.
- **Measurement**: a debuggable build's `audioCapture(path)` writes each deck's processed output to a WAV (and sends silence to the device), for `tools/sound-measure/analyse.ts`.

## Apple (iOS, iPadOS, tvOS: AVQueuePlayer)

Music uses the module's `AudioPlayback.swift` (AVQueuePlayer); AetherEngine is the video engine and isn't involved.

- **Gain and EQ**: an `MTAudioProcessingTap` on each `AVPlayerItem`'s `audioMix`.
  - The tap applies the item's gain and the ten biquads (`vDSP_biquad`) to the PCM AVPlayer decodes.
  - Because the tap belongs to the item, gain and EQ are exact across a gapless boundary, with no timing guess.
  - `AVMutableAudioMixInputParameters.setVolume` alone can't do it: it can't go above 1.0 (unity), so it can't raise a quiet song.
  - Taps work for the progressive files music plays (FLAC, ALAC, AAC, MP3, WAV); HLS isn't used for music.
- **EQ changes**: they reach the live tap through a lock-free parameter block, with no item rebuild.
- **Crossfade**: a second `AVQueuePlayer` holds the preloaded item.
  - A boundary time observer at `at` on the outgoing item starts it, and both taps ramp their gain over `seconds`. Then the roles swap.
  - Now Playing and the remote commands follow the active player.
  - The audio session stays active throughout, so this works locked and in the background, as gapless already does.
- **Later option**: move music onto `AVAudioEngine`.
  - `AVAudioPlayerNode` scheduling decoded buffers, with `AVAudioUnitEQ`, gives sample-exact crossfades and native beat analysis, like the web player.
  - It means owning HTTP fetch and decode (AudioFile can't stream), so stage 2 keeps AVQueuePlayer plus taps and reconsiders only if the tap approach falls short.

## What Ether sends (agreed with the Ether music lead, 2026-11-24)

The full contract is in the protocol README, "Loudness and AutoMix markers".

- **`features.loudness`**: `{ available, album?, fades? }`. A sub-flag absent or false means that field is never sent.
- **On every track card and on audio plans**: `loudness = { trackGainDb, trackPeak, albumGainDb?, albumPeak?, lufs, reference: −18, source, trim? }`.
  - Peaks are linear true peak.
  - A `provider` hint (Deezer) has `trackGainDb` only.
  - Album values appear once the whole album is measured.
  - `trim = { startMs, endMs, fadeInEndMs?, fadeOutStartMs? }` comes from the same EBU R128 pass, with no extra decode.
- **`media.bpm`**: only when the provider knows it.
- **No measured beat grid**: ffmpeg has none, and Ether won't add a second decode.
- **When measurement runs**: after a track's first complete play, from its cached copy, so a new album levels by Deezer's hint or not at all until played once. The panel says which applies to the song playing.

## Verification plan (stage 2)

- **Unit tests**: biquad coefficients (DC and Nyquist response and band-centre gain per preset), envelope curves and the handover timing, as pure functions beside `sound.ts`.
- **Web**: an OfflineAudioContext render in headless Chrome (muted). Check the measured band gains of a swept sine through the chain, and the crossfade's overlap and equal-power sum, on the mock's tone fixtures.
- **Lab** (muted, validation account): a shuffled playlist across albums with very different loudness, an album straight through (gapless, album gain), and an audiobook (no AutoMix, Spoken word preset).
- **Native**: device checks on Android (worker emulator, then a phone) and Apple. Measure the per-item gain boundary on Android and whether crossfades land on time when locked.

# Sound measurements

Measures what Vela's sound engines actually produce (docs/sound.md): levelling gain, the per-item gain
switch at a gapless join, the EQ's frequency response, and an AutoMix crossfade's start, overlap and
power, and (on the web) beat alignment. Everything is captured from the engine's processed output,
before the device, so nothing is played aloud.

1. `bun tools/sound-measure/signals.ts <dir>` writes the signals (48 kHz stereo FLAC, needs ffmpeg).
2. Web: `bun tools/sound-measure/serve.ts <signals dir> <captures dir> [port]`, then open the page in
   Chrome started with `--mute-audio` and press Run. The page drives the real gapless player (levelling,
   EQ, crossfades), records its output with an AudioWorklet, and posts each case's capture to the
   server. It takes about two and a half minutes of real time.
3. `bun tools/sound-measure/analyse.ts <captures dir> <platform> [out dir]` writes `results.md` and
   `results.json`. Native captures can be WAV files with the same case names.

| Case | Plays | Checks |
| --- | --- | --- |
| `m1-unity`, `m1-half`, `m1-double` | tone1k at gain 1, 0.5, 2 | RMS against the signal's own level, ±0.05 dB |
| `m2-boundary` | tone1k at gain 0.5, then tone1k at gain 1, gapless | the sample where the gain switches, against item 2's first sample |
| `m3-off`, `m3-rock`, `m3-bassBoost`, `m3-vocal` | the same white noise, EQ off and per preset | response in 1/6-octave bands against core's `chainResponseDb`, ±0.5 dB |
| `m4-crossfade` | toneA, then toneB with a 6 s crossfade at 20 s | start (20 ms), overlap (50 ms), equal power (±0.5 dB) |
| `m5-beats` | 120 BPM click tracks crossfaded at 20.2 s | the incoming first beat lands on an outgoing beat (12 ms) |

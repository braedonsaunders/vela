import type { AudioOutputCapabilities } from '../../../packages/protocol/types';

/** What reaches the speakers: a browser has no bitstream path, so every codec is decoded to PCM in
 * the page and mixed or folded to the output device's channels (at most 7.1; the engine renders no
 * height layout). The engine's AudioContext runs at 48 kHz, so higher rates are resampled. */
export function audioOutputCapabilities(maxChannelCount: number | null): AudioOutputCapabilities {
  const count = maxChannelCount ?? 2;
  return {
    passthrough: [],
    immersive: [],
    maxChannels: count >= 8 ? 8 : count >= 6 ? 6 : 2,
    maxSampleRate: 48000,
    lossless: true,
  };
}

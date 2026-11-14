import { loadDecoderPackage, type AudioDecoderPackage } from '../../../../vendor/webgpu-player/src/decode/packages/DecoderPackage';
import { createBrowserCustomAudioOutputFactory } from '../../../../vendor/webgpu-player/src/audio/output/BrowserCustomAudioOutput';
import type { CustomPlaybackPlayOptions, CustomPlaybackAudioSwitch } from '../../../../vendor/webgpu-player/src/pipeline/CustomPlaybackControllerTypes';
import { AudioPackageRegistry, canonicalAudioCodec, packageForCodec } from './packages';
import { outputLayout, downmixPolicy } from './policy';

export { createBrowserCustomAudioOutputFactory };
export function createAudioPackages(baseURL: string) {
  return new AudioPackageRegistry<AudioDecoderPackage>(baseURL, async bytes => {
    const loaded = await loadDecoderPackage(bytes);
    if (loaded.kind !== 'audio') throw new Error('Expected an audio decoder package');
    return loaded;
  });
}
export type VelaAudioOptions = Pick<CustomPlaybackPlayOptions,
  'audioDecoder' | 'audioOutputMode' | 'audioRendersObjects' | 'decodedAudioOutputLayout' |
  'audioDownmixAlgorithm' | 'audioDownmixSettings' | 'binauralHeadphones'>;

/** Called for initial play AND each track selection. A fresh package choice prevents
 * TrueHD state from carrying into a DTS/AAC stream. Demux supplies qualified layout
 * metadata separately; channel count alone must never guess an input speaker mask. */
export async function prepareAudioOptions(registry: ReturnType<typeof createAudioPackages>,
  track: { codec: string; channels: number }, maximumOutputChannels: number | null,
  signal: AbortSignal, nightMode = false): Promise<VelaAudioOptions> {
  const codec = canonicalAudioCodec(track.codec);
  const decoder = packageForCodec(codec) ? await registry.load(codec, signal) : undefined;
  signal.throwIfAborted();
  if (!decoder && !['aac', 'opus', 'flac', 'mp3', 'vorbis'].includes(codec) && !codec.startsWith('pcm_'))
    throw new Error(`Audio ${codec} requires an Ether audio-only fallback; this engine has no local decoder`);
  return {
    audioOutputMode: 'decoded-pcm', audioDecoder: decoder ?? undefined,
    // Render the channel bed. Object rendering/headphone HRTF is optional upstream
    // functionality, deliberately not advertised as qualified Atmos passthrough.
    audioRendersObjects: false, binauralHeadphones: false,
    decodedAudioOutputLayout: outputLayout(maximumOutputChannels, track.channels),
    ...downmixPolicy(nightMode),
  };
}

/** Prepare before calling this: package errors leave the currently audible track
 * untouched. Upstream re-primes at its audio-master currentTimeMicroseconds. It
 * restarts decode generations (including video), not the media source/session. */
export function switchPreparedAudio(controller: {
  setAudioStreamIndex(index: number, options: CustomPlaybackAudioSwitch): Promise<unknown>;
}, trackIndex: number, options: VelaAudioOptions, signal: AbortSignal) {
  signal.throwIfAborted();
  return controller.setAudioStreamIndex(trackIndex, options);
}

import { canonicalAudioCodec, type AudioPackageRegistry, type LoadedAudioPackage } from './packages';

export type AudioLayout = 'stereo' | '5.1' | '7.1';
/** Upstream uses Web Audio order for 5.1, discrete WAVE order for 7.1.
 * The host must qualify the physical sink's mapping before claiming 7.1. */
export function outputLayout(maximumChannels: number | null, sourceChannels: number): AudioLayout {
  if (maximumChannels !== null && maximumChannels >= 8 && sourceChannels >= 8) return '7.1';
  if (maximumChannels !== null && maximumChannels >= 6 && sourceChannels >= 6) return '5.1';
  return 'stereo';
}
export function downmixPolicy(nightMode: boolean) {
  return {
    audioDownmixAlgorithm: nightMode ? ('night-mode-dialogue' as const) : ('standard-lo-ro' as const),
    // Standard Lo/Ro: center/surround -3 dB; LFE omitted. Upstream lookahead limiter
    // handles correlated peaks after matrix summation; no hard-clipping gain boost.
    audioDownmixSettings: { version: 1 as const, centerLevel: 1, surroundLevel: 1, outputGain: 1 },
  };
}
export interface AudioTrackConfiguration {
  codec: string;
  sampleRate: number;
  channels: number;
  /** Exact container-provided WebCodecs codec string, not a fabricated profile. */
  webCodecsCodec?: string;
  description?: Uint8Array;
}
export type AudioRoute<P> =
  | { kind: 'webcodecs' }
  | { kind: 'wasm'; decoder: { codec: string; source: P } }
  | { kind: 'ether'; reason: string };
/** The runtime feeds actual configure/decode failures back as failed backends, then
 * re-primes the selected track at the audible clock time. No video/source restart. */
export async function selectAudioRoute<P extends LoadedAudioPackage>(
  track: AudioTrackConfiguration,
  packages: AudioPackageRegistry<P>,
  signal: AbortSignal,
  probe: (configuration: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    description?: Uint8Array;
  }) => Promise<boolean>,
  failed: ReadonlySet<'webcodecs' | 'wasm'> = new Set(),
): Promise<AudioRoute<P>> {
  signal.throwIfAborted();
  const codec = canonicalAudioCodec(track.codec);
  // PCM and ALAC must be qualified by demux/decoder, never assumed from API presence.
  const nativeCodec =
    track.webCodecsCodec ??
    ({ flac: 'flac', opus: 'opus', vorbis: 'vorbis', mp3: 'mp3' } as Record<string, string>)[codec];
  if (!failed.has('webcodecs') && nativeCodec) {
    try {
      const supported = await probe({
        codec: nativeCodec,
        sampleRate: track.sampleRate,
        numberOfChannels: track.channels,
        description: track.description,
      });
      signal.throwIfAborted();
      if (supported) return { kind: 'webcodecs' };
    } catch (error) {
      signal.throwIfAborted(); /* Reject this configuration, then try package. */
    }
  }
  let reason = `No local decoder for ${codec}`;
  if (!failed.has('wasm')) {
    try {
      const decoder = await packages.load(codec, signal);
      if (decoder) return { kind: 'wasm', decoder };
    } catch (error) {
      signal.throwIfAborted();
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  signal.throwIfAborted();
  return { kind: 'ether', reason };
}

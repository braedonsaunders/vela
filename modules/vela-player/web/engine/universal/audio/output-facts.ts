import type { AudioOutputFormat } from '../../format-info';
import type { AudioLayout } from './policy';

/** Codecs whose decoded PCM is the exact signal the encoder was given. */
const LOSSLESS = new Set(['truehd', 'mlp', 'flac', 'alac', 'wavpack', 'tta', 'ape', 'wmalossless']);

export interface AudioOutputRoute {
  codec: string;
  sourceChannels: number;
  sourceSampleRate: number;
  outputChannels: number;
  layout: AudioLayout;
  outputSampleRate: number;
  /** 'webcodecs' for the browser's decoder, otherwise the WASM package id. */
  decoder: string;
}

const PACKAGE_NAMES: Record<string, string> = {
  truehd: 'WASM FFmpeg truehd',
  dts: 'WASM libdcadec',
  eac3: 'WASM FFmpeg eac3',
  'vela-audio': 'WASM FFmpeg',
};

/** The info card's audio output facts for a decoded route: everything reaches the browser's
 * output as float PCM (no bitstream path exists in a browser), mixed or folded to the layout the
 * output device exposes and resampled to the output rate. DTS-HD MA is lossless only when the
 * stream carries its XLL extension, which the container facts do not say, so it stays unclaimed. */
export function audioOutputFacts(route: AudioOutputRoute): AudioOutputFormat {
  const downmixed = route.outputChannels < route.sourceChannels;
  const resampled = route.outputSampleRate !== route.sourceSampleRate;
  const pcm = route.codec.startsWith('pcm_');
  return {
    delivery: 'decoded',
    codec: 'pcm',
    channels: route.outputChannels,
    layout: route.layout,
    sampleRate: route.outputSampleRate,
    bitDepth: 32,
    // Only a lossless source can arrive without loss; a lossy one has no lossless claim to make.
    ...(LOSSLESS.has(route.codec) || pcm ? { lossless: !downmixed && !resampled } : {}),
    decoderName:
      route.decoder === 'webcodecs' ? `WebCodecs ${route.codec}` : (PACKAGE_NAMES[route.decoder] ?? `WASM ${route.decoder}`),
    downmixed,
    resampled,
  };
}

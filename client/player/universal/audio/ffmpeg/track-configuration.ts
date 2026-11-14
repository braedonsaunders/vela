import { encodeAudioConfiguration, type AudioConfiguration } from './configuration';
import { canonicalAudioCodec } from '../packages';
import codecs from './codecs.json';
export const velaFFmpegCodecs = new Set(codecs.map(([codec]) => codec));
const internalCodecs: Record<string, string> = {
  A_ALAC: 'alac', A_MPEG_L1: 'mp1', A_MPEG_L2: 'mp2', 'A_MPEG/L1': 'mp1', 'A_MPEG/L2': 'mp2',
  'A_REAL/COOK': 'cook', 'A_REAL/14_4': 'ra_144', 'A_REAL/28_8': 'ra_288',
  A_TTA1: 'tta', A_WAVPACK4: 'wavpack', A_ATRAC_ATRAC1: 'atrac1', A_ATRAC_ATRAC3: 'atrac3',
};
export function velaContainerCodec(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const codec = internalCodecs[id] ?? canonicalAudioCodec(id);
  return velaFFmpegCodecs.has(codec) ? codec : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}
function bytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  return null;
}
/** Pinned Mediabunny raw records: same narrow backing access upstream uses for WMA.
 * Never synthesize an ALAC cookie or Vorbis headers from count/rate alone. */
export function velaTrackPrivate(track: unknown, config: unknown): Uint8Array | null {
  const decoder = record(config);
  const declared = bytes(decoder?.description);
  if (declared) return declared;
  const backing = record(record(track)?._backing);
  const internal = record(backing?.internalTrack);
  const info = record(internal?.info);
  return bytes(internal?.codecPrivate) ?? bytes(info?.codecDescription);
}
export interface VelaTrackMetadata {
  audioTrack: unknown; decoderConfig: unknown; packageCodecPrivate: Uint8Array | null;
  channelCount: number; sampleRate: number; declaredChannelMask: number | null;
}
export function velaTrackConfiguration(metadata: VelaTrackMetadata, codec: string): Uint8Array {
  const format: AudioConfiguration = { channels: metadata.channelCount, sampleRate: metadata.sampleRate,
    channelMask: metadata.declaredChannelMask ?? 0,
    description: velaTrackPrivate(metadata.audioTrack, metadata.decoderConfig) };
  if (metadata.packageCodecPrivate) {
    // Upstream has already validated this WAVEFORMATEX and its codec tag.
    const wave = metadata.packageCodecPrivate;
    if (wave.length < 18) throw new Error('Truncated WAVEFORMATEX');
    const view = new DataView(wave.buffer, wave.byteOffset, wave.byteLength);
    const extension = view.getUint16(16, true);
    if (extension > wave.length - 18) throw new Error('Truncated WAVEFORMATEX extension');
    format.channels = view.getUint16(2, true); format.sampleRate = view.getUint32(4, true);
    format.bitRate = view.getUint32(8, true) * 8; format.blockAlign = view.getUint16(12, true);
    format.bitsPerSample = view.getUint16(14, true);
    let offset = 18;
    if (view.getUint16(0, true) === 0xfffe) {
      if (extension < 22) throw new Error('Truncated WAVE_FORMAT_EXTENSIBLE');
      format.channelMask = view.getUint32(20, true);
      format.bitsPerSample = view.getUint16(18, true) || format.bitsPerSample;
      offset += 22;
    }
    format.description = wave.slice(offset, 18 + extension);
  } else if (codec.startsWith('pcm_')) {
    const match = /^pcm_[suf](\d+)/.exec(codec);
    format.bitsPerSample = match ? Number(match[1]) : 8;
    format.blockAlign = metadata.channelCount * format.bitsPerSample / 8;
    format.bitRate = metadata.sampleRate * format.blockAlign * 8;
    format.description = null;
  }
  if (codec === 'alac' && format.description?.length === 24) {
    // Matroska may carry only the ALACSpecificConfig; FFmpeg expects its 36-byte atom.
    const atom = new Uint8Array(36); new DataView(atom.buffer).setUint32(0, 36, false);
    atom.set([97, 108, 97, 99], 4); atom.set(format.description, 12); format.description = atom;
  }
  return encodeAudioConfiguration(format);
}

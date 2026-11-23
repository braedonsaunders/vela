import type {
  AudioSourceFormat,
  RangeFormat,
  VideoOutputFormat,
  VideoSourceFormat,
} from '../format-info';
import type { DolbyVisionRoute } from './dolby-vision';
import type { AudioTrack, VideoTrack } from './types';

/** The server's probe of the original, where it sent one (PlaybackPath.originalVideo). */
export interface ProbedVideo {
  profile?: string;
  bitDepth?: number;
  frameRate?: number;
  dvLevel?: number;
}

function bytes(source: AllowSharedBufferSource | undefined): Uint8Array | null {
  if (!source) return null;
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source as ArrayBuffer);
}

const AVC_PROFILES: Record<number, string> = {
  66: 'Baseline',
  77: 'Main',
  88: 'Extended',
  100: 'High',
  110: 'High 10',
  122: 'High 4:2:2',
  244: 'High 4:4:4 Predictive',
};

/** Profile and bit depth from the decoder configuration the stream actually carries. */
export function videoCodecFacts(codec: string, config: VideoDecoderConfig | null): { profile?: string; bitDepth?: number } {
  const string = config?.codec ?? '';
  const description = bytes(config?.description);
  if (codec === 'h264') {
    // avc1.PPCCLL: profile_idc, then the constraint flags; avcC carries the same two bytes.
    const fields = /^avc[13]\.([0-9a-f]{2})([0-9a-f]{2})/i.exec(string);
    const idc = fields ? parseInt(fields[1], 16) : description && description.length > 2 ? description[1] : null;
    const constraints = fields ? parseInt(fields[2], 16) : description && description.length > 2 ? description[2] : 0;
    if (idc === null) return {};
    const name = idc === 66 && constraints & 0x40 ? 'Constrained Baseline' : AVC_PROFILES[idc];
    // High 10 and above may carry more than 8 bits; the codec string alone does not say how many.
    return { ...(name ? { profile: name } : {}), ...(idc < 110 ? { bitDepth: 8 } : {}) };
  }
  if (codec === 'hevc') {
    // hvcC: general_profile_idc in byte 1, bitDepthLumaMinus8 in byte 17.
    const valid = description && description.length >= 23 && description[0] === 1;
    const idc = valid ? description[1] & 0x1f : Number(/^(?:hvc1|hev1|dvh1|dvhe)\.[A-C]?(\d+)/i.exec(string)?.[1] ?? NaN);
    const name = ({ 1: 'Main', 2: 'Main 10', 3: 'Main Still Picture', 4: 'Rext' } as Record<number, string>)[idc];
    return { ...(name ? { profile: name } : {}), ...(valid ? { bitDepth: 8 + (description[17] & 7) } : {}) };
  }
  if (codec === 'av1') {
    const fields = /^av01\.(\d)\.\d{2}[MH]\.(\d{2})/i.exec(string);
    const profile = fields ? Number(fields[1]) : description && description.length >= 4 ? description[1] >> 5 : null;
    const name = profile === null ? undefined : (['Main', 'High', 'Professional'] as const)[profile];
    const depth = fields ? Number(fields[2]) : undefined;
    return { ...(name ? { profile: name } : {}), ...(depth ? { bitDepth: depth } : {}) };
  }
  if (codec === 'vp9') {
    const fields = /^vp09\.(\d{2})\.\d{2}\.(\d{2})/i.exec(string);
    return fields ? { profile: `Profile ${Number(fields[1])}`, bitDepth: Number(fields[2]) } : {};
  }
  return {};
}

export function sourceRange(track: Pick<VideoTrack, 'color'>): RangeFormat | undefined {
  const transfer = String(track.color.transfer ?? '');
  if (transfer === 'pq' || transfer === 'smpte2084') return 'hdr10';
  if (transfer === 'hlg' || transfer === 'arib-std-b67') return 'hlg';
  return track.color.primaries || track.color.matrix || transfer ? 'sdr' : undefined;
}

export function videoSourceFormat(
  track: VideoTrack,
  probed: ProbedVideo | undefined,
  dolbyVision: DolbyVisionRoute,
): VideoSourceFormat {
  const parsed = videoCodecFacts(track.codec, track.config);
  const range = dolbyVision.kind === 'base-layer' ? 'dv' : sourceRange(track);
  const profile = parsed.profile ?? probed?.profile;
  const bitDepth = parsed.bitDepth ?? probed?.bitDepth;
  return {
    codec: track.codec,
    ...(profile ? { profile } : {}),
    ...(bitDepth ? { bitDepth } : {}),
    width: track.width,
    height: track.height,
    ...(probed?.frameRate && Number.isFinite(probed.frameRate) && probed.frameRate > 0 ? { frameRate: probed.frameRate } : {}),
    ...(range ? { range } : {}),
    ...(dolbyVision.kind === 'base-layer'
      ? { dvProfile: dolbyVision.profile, ...(probed?.dvLevel ? { dvLevel: probed.dvLevel } : {}) }
      : {}),
    ...(track.fieldOrder ? { interlaced: track.fieldOrder !== 'progressive' } : {}),
  };
}

/** The picture the canvas shows. A browser cannot switch the display's mode, so frame-rate and
 * dynamic-range matching are unsupported; HDR is tone-mapped unless HDR output is on. */
export function videoOutputFormat(
  source: VideoSourceFormat,
  dolbyVision: DolbyVisionRoute,
  decoder: { decoder: 'hardware' | 'software'; decoderName: string; deinterlaces?: boolean } | null,
  hdrOutput: boolean,
): VideoOutputFormat {
  const base = dolbyVision.kind === 'base-layer' ? dolbyVision.base : source.range;
  const hdr = base === 'hdr10' || base === 'hlg' || base === 'hdr10+';
  return {
    range: hdr && hdrOutput ? base : base ? 'sdr' : undefined,
    ...(dolbyVision.kind === 'base-layer' ? { dvConversion: 'base-layer' as const } : {}),
    ...(decoder ? { decoder: decoder.decoder, decoderName: decoder.decoderName } : {}),
    frameRateMatch: 'unsupported',
    rangeMatch: 'unsupported',
    ...(base ? { toneMapped: hdr && !hdrOutput } : {}),
    ...(source.interlaced !== undefined ? { deinterlaced: source.interlaced && decoder?.deinterlaces === true } : {}),
  };
}

const SPEAKERS: [number, string][] = [
  [0x1, 'FL'], [0x2, 'FR'], [0x4, 'FC'], [0x8, 'LFE'], [0x10, 'BL'], [0x20, 'BR'], [0x40, 'FLC'], [0x80, 'FRC'],
  [0x100, 'BC'], [0x200, 'SL'], [0x400, 'SR'], [0x800, 'TC'], [0x1000, 'TFL'], [0x2000, 'TFC'], [0x4000, 'TFR'],
  [0x8000, 'TBL'], [0x10000, 'TBC'], [0x20000, 'TBR'],
];
const NAMED: Record<number, string> = {
  0x4: 'mono', 0x3: 'stereo', 0xb: '2.1', 0x7: '3.0', 0x33: 'quad', 0x603: 'quad(side)', 0x37: '5.0', 0x607: '5.0(side)',
  0x3f: '5.1', 0x60f: '5.1(side)', 0x70f: '6.1', 0x13f: '6.1(back)', 0x63f: '7.1', 0xff: '7.1(wide)',
  0x2d63f: '7.1.4', 0x5063f: '7.1.2', 0x2d60f: '5.1.4', 0x5060f: '5.1.2',
};

/** FFmpeg's name for a WAVE speaker mask, or the speakers themselves for an unnamed one. */
export function channelLayoutName(mask: number | null, channels: number): string | undefined {
  if (mask && NAMED[mask]) return NAMED[mask];
  if (mask) return SPEAKERS.filter(([bit]) => mask & bit).map(([, name]) => name).join('+');
  return channels === 1 ? 'mono' : channels === 2 ? 'stereo' : undefined;
}

/** Objects in a TrueHD or E-AC-3 stream are Dolby Atmos; their count comes from the decoder. */
export function audioSourceFormat(track: AudioTrack, objects = 0): AudioSourceFormat {
  const layout = channelLayoutName(track.channelMask, track.channels);
  const atmos = objects > 0 && (track.codec === 'truehd' || track.codec === 'eac3');
  return {
    ...(atmos ? { immersive: 'atmos' as const } : {}),
    codec: track.codec,
    channels: track.channels,
    ...(layout ? { layout } : {}),
    sampleRate: track.sampleRate,
    ...(track.language && track.language !== 'und' ? { language: track.language } : {}),
  };
}

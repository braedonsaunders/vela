// What the desktop hosts' libmpv reports, turned into the shared source → output facts
// (Snapshot.format) and the negotiation capabilities. The Windows host (apps/vela-windows) and the
// Linux helper (apps/vela-desktop/linux) send mpv's own properties unchanged; the mapping lives here
// once, so both platforms describe a stream the same way. Anything mpv did not report stays absent.
import type {
  AudioOutputFormat,
  AudioSourceFormat,
  MatchState,
  PlaybackFormat,
  PlaybackPlan,
  PlayerCapabilities,
  RangeFormat,
  VideoOutputFormat,
  VideoSourceFormat,
} from '@vela/player-api';

type Bag = Record<string, unknown>;

/** mpv properties a host sends with each snapshot (names are mpv's). */
export interface MpvFacts {
  /** current-tracks/video and current-tracks/audio */
  videoTrack?: Bag | null;
  audioTrack?: Bag | null;
  'video-params'?: Bag | null;
  'video-target-params'?: Bag | null;
  'audio-params'?: Bag | null;
  'audio-out-params'?: Bag | null;
  'hwdec-current'?: string | null;
  'container-fps'?: number | null;
  'deinterlace-active'?: boolean | null;
  volume?: number | null;
  speed?: number | null;
}

/** What the host knows beyond mpv: the display mode, how matching resolved, the audio route. */
export interface HostOutputFacts {
  display?: { width?: number; height?: number; refreshRate?: number; hdr?: boolean } | null;
  frameRateMatch?: MatchState;
  rangeMatch?: MatchState;
  /** Exclusive device access was requested for PCM (passthrough is always exclusive on WASAPI). */
  exclusive?: boolean;
  route?: string;
}

const text = (bag: Bag | null | undefined, key: string) =>
  typeof bag?.[key] === 'string' && bag[key] !== '' ? (bag[key] as string) : undefined;
const number = (bag: Bag | null | undefined, key: string) =>
  typeof bag?.[key] === 'number' && Number.isFinite(bag[key]) ? (bag[key] as number) : undefined;
const positive = (value: number | undefined) => (value !== undefined && value > 0 ? value : undefined);

/** Bits per component from an FFmpeg/mpv pixel format name ('yuv420p10', 'p010', 'nv12'). */
export function pixelBitDepth(format: string | undefined): number | undefined {
  if (!format) return undefined;
  const planar = /^(?:yuva?|gbra?p|gray)\d*p?(\d{1,2})(?:le|be)?$/.exec(format);
  if (planar && /p\d/.test(format)) return Number(planar[1]);
  const packed = /^(?:p0|p2|p4|y2|y4|xv)(\d{2})/.exec(format);
  if (packed) return Number(packed[1]);
  if (/^(?:x2rgb10|x2bgr10|rgb30|rgba1010102)/.test(format)) return 10;
  if (/^(?:nv12|nv21|nv16|nv24|yuv4\d\dp|yuvj4\d\dp|gbrp|rgb24|bgr24|rgba|bgra|rgb0|bgr0|0rgb|0bgr|argb|abgr|yuyv422|uyvy422|gray|pal8)$/.test(format))
    return 8;
  return undefined;
}

/** Range a mpv colour description shows: transfer, Dolby Vision mapping and HDR10+ metadata. */
function rangeOf(params: Bag | null | undefined, dolbyVision: boolean): RangeFormat | undefined {
  if (dolbyVision) return 'dv';
  const gamma = text(params, 'gamma');
  if (!gamma) return undefined;
  if (gamma === 'pq') return params?.['scene-max-r'] !== undefined ? 'hdr10+' : 'hdr10';
  if (gamma === 'hlg') return 'hlg';
  return 'sdr';
}

/** Dolby Vision profile as written ('8.1'): mpv knows the profile, the server probe the BL compatibility. */
export function dolbyVisionProfile(profile: number | undefined, compatibility: number | undefined): string | undefined {
  if (profile === undefined) return undefined;
  if ((profile === 8 || profile === 10) && compatibility !== undefined && compatibility > 0) return `${profile}.${compatibility}`;
  return String(profile);
}

const immersiveProfile = (profile: string | undefined) =>
  !profile ? undefined : /atmos|joc/i.test(profile) ? 'atmos' as const : /dts:x|dts-x|dtsx/i.test(profile) ? 'dtsx' as const : undefined;

const LOSSLESS = new Set(['truehd', 'mlp', 'flac', 'alac', 'wavpack', 'ape', 'tta', 'tak', 's302m']);
function losslessSource(codec: string | undefined, profile: string | undefined) {
  if (!codec) return undefined;
  if (codec.startsWith('pcm_') || LOSSLESS.has(codec)) return true;
  if (codec === 'dts') return profile ? /HD MA|DTS:X|lossless/i.test(profile) : undefined;
  return false;
}

/** mpv sample format → integer bit depth ('s32' → 32); float carries no claim. */
function sampleBits(format: string | undefined) {
  const match = format ? /^s(16|24|32)p?$/.exec(format) : null;
  return match ? Number(match[1]) : format === 'u8' || format === 'u8p' ? 8 : undefined;
}

/** mpv's passthrough sample formats ('spdif-truehd') as capability tokens. */
const SPDIF: Record<string, string> = {
  'spdif-ac3': 'ac3', 'spdif-eac3': 'eac3', 'spdif-dts': 'dts', 'spdif-dtshd': 'dts-hd',
  'spdif-truehd': 'truehd', 'spdif-aac': 'aac', 'spdif-mp3': 'mp3',
};

function videoSource(facts: MpvFacts, plan: PlaybackPlan | undefined): VideoSourceFormat | null {
  const track = facts.videoTrack;
  const codec = text(track, 'codec');
  if (!codec) return null;
  const params = facts['video-params'];
  const original = plan?.paths.find((path) => path.id === plan.selectedPathId)?.originalVideo;
  const dvNumber = number(track, 'dolby-vision-profile') ?? original?.dvProfile;
  const dvProfile = dolbyVisionProfile(dvNumber, original?.dvBlSignalCompatibilityId);
  const frameRate = positive(number(facts as Bag, 'container-fps')) ?? positive(number(track, 'demux-fps'));
  const format: VideoSourceFormat = { codec };
  const assign = <K extends keyof VideoSourceFormat>(key: K, value: VideoSourceFormat[K] | undefined) => {
    if (value !== undefined) format[key] = value;
  };
  assign('profile', text(track, 'codec-profile'));
  assign('bitDepth', pixelBitDepth(text(params, 'hw-pixelformat') ?? text(params, 'pixelformat')) ?? original?.bitDepth);
  assign('width', positive(number(track, 'demux-w')) ?? positive(number(params, 'w')));
  assign('height', positive(number(track, 'demux-h')) ?? positive(number(params, 'h')));
  assign('frameRate', frameRate);
  assign('range', rangeOf(params, dvProfile !== undefined));
  assign('dvProfile', dvProfile);
  assign('dvLevel', number(track, 'dolby-vision-level') ?? original?.dvLevel);
  assign('interlaced', original?.isInterlaced);
  return format;
}

function videoOutput(facts: MpvFacts, host: HostOutputFacts, source: VideoSourceFormat | null): VideoOutputFormat | null {
  if (!source) return null;
  const target = facts['video-target-params'];
  const out: VideoOutputFormat = {};
  // gpu-next applies the Dolby Vision RPU itself; the display is sent PQ or SDR, never DV.
  const range = rangeOf(target, false);
  if (range) out.range = range === 'hdr10+' ? 'hdr10' : range;
  if (source.range === 'dv') out.dvConversion = 'reshaped';
  const hwdec = facts['hwdec-current'];
  if (typeof hwdec === 'string' && hwdec !== '') {
    out.decoder = hwdec === 'no' ? 'software' : 'hardware';
    out.decoderName = hwdec === 'no' ? text(facts.videoTrack, 'decoder') ?? source.codec : hwdec;
  }
  const display = host.display;
  if (display?.width) out.width = display.width;
  if (display?.height) out.height = display.height;
  if (display?.refreshRate) out.refreshRate = display.refreshRate;
  if (host.frameRateMatch) out.frameRateMatch = host.frameRateMatch;
  if (host.rangeMatch) out.rangeMatch = host.rangeMatch;
  if (range && source.range) out.toneMapped = source.range !== 'sdr' && range === 'sdr';
  if (typeof facts['deinterlace-active'] === 'boolean') out.deinterlaced = facts['deinterlace-active'];
  return out;
}

function audioSource(facts: MpvFacts): AudioSourceFormat | null {
  const track = facts.audioTrack;
  const codec = text(track, 'codec');
  if (!codec) return null;
  const format: AudioSourceFormat = { codec };
  const profile = text(track, 'codec-profile');
  if (profile) format.profile = profile;
  const channels = positive(number(track, 'demux-channel-count'));
  if (channels) format.channels = channels;
  const layout = text(track, 'demux-channels');
  if (layout) format.layout = layout;
  const sampleRate = positive(number(track, 'demux-samplerate')) ?? positive(number(facts['audio-params'], 'samplerate'));
  if (sampleRate) format.sampleRate = sampleRate;
  const pcm = /^pcm_[su](8|16|24|32)/.exec(codec);
  // A decoder's s16 output proves a 16-bit source; s32 may carry 24 bits, so it proves nothing.
  const bits = pcm ? Number(pcm[1]) : sampleBits(text(facts['audio-params'], 'format')) === 16 ? 16 : undefined;
  if (bits) format.bitDepth = bits;
  const immersive = immersiveProfile(profile);
  if (immersive) format.immersive = immersive;
  const language = text(track, 'lang');
  if (language) format.language = language;
  return format;
}

function audioOutput(facts: MpvFacts, host: HostOutputFacts, source: AudioSourceFormat | null): AudioOutputFormat | null {
  const params = facts['audio-out-params'];
  const sampleFormat = text(params, 'format');
  if (!source || !sampleFormat) return null;
  const passthrough = SPDIF[sampleFormat];
  const route = host.route;
  if (passthrough) {
    const out: AudioOutputFormat = {
      delivery: 'passthrough', codec: passthrough, lossless: losslessSource(source.codec, source.profile),
      // FFmpeg's IEC 61937 packer frames TrueHD in Dolby MAT; every other codec is a plain IEC 61937 burst.
      carrier: passthrough === 'truehd' ? 'mat' : 'iec61937', exclusive: true,
    };
    if (source.immersive) out.immersive = source.immersive;
    if (route) out.route = route;
    return out;
  }
  const decoded = facts['audio-params'];
  const channels = positive(number(params, 'channel-count'));
  const sampleRate = positive(number(params, 'samplerate'));
  const out: AudioOutputFormat = { delivery: 'decoded', codec: 'pcm', carrier: 'lpcm' };
  if (channels) out.channels = channels;
  const layout = text(params, 'hr-channels') ?? text(params, 'channels');
  if (layout) out.layout = layout;
  if (sampleRate) out.sampleRate = sampleRate;
  const bits = sampleBits(sampleFormat);
  // s32 is a container: WASAPI and ALSA carry 24 valid bits in it, and mpv does not say how many.
  if (bits && bits !== 32) out.bitDepth = bits;
  const sourceChannels = source.channels ?? positive(number(decoded, 'channel-count'));
  if (channels && sourceChannels) out.downmixed = channels < sourceChannels;
  const decodedRate = positive(number(decoded, 'samplerate')) ?? source.sampleRate;
  if (sampleRate && decodedRate) out.resampled = sampleRate !== decodedRate;
  const decoder = text(facts.audioTrack, 'decoder');
  if (decoder) out.decoderName = `FFmpeg ${decoder}`;
  const unity = (facts.volume ?? 100) === 100 && (facts.speed ?? 1) === 1;
  const lossless = losslessSource(source.codec, source.profile);
  if (lossless !== undefined)
    out.lossless = lossless && unity && out.downmixed !== true && out.resampled !== true &&
      // Float carries 24-bit integers exactly; a 16-bit output cannot carry a deeper source.
      !(bits === 16 && (source.bitDepth ?? 24) > 16);
  if (host.exclusive !== undefined) out.exclusive = host.exclusive;
  if (route) out.route = route;
  return out;
}

/** Snapshot.format from one host report. */
export function mpvPlaybackFormat(facts: MpvFacts | null | undefined, host: HostOutputFacts | null | undefined, plan?: PlaybackPlan): PlaybackFormat | null {
  if (!facts) return null;
  const video = videoSource(facts, plan);
  const audio = audioSource(facts);
  if (!video && !audio) return null;
  return {
    video, videoOut: videoOutput(facts, host ?? {}, video),
    audio, audioOut: audioOutput(facts, host ?? {}, audio),
  };
}

/** What a host measured about this machine at negotiation time. */
export interface MpvProbe {
  /** The window's display is in, or can be switched to, HDR (Windows advanced colour). */
  hdrDisplay: boolean;
  /** Bitstreams the audio endpoint accepts (IEC 61937 / ELD), as capability tokens. */
  passthrough: string[];
  /** Most PCM channels and highest PCM rate the endpoint takes. */
  maxChannels?: number;
  maxSampleRate?: number;
  /** Hardware decoders the GPU reports, by FFmpeg codec name. */
  hardwareVideo?: string[];
  /** Container families the libmpv build opens (libbluray adds iso-bluray). */
  containers?: string[];
}

// Software decoders that keep up at 4K60 on a current desktop CPU; mpv falls back to them when the GPU lacks the codec.
const SOFTWARE_VIDEO = ['h264', 'hevc', 'av1', 'vp9', 'vp8', 'mpeg2video', 'mpeg4', 'vc1', 'wmv3', 'mpeg1video', 'msmpeg4v3', 'h263', 'theora', 'prores', 'dnxhd', 'mjpeg'];
const AUDIO = [
  'aac', 'ac3', 'eac3', 'dts', 'truehd', 'mlp', 'flac', 'alac', 'opus', 'vorbis', 'mp3', 'mp2', 'mp1',
  'pcm_s16le', 'pcm_s16be', 'pcm_s24le', 'pcm_s24be', 'pcm_s32le', 'pcm_f32le', 'pcm_u8', 'pcm_bluray', 'pcm_dvd',
  'wavpack', 'ape', 'tta', 'wmav2', 'wmapro', 'wmalossless', 'cook', 'atrac3', 'aac_latm', 'dsd_lsbf', 'dsd_msbf',
];
const CONTAINERS = ['mkv', 'webm', 'mp4', 'mov', 'mpegts', 'm2ts', 'avi', 'ogg', 'flv', 'asf', 'rm', 'mpegps'];
// libass renders ASS/SSA with their styling; PGS, VobSub and DVB bitmaps are drawn by mpv itself.
const SUBTITLES = ['webvtt', 'srt', 'ass', 'ssa', 'pgs', 'vobsub', 'dvbsub', 'tx3g'];

/** Negotiation capabilities for a libmpv desktop host. HLS is the server's fallback, kept to what it emits. */
export function mpvCapabilities(probe: MpvProbe): PlayerCapabilities {
  const passthrough = [...new Set(probe.passthrough)].filter((token) =>
    ['ac3', 'eac3', 'eac3-joc', 'truehd', 'dts', 'dts-hd'].includes(token));
  // E-AC-3 JOC is ordinary E-AC-3 on the wire; a receiver that takes E-AC-3 decodes its Atmos itself.
  if (passthrough.includes('eac3') && !passthrough.includes('eac3-joc')) passthrough.push('eac3-joc');
  const immersive = [
    ...(passthrough.includes('eac3') ? ['eac3-joc'] : []),
    ...(passthrough.includes('truehd') ? ['truehd-atmos'] : []),
    ...(passthrough.includes('dts-hd') ? ['dtsx'] : []),
  ];
  const hdr = probe.hdrDisplay ? ['hdr10', 'hdr10+', 'hlg'] : [];
  return {
    containers: ['mp4', 'mpegts'],
    videoCodecs: ['h264', 'hevc', 'av1', 'vp9'],
    audioCodecs: ['aac', 'ac3', 'eac3', 'flac', 'opus', 'mp3'],
    subtitleFormats: SUBTITLES,
    hls: true, mse: false,
    hdr,
    // libplacebo applies every profile's RPU (Profile 7 from its base layer and RPU); the link carries HDR10 or SDR.
    dolbyVisionReshape: ['5', '7', '8.1', '8.2', '8.4'],
    audioOutput: {
      passthrough, immersive,
      maxChannels: Math.max(2, Math.min(probe.maxChannels ?? 8, 16)),
      ...(probe.maxSampleRate ? { maxSampleRate: probe.maxSampleRate } : {}),
      lossless: true,
    },
    originalPlayback: {
      version: 1, range: true, webgpu: false,
      demuxContainers: [...new Set([...CONTAINERS, ...(probe.containers ?? [])])],
      videoDecoders: [...new Set([...SOFTWARE_VIDEO, ...(probe.hardwareVideo ?? [])])],
      audioDecoders: AUDIO,
    },
  } as PlayerCapabilities;
}

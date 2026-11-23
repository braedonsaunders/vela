// The info card's source → output lines, from the engine's Snapshot.format. Pure: each line joins the
// facts the engine reported and leaves out the rest, so an engine that knows little shows little.
import { msg, number } from '@vela/core';
import type {
  AudioOutputFormat,
  AudioSourceFormat,
  MatchState,
  PlaybackFormat,
  RangeFormat,
  VideoOutputFormat,
  VideoSourceFormat,
} from '@vela/player-api';

export interface FormatLines {
  video: string;
  videoOut: string;
  audio: string;
  audioOut: string;
}

const VIDEO_CODECS: Record<string, string> = {
  h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', vc1: 'VC-1', mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4', mpeg1video: 'MPEG-1', prores: 'ProRes', wmv3: 'WMV9', theora: 'Theora',
};

const AUDIO_CODECS: Record<string, string> = {
  truehd: 'TrueHD', mlp: 'MLP', eac3: 'E-AC-3', ac3: 'AC-3', dts: 'DTS', aac: 'AAC', flac: 'FLAC', alac: 'ALAC',
  dca: 'DTS', opus: 'Opus', vorbis: 'Vorbis', mp3: 'MP3', mp2: 'MP2', pcm: 'PCM', apac: 'APAC', pcm_bluray: 'PCM',
  pcm_dvd: 'PCM', wavpack: 'WavPack', ape: 'APE',
};

export function rangeLabel(range: RangeFormat | undefined, dvProfile?: string): string {
  switch (range) {
    case 'dv':
      return dvProfile ? `Dolby Vision ${dvProfile}` : 'Dolby Vision';
    case 'hdr10':
      return 'HDR10';
    case 'hdr10+':
      return 'HDR10+';
    case 'hlg':
      return 'HLG';
    case 'sdr':
      return 'SDR';
    default:
      return '';
  }
}

function videoCodec(codec: string): string {
  return VIDEO_CODECS[codec] ?? codec.toUpperCase();
}

function audioCodec(codec: string): string {
  if (codec.startsWith('pcm_')) return 'PCM';
  return AUDIO_CODECS[codec] ?? codec.toUpperCase();
}

/** 23.976 stays 23.976, 24 stays 24, 59.94 stays 59.94. */
export function frameRateLabel(rate: number): string {
  return `${number(rate, { maximumFractionDigits: 3, minimumFractionDigits: 0, useGrouping: false })} fps`;
}

function size(width?: number, height?: number): string {
  return width && height ? `${number(width, { useGrouping: false })}×${number(height, { useGrouping: false })}` : '';
}

/** 8 channels as 7.1, 6 as 5.1, 2 as stereo; a named layout wins. */
export function channelLabel(channels?: number, layout?: string): string {
  if (layout) return layout === 'stereo' ? msg('player.format.stereo') : layout.replace(/\(.*\)$/, '');
  if (!channels) return '';
  const named: Record<number, string> = { 1: msg('player.format.mono'), 2: msg('player.format.stereo'), 6: '5.1', 8: '7.1' };
  return named[channels] ?? msg('player.format.channels', { count: number(channels) });
}

function rateDepth(rate?: number, depth?: number): string {
  const khz = rate ? `${number(rate / 1000, { maximumFractionDigits: 1 })} kHz` : '';
  const bits = depth ? `${number(depth)}-bit` : '';
  return [khz, bits].filter(Boolean).join(' / ');
}

function immersiveLabel(immersive: AudioSourceFormat['immersive']): string {
  return immersive === 'atmos' ? 'Atmos' : immersive === 'dtsx' ? 'DTS:X' : '';
}

function join(parts: string[]): string {
  return parts.filter(Boolean).join(' · ');
}

export function videoSourceLine(video: VideoSourceFormat | null | undefined): string {
  if (!video) return '';
  const codec = [videoCodec(video.codec), video.profile ?? ''].filter(Boolean).join(' ');
  const range = video.range === 'dv'
    ? [rangeLabel('dv', video.dvProfile ? `P${video.dvProfile}` : undefined), video.dvLayer?.toUpperCase() ?? ''].filter(Boolean).join(' ')
    : rangeLabel(video.range);
  return join([
    codec,
    video.bitDepth && !/10|12/.test(video.profile ?? '') ? `${number(video.bitDepth)}-bit` : '',
    size(video.width, video.height),
    video.frameRate ? frameRateLabel(video.frameRate) : '',
    video.interlaced ? msg('player.format.interlaced') : '',
    range,
  ]);
}

function matchLabel(rate: MatchState | undefined, range: MatchState | undefined): string {
  if (!rate && !range) return '';
  if (rate === 'unsupported' && range === 'unsupported') return '';
  if (rate === range) return msg(`player.format.match.${rate}`);
  return join([
    rate && rate !== 'unsupported' ? msg('player.format.matchRate', { state: msg(`player.format.match.${rate}`) }) : '',
    range && range !== 'unsupported' ? msg('player.format.matchRange', { state: msg(`player.format.match.${range}`) }) : '',
  ]);
}

export function videoOutputLine(out: VideoOutputFormat | null | undefined): string {
  if (!out) return '';
  const conversion = out.dvConversion ? msg(`player.format.dv.${out.dvConversion}`) : '';
  const range = out.range === 'dv' ? rangeLabel('dv', out.dvProfile) : rangeLabel(out.range);
  const mode = size(out.width, out.height) + (out.refreshRate ? ` @ ${number(out.refreshRate, { maximumFractionDigits: 3 })} Hz` : '');
  return join([
    [range, conversion ? `(${conversion})` : ''].filter(Boolean).join(' '),
    out.toneMapped ? msg('player.format.toneMapped') : '',
    out.deinterlaced ? msg('player.format.deinterlaced') : '',
    out.decoder ? msg(`player.format.decoder.${out.decoder}`) : '',
    mode,
    matchLabel(out.frameRateMatch, out.rangeMatch),
  ]);
}

export function audioSourceLine(audio: AudioSourceFormat | null | undefined): string {
  if (!audio) return '';
  const immersive = immersiveLabel(audio.immersive);
  const dts = audio.codec === 'dts' || audio.codec === 'dca';
  const codec = dts && audio.profile?.includes('MA') ? 'DTS-HD MA' : audioCodec(audio.codec);
  return join([
    [codec, immersive && !codec.includes(immersive) ? immersive : ''].filter(Boolean).join(' '),
    channelLabel(audio.channels, audio.layout),
    rateDepth(audio.sampleRate, audio.bitDepth),
  ]);
}

export function audioOutputLine(out: AudioOutputFormat | null | undefined): string {
  if (!out) return '';
  const codec = out.codec ? audioCodec(out.codec) : '';
  const head = join([
    msg(`player.format.delivery.${out.delivery}`),
    out.delivery === 'passthrough' || out.delivery === 'transcoded' || out.codec === 'apac' ? codec : '',
    channelLabel(out.channels, out.layout),
    rateDepth(out.sampleRate, out.bitDepth),
  ]);
  const carrier = out.carrier === 'mat'
    ? msg('player.format.carrier.mat')
    : out.carrier === 'iec61937'
      ? msg('player.format.carrier.bitstream')
      : out.carrier === 'lpcm'
        ? 'LPCM'
        : '';
  return join([
    head,
    // A passthrough is the source's own bitstream; "lossless" there would read as a claim about the codec.
    out.delivery === 'passthrough' ? '' : out.lossless === true ? msg('player.format.lossless') : out.lossless === false ? msg('player.format.lossy') : '',
    out.immersive ? immersiveLabel(out.immersive) : '',
    carrier,
    out.objectsActive ? msg('player.format.objects', { count: number(out.objectsActive) }) : '',
    out.downmixed ? msg('player.format.downmixed') : '',
    out.resampled ? msg('player.format.resampled') : '',
    out.exclusive ? msg('player.format.exclusive') : '',
    out.route ? msg(`player.format.route.${out.route}`) : '',
  ]);
}

export function formatLines(format: PlaybackFormat | null | undefined): FormatLines {
  return {
    video: videoSourceLine(format?.video),
    videoOut: videoOutputLine(format?.videoOut),
    audio: audioSourceLine(format?.audio),
    audioOut: audioOutputLine(format?.audioOut),
  };
}

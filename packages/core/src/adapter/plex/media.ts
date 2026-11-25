// Plex sections beyond movies and shows (docs/media-kinds.md): music (artist, album, track),
// photos (albums of photos and clips) and the multi-part movies Plex stacks from several files.
// Pure functions over Plex's own metadata shapes.
import type * as V from '../../wire';
import { photoFacts } from '../jellyfin/media';
import { skipMarkers } from '../../protocol/markers';

type Node = Record<string, any>;

/** Plex has no audiobook section type: a music section named for audiobooks holds books. */
export const isAudiobookSection = (section: Node) => section.type === 'artist' && /audio ?books?|hörbücher|livres audio/i.test(String(section.title ?? ''));

/** A photo album is a `photo` directory; a photo has media. */
export const isPhotoAlbum = (n: Node) => n.type === 'photo' && !n.Media?.length;
export const isPhotoAlbumKey = (key: string) => /^album:\d+$/.test(key);

/** The title projection of a Plex node, or undefined when it is not a title (a photo album). */
export function plexProjection(n: Node, audiobooks = false): { kind: V.TitleKind; media?: V.TitleMedia } | undefined {
  const id = (key: unknown) => key == null ? undefined : String(key);
  switch (n.type) {
    case 'movie': case 'clip': return { kind: 'movie' };
    case 'show': case 'season': case 'episode': return { kind: n.type };
    case 'artist': return { kind: 'show', media: { class: audiobooks ? 'audiobook' : 'music', role: 'artist', ...count(n.childCount) } };
    case 'album':
      if (audiobooks) return { kind: 'show', media: { class: 'audiobook', role: 'audiobook', ...count(n.leafCount), ...(n.parentTitle ? { credits: [{ name: n.parentTitle, role: 'author' }] } : {}) } };
      return { kind: 'season', media: { class: 'music', role: 'album', ...count(n.leafCount),
        ...(id(n.parentRatingKey) ? { parents: [{ id: id(n.parentRatingKey)!, name: n.parentTitle ?? '', role: 'artist' as const }] } : {}),
        ...(n.parentTitle ? { credits: [{ name: n.parentTitle, role: 'albumArtist' }] } : {}) } };
    case 'track': {
      const album = id(n.parentRatingKey), artist = id(n.grandparentRatingKey);
      if (audiobooks) return { kind: 'episode', media: { class: 'audiobook', role: 'part', ...count(n.index, 'index'),
        ...(album ? { parents: [{ id: album, name: n.parentTitle ?? '', role: 'audiobook' as const }] } : {}),
        ...(n.grandparentTitle ? { credits: [{ name: n.grandparentTitle, role: 'author' }] } : {}) } };
      return { kind: 'episode', media: { class: 'music', role: 'track', ...count(n.index, 'index'), ...count(n.parentIndex, 'disc'),
        parents: [...(album ? [{ id: album, name: n.parentTitle ?? '', role: 'album' as const }] : []), ...(artist ? [{ id: artist, name: n.grandparentTitle ?? '', role: 'artist' as const }] : [])],
        credits: [{ name: n.originalTitle || n.grandparentTitle || '', role: 'artist' }].filter(c => c.name) } };
    }
    case 'photo': return isPhotoAlbum(n) ? undefined : { kind: 'movie', media: { class: 'photo', role: 'item', ...photoFacts(n.Media?.[0]?.width, n.Media?.[0]?.height) } };
    default: return undefined;
  }
}
function count(n: unknown, key: 'childCount' | 'index' | 'disc' = 'childCount') {
  const value = Number(n);
  return Number.isFinite(value) && value > 0 ? { [key]: value } : {};
}

/** Plex names DTS audio `dca` (DTS-HD MA `dca-ma`); the protocol's FFmpeg-style codec token for it is `dts`. */
export const decoderAudioCodec = (codec: string) => codec === 'dca' || codec === 'dca-ma' ? 'dts' : codec;

/** A file's id among its title's media, as a start's `versionId` (or `mediaSourceId`) names it. */
export const mediaId = (media: Node, index: number) => String(media.id ?? index);

const RESOLUTIONS: Record<string, NonNullable<V.VersionItem['resolution']>> = { '4k': '4K', '1080': '1080p', '720': '720p', '576': '576p', '480': '480p', sd: 'SD' };
const TRANSFERS: Record<string, NonNullable<V.VersionItem['dynamicRange']>> = { smpte2084: 'hdr10', 'arib-std-b67': 'hlg', bt709: 'sdr' };
const RANGE_NAMES: Record<string, string> = { dv: 'Dolby Vision', hdr10: 'HDR10', hlg: 'HLG' };
/** Plex counts channels (8); versions name the layout (7.1), for the counts that have only one. */
const LAYOUTS: Record<string, string> = { 1: '1.0', 2: '2.0', 6: '5.1', 8: '7.1' };
/** Codec names as the version chips write them; any other codec is shown as Plex names it, in capitals. */
const CODEC_NAMES: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', aac: 'AAC', ac3: 'Dolby Digital', eac3: 'Dolby Digital+', truehd: 'TrueHD', dts: 'DTS', dca: 'DTS', dcama: 'DTS-HD MA' };
const codecName = (codec: string) => CODEC_NAMES[codec.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? codec.toUpperCase();
/**
 * One of a title's files as a version to choose: what Plex states about it (resolution, the video
 * stream's Dolby Vision profile or colour transfer, codecs, channels, size, and its optimized-copy
 * flag, `proxyType` 42). The first file is the one Plex plays by default; one without a part has
 * nothing to play.
 */
export function plexVersion(media: Node, index: number): V.VersionItem {
  const parts: Node[] = media.Part ?? [];
  const video = (parts[0]?.Stream ?? []).find((s: Node) => Number(s.streamType) === 1);
  const resolution = RESOLUTIONS[String(media.videoResolution ?? '').toLowerCase()];
  const dynamicRange = video?.DOVIProfile !== undefined ? 'dv' : TRANSFERS[String(video?.colorTrc ?? '')];
  const audioCodec = media.audioCodec ? decoderAudioCodec(String(media.audioCodec)) : undefined;
  const channels = LAYOUTS[String(media.audioChannels ?? '')];
  const sizes = parts.map(p => Number(p.size));
  const sizeBytes = sizes.length && sizes.every(n => n > 0) ? sizes.reduce((a, b) => a + b, 0) : undefined;
  const label = [
    [resolution, RANGE_NAMES[dynamicRange ?? ''], media.videoCodec && codecName(String(media.videoCodec))].filter(Boolean).join(' '),
    Number(media.proxyType) === 42 ? 'Optimized' : '',
    [media.audioCodec && codecName(String(media.audioCodec)), channels].filter(Boolean).join(' '),
  ].filter(Boolean).join(' · ') || `Version ${index + 1}`;
  return { id: mediaId(media, index), label, recommended: index === 0,
    ...(resolution ? { resolution } : {}), ...(dynamicRange ? { dynamicRange } : {}), ...(media.videoCodec ? { videoCodec: String(media.videoCodec) } : {}),
    ...(audioCodec ? { audio: { codec: audioCodec, ...(channels ? { channels } : {}) } } : {}),
    ...(sizeBytes ? { sizeBytes } : {}), availability: parts.length ? 'instant' : 'unavailable',
    ...(parts.length ? {} : { note: 'Plex lists no file for this version' }) };
}

/** Audio Vela plays as the file (what every platform's audio player decodes); the rest is transcoded to MP3. */
const DIRECT_AUDIO = ['mp3', 'mp4', 'm4a', 'm4b', 'aac', 'flac', 'wav'];
export function directAudio(media: Node): boolean {
  return DIRECT_AUDIO.includes(String(media.container ?? '').toLowerCase());
}
export function plexAudioMime(container: unknown): string {
  const value = String(container ?? '').toLowerCase();
  if (value === 'mp3') return 'audio/mpeg';
  if (['mp4', 'm4a', 'm4b', 'aac'].includes(value)) return 'audio/mp4';
  if (value === 'flac') return 'audio/flac';
  if (value === 'wav') return 'audio/wav';
  return 'audio/mpeg';
}

/** Where each part of a multi-part item starts on the item's timeline, in seconds. */
export function partOffsets(parts: Node[]): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const part of parts) { offsets.push(at); at += Math.max(0, Number(part.duration || 0) / 1000); }
  return offsets;
}
/** The part playing at a title position, and the position inside that part. */
export function partAt(parts: Node[], seconds: number): { index: number; offset: number; inPart: number } {
  const offsets = partOffsets(parts);
  let index = 0;
  for (let i = 0; i < offsets.length; i++) if (seconds >= offsets[i]!) index = i;
  return { index, offset: offsets[index] ?? 0, inPart: Math.max(0, seconds - (offsets[index] ?? 0)) };
}

/** Sidecar subtitle codecs Plex serves as text, converted to WebVTT on request (`format=vtt`). */
const TEXT_SIDECARS = ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'text'];
export const isTextSidecar = (codec: unknown) => TEXT_SIDECARS.includes(String(codec ?? '').toLowerCase());

/**
 * How a text sidecar (a stream with a `key`, at `url`: its credential-free address) reaches the
 * player. ASS and SSA come as the file itself (`{key}.ass`, in UTF-8) when the player names the
 * codec among its subtitle formats, so its styles and positions survive; anything else, and ASS
 * for a player that does not draw it, is converted to WebVTT by the server.
 */
export function plexSidecar(url: URL, codec: unknown, subtitleFormats: readonly string[]): { url: string; format: 'ass' | 'webvtt' } {
  const u = new URL(url.href);
  const name = String(codec ?? '').toLowerCase();
  if ((name === 'ass' || name === 'ssa') && subtitleFormats.includes(name)) {
    if (!/\.[a-z0-9]+$/i.test(u.pathname)) u.pathname += '.ass';
    u.searchParams.set('encoding', 'utf-8');
    return { url: u.href, format: 'ass' };
  }
  u.searchParams.set('format', 'vtt');
  return { url: u.href, format: 'webvtt' };
}

/**
 * A title's intro and credits markers (`includeMarkers=1`: `Marker` ranges in milliseconds) as the
 * plan carries them; Plex flags the tail credits `final`. Undefined when it has none.
 */
export function plexMarkers(n: Node): V.SkipMarker[] | undefined {
  const flag = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';
  const ranges = (Array.isArray(n.Marker) ? n.Marker : []).flatMap((m: Node): V.SkipMarker[] => m.type === 'intro' || m.type === 'credits'
    ? [{ kind: m.type, startSeconds: Number(m.startTimeOffset) / 1000, endSeconds: Number(m.endTimeOffset) / 1000, ...(flag(m.final) ? { final: true } : {}) }]
    : []);
  return skipMarkers(ranges, Number(n.duration) > 0 ? Number(n.duration) / 1000 : undefined);
}

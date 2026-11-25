// Plex sections beyond movies and shows (docs/media-kinds.md): music (artist, album, track),
// photos (albums of photos and clips) and the multi-part movies Plex stacks from several files.
// Pure functions over Plex's own metadata shapes.
import type * as V from '../../wire';
import { photoFacts } from '../jellyfin/media';

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

/**
 * What Plex's stream will deliver, from its transcode decision: the output media it describes
 * (copied or transcoded video, in kb/s). Without an output size there is no reliable target, and
 * the stream stays out of the numbered qualities.
 */
export function decidedQuality(decision: Node): V.QualityTarget | undefined {
  const media: Node | undefined = decision.Metadata?.[0]?.Media?.[0];
  const width = Number(media?.width), height = Number(media?.height), bitrate = Number(media?.bitrate);
  if (!media || !(width > 0) || !(height > 0)) return undefined;
  const video = String(media.videoCodec ?? '').toLowerCase();
  return { width, height, bitrate: bitrate > 0 ? bitrate * 1000 : 0,
    ...(video === 'h264' || video === 'hevc' ? { codec: video } : video ? { videoCodec: video } : {}) };
}

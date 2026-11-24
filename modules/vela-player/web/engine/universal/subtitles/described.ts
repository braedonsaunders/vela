// Subtitle tracks the server describes (external sidecars), as overlay tracks: listed when the
// source opens, and joined later when a newer plan of the same source adds one (a subtitle
// downloaded mid-session).
import type { SubtitleDescription, SubtitleTrack } from './types';

export function externalTrack(description: SubtitleDescription): SubtitleTrack | null {
  const codec = externalCodec(description);
  if (!codec || !description.delivery || description.delivery.kind === 'embedded') return null;
  return {
    id: description.id,
    serverId: description.id,
    streamIndex: description.streamIndex ?? null,
    containerTrackId: null,
    codec,
    label: (description.label ?? `${description.language ?? 'und'} ${codec.toUpperCase()}`).slice(0, 512),
    language: (description.language ?? 'und').slice(0, 64),
    default: false,
    forced: false,
    delivery: description.delivery,
  };
}
function externalCodec(description: SubtitleDescription): SubtitleTrack['codec'] | null {
  const format =
    description.delivery?.kind === 'external'
      ? description.delivery.format
      : description.codec?.toLowerCase();
  return format === 'webvtt-window' || format === 'vtt'
    ? 'webvtt'
    : format === 'sup' || format === 'hdmv_pgs_subtitle'
      ? 'pgs'
      : format === 'dvd_subtitle' || format === 'dvdsub'
        ? 'vobsub'
      : format === 'subrip'
        ? 'srt'
        : format === 'mov_text'
          ? 'tx3g'
          : ['srt', 'webvtt', 'ass', 'ssa', 'pgs', 'vobsub', 'tx3g'].includes(format ?? '')
            ? (format as SubtitleTrack['codec'])
            : description.delivery?.kind === 'burn-in'
              ? 'unknown'
              : null;
}

/** The list with every described sidecar it lacks appended, or null when nothing is new. */
export function withDescribed(tracks: readonly SubtitleTrack[], descriptions: readonly SubtitleDescription[]): SubtitleTrack[] | null {
  const next = [...tracks];
  for (const description of descriptions) {
    if (next.some((track) => track.serverId === description.id)) continue;
    const track = externalTrack(description);
    if (track) next.push(track);
  }
  return next.length > tracks.length ? next : null;
}

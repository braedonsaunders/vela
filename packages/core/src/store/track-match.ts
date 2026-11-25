// A viewer's audio or subtitle choice carried into a replacement session (playback.ts recovery).
// A track id names a stream of one file: on the same file it is reused as is, on another file it
// may be another language or a commentary. There the choice goes by what the track was, its
// language and its forced and hearing-impaired flags, and only when exactly one track fits.
// Without a file identity on either plan the id is reused, as before.
import type * as V from '../wire';

/** A chosen track: the file it was chosen on (the selected path's `sourceId`) and the track there. */
export interface TrackChoice { source: string | undefined; track: V.Track | undefined }

export function sourceOf(plan: V.PlaybackPlan | null | undefined): string | undefined {
  return plan?.paths?.find(path => path.id === plan.selectedPathId)?.sourceId || undefined;
}

export function trackChoice(plan: V.PlaybackPlan | null | undefined, tracks: V.Track[] | undefined, id: string | undefined): TrackChoice {
  return { source: sourceOf(plan), track: tracks?.find(track => track.id === id) };
}

/** The id in `tracks` (the replacement plan's) that carries choice `id`, or undefined to leave the server's own. */
export function carriedTrack(id: string, choice: TrackChoice | undefined, plan: V.PlaybackPlan, tracks: V.Track[]): string | undefined {
  const before = choice?.source, now = sourceOf(plan);
  if (!before || !now || before === now) return tracks.some(track => track.id === id) ? id : undefined;
  const was = choice?.track, language = languageOf(was);
  if (!was || !language) return undefined;
  const fits = tracks.filter(track => languageOf(track) === language && !!track.forced === !!was.forced && !!track.hearingImpaired === !!was.hearingImpaired);
  return fits.length === 1 ? fits[0]!.id : undefined;
}

function languageOf(track: V.Track | undefined): string {
  const language = track?.language?.trim().toLowerCase() ?? '';
  return language === 'und' ? '' : language;
}

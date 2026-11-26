// A viewer's audio or subtitle choice carried into a replacement session (playback.ts recovery).
// A track id names a stream of one file: on the same file it is reused as is, on another file it
// may be another language or a commentary. There the choice goes by what the track was, its
// language (any code for it: 'en', 'eng') and its forced and hearing-impaired flags, and only when
// exactly one track fits.
// Without a file identity on either plan the id is reused when the track it names there is the
// same language (or both have none) with the same flags; otherwise the choice goes by what the track was.
import type * as V from '../wire';
import { sameLanguage } from '../subtitle-languages';

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
  const before = choice?.source, now = sourceOf(plan), was = choice?.track;
  const same = tracks.find(track => track.id === id);
  if (before && now && before === now) return same ? id : undefined;
  // Unknown identity: the id is kept when its track there is what was chosen (both of no language
  // counts), or when nothing is known of the chosen track.
  if ((!before || !now) && same && (!was || fits(same, was) || (!languageOf(same) && !languageOf(was) && alike(same, was)))) return id;
  if (!was || !languageOf(was)) return undefined;
  const found = tracks.filter(track => fits(track, was));
  return found.length === 1 ? found[0]!.id : undefined;
}

/** `track` is in the language `was` was in (both named) and has its forced and hearing-impaired flags. */
function fits(track: V.Track, was: V.Track): boolean {
  const language = languageOf(was), other = languageOf(track);
  return !!language && !!other && sameLanguage(other, language) && sameScript(other, language) && alike(track, was);
}

const alike = (a: V.Track, b: V.Track) => !!a.forced === !!b.forced && !!a.hearingImpaired === !!b.hearingImpaired;

/** False when both codes name a script and they differ ('zh-Hant', 'zh-Hans'). */
function sameScript(a: string, b: string): boolean {
  const left = scriptOf(a), right = scriptOf(b);
  return !left || !right || left === right;
}
const scriptOf = (code: string) => code.split(/[-_]/).slice(1).find(part => /^[a-z]{4}$/i.test(part))?.toLowerCase();

/** The track's language code, or '' when it has none or it is undetermined. */
function languageOf(track: V.Track | undefined): string {
  const language = track?.language?.trim() ?? '';
  return language.toLowerCase() === 'und' ? '' : language;
}

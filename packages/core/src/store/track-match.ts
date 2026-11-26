// A viewer's audio or subtitle choice carried into a replacement session (playback.ts recovery).
// A track id names a stream of one file: on the same file it is reused as is, on another file it
// may be another language or a commentary. There the choice goes by what the track was, its
// language (any code for it: 'en', 'eng') and its forced and hearing-impaired flags; when several
// fit, the one series-tracks.ts matchTrack picks when the episode is opened (region, then codec family), or none.
// A plan names its file by the selected path's sourceId, else by its version id. A version row alone
// (selectedVersionId) tells two files apart but is no proof of the same file: Auto or a quality row can
// play another release. Without a file identity on either plan, or with only an equal row, the id is
// reused when the track it names there is the same language (or both have none) with the same flags and
// matchTrack does not prefer another; otherwise the choice goes by what the track was, and a track its
// own plan did not list is not carried.
import type * as V from '../wire';
import { sameLanguage } from '../subtitle-languages';
import { matchTrack, trackChoiceOf } from '../series-tracks';

/** A chosen track: the file it was chosen on (`sourceOf`) and the track there. */
export interface TrackChoice { source: string | undefined; track: V.Track | undefined }

/** The file a plan plays: its selected path's `sourceId`; without one, the release playing (`playingVersionId`,
 * or `selectedVersionId` when the plan does not say which plays); undefined when nothing names it. The
 * row alone tells files apart but an equal row does not prove the same file (`rowOnly`). */
export function sourceOf(plan: V.PlaybackPlan | null | undefined): string | undefined {
  if (!plan) return undefined;
  const version = plan.playingVersionId !== undefined ? plan.playingVersionId : plan.selectedVersionId;
  return plan.paths?.find(path => path.id === plan.selectedPathId)?.sourceId || version || undefined;
}

/** The file a plan plays when something more than its version row names it (`sourceOf`), else undefined. */
export function fileOf(plan: V.PlaybackPlan | null | undefined): string | undefined {
  return plan && !rowOnly(plan) ? sourceOf(plan) : undefined;
}

/** Only the plan's version row names its file: no `sourceId` and no release playing. */
function rowOnly(plan: V.PlaybackPlan): boolean {
  return !plan.paths?.find(path => path.id === plan.selectedPathId)?.sourceId && plan.playingVersionId === undefined;
}

export function trackChoice(plan: V.PlaybackPlan | null | undefined, tracks: V.Track[] | undefined, id: string | undefined): TrackChoice {
  return { source: sourceOf(plan), track: tracks?.find(track => track.id === id) };
}

/** The id in `tracks` (the replacement plan's) that carries choice `id`, or undefined to leave the server's own. */
export function carriedTrack(id: string, choice: TrackChoice | undefined, plan: V.PlaybackPlan, tracks: V.Track[]): string | undefined {
  const before = choice?.source, now = sourceOf(plan), was = choice?.track;
  const same = tracks.find(track => track.id === id);
  const unknown = !before || !now || (before === now && rowOnly(plan));
  if (!unknown && before === now) return same ? id : undefined;
  // Unknown identity: the id is kept when its track there is what was chosen (both of no language
  // counts) and no other track is the better match; with nothing known of the chosen track there is
  // nothing to compare, and it is not kept.
  if (unknown && same && was && !languageOf(same) && !languageOf(was) && alike(same, was)) return id;
  if (!was || !languageOf(was)) return undefined;
  const found = tracks.filter(track => fits(track, was));
  if (found.length < 2) return found[0]?.id;
  // Several fit: the one a remembered series choice is matched to at the start of an episode.
  const traits = trackChoiceOf(was);
  const matched = traits ? matchTrack(found, traits, was.kind)?.id : undefined;
  return matched ?? (unknown && same && found.includes(same) ? id : undefined);
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

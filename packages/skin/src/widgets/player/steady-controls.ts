// When the player's controls may skip a redraw (bars.tsx): one that only moved the clock. Pure.
import type { PlayerChromeState } from './context';
import type { PlayerView } from './present';

/** The controls' props as far as this needs them (bars.tsx BottomProps). */
export interface ControlProps {
  view: PlayerView;
  state: PlayerChromeState;
  live: { live: boolean; archive?: unknown };
  opened: string | null;
  [prop: string]: unknown;
}

/** What of the view only the clock moves: the timeline and the info card read these, the controls do not. */
const CLOCK_VIEW = new Set<keyof PlayerView>(['position', 'progress', 'elapsed', 'remaining', 'buffered', 'stats']);
/** What of the chrome's state the controls read. */
const CONTROL_STATE: (keyof PlayerChromeState)[] = ['plan', 'switchVersion', 'pendingVersionId', 'versionMessage', 'pendingQualityId',
  'streaming', 'episode', 'sleep', 'nextEpisode', 'picture', 'refreshVersions'];

/**
 * The controls draw nothing from the clock: a redraw that only moved it (once a second while the chrome
 * stands) leaves them as they are. Not on a live picture (its controls read the window, which moves), nor
 * with the chapter strip open (it marks the position). The chrome hands them stable callbacks (chrome.tsx),
 * so every other prop is compared as it is.
 */
export function sameControls(a: ControlProps, b: ControlProps): boolean {
  if (a.live.live || b.live.live || a.live.archive || b.live.archive || b.opened === 'chapters') return false;
  for (const key of Object.keys(b) as (keyof ControlProps)[]) {
    if (key === 'view' || key === 'state' || key === 'live') continue;
    if (!Object.is(a[key], b[key])) return false;
  }
  for (const key of Object.keys(b.view) as (keyof PlayerView)[]) {
    if (!CLOCK_VIEW.has(key) && !Object.is(a.view[key], b.view[key])) return false;
  }
  return CONTROL_STATE.every(key => Object.is(a.state[key], b.state[key]));
}


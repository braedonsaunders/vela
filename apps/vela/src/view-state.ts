// The view state documents read beside the data: open flags (menus, panels), the chosen season,
// each row pager's ends, the hero on show (rotating every 9 seconds unless motion is reduced, a
// query is open or the hero's trailer is playing), and the system's reduced-motion setting.
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { Env } from '@vela/skin';
import { shouldRotateHero } from '@vela/skin/src/hero-rotation';
import { withPager } from './pagers';

const HERO_SECONDS = 9;

export interface ViewState {
  flags: string[];
  setFlag(flag: string, on: boolean): void;
  toggleFlag(flag: string): void;
  /** Open this flag alone (keep- flags stay); pressed again it closes. */
  onlyFlag(flag: string): void;
  resetFlags(): void;
  season: string;
  setSeason(id: string): void;
  /** Each route's row pagers, by route (`route:entry`): a row reporting its ends changes its own
   * route's environment, not every retained route's. */
  pagers: Record<string, Env['pagers']>;
  setPager(scope: string, rowId: string, state: { atStart: boolean; atEnd: boolean }): void;
  heroIndex: number;
  setHeroIndex(index: number): void;
  still: boolean;
}

export function useViewState(heroCount: number, query: string, heroPreviewing: boolean, onHome = true): ViewState {
  const [flags, setFlags] = useState<string[]>([]);
  const [season, setSeason] = useState('');
  const [pagers, setPagers] = useState<Record<string, Env['pagers']>>({});
  const [heroIndex, setHeroIndex] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => subscription.remove();
  }, []);

  // A playing hero trailer holds the hero on show, as compiled Cinematic did; rotation resumes when it stops.
  const rotating = shouldRotateHero({ onHome, heroCount, still, query, heroPreviewing, flags });
  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(() => setHeroIndex(i => (i + 1) % heroCount), HERO_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [rotating, heroCount, heroIndex]);

  const setFlag = useCallback((flag: string, on: boolean) => {
    setFlags(list => {
      if (on) return list.includes(flag) ? list : [...list, flag];
      // An unchanged list stays the same value: every route's host follows it.
      return list.includes(flag) ? list.filter(f => f !== flag) : list;
    });
  }, []);
  const toggleFlag = useCallback((flag: string) => {
    setFlags(list => (list.includes(flag) ? list.filter(f => f !== flag) : [...list, flag]));
  }, []);
  const onlyFlag = useCallback((flag: string) => {
    setFlags(list => (list.includes(flag) ? list.filter(f => f !== flag) : [...list.filter(f => f.startsWith('keep-')), flag]));
  }, []);
  const resetFlags = useCallback(() => setFlags(list => list.every(f => f.startsWith('keep-')) ? list : list.filter(f => f.startsWith('keep-'))), []);
  const setPager = useCallback((scope: string, rowId: string, state: { atStart: boolean; atEnd: boolean }) => {
    // A pager report redraws its route: as a transition, a press that arrives meanwhile is not held behind it.
    startTransition(() => setPagers(all => withPager(all, scope, rowId, state)));
  }, []);

  return useMemo(() => ({
    flags,
    setFlag,
    toggleFlag,
    onlyFlag,
    resetFlags,
    season,
    setSeason,
    pagers,
    setPager,
    heroIndex: heroCount ? heroIndex % heroCount : 0,
    setHeroIndex,
    still,
  }), [flags, setFlag, toggleFlag, onlyFlag, resetFlags, season, pagers, setPager, heroCount, heroIndex, still]);
}

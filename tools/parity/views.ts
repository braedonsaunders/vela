// The Sports parity matrix: which views are captured, at which viewports, and how each variant
// (the legacy hard-coded screen, the plugin document) reaches them. Every capture runs against the
// frozen mock (VELA_MOCK_SPORTS_FREEZE=1), so the two variants show the same state.

export type Variant = 'legacy' | 'document';

export interface Viewport { name: string; width: number; height: number; touch?: boolean }

export const WEB_VIEWPORTS: Viewport[] = [
  { name: 'web-1440', width: 1440, height: 900 },
  { name: 'web-1920', width: 1920, height: 1080 },
  { name: 'web-1024', width: 1024, height: 768, touch: true },
  { name: 'web-390', width: 390, height: 844, touch: true },
];

/** Mock knobs (POST /__admin/sports) a view needs; every view starts from DEFAULT_KNOBS. */
export interface Knobs { spoilerFree?: boolean; screenDelayMs?: number; screenFail?: boolean; favourites?: string[] | null }
export const DEFAULT_KNOBS: Required<Knobs> = { spoilerFree: false, screenDelayMs: 0, screenFail: false, favourites: null };

export interface View {
  name: string;
  /** What the view shows, for the index and the report. */
  description: string;
  /** The Sports index, or a game page by event id. */
  page: { index: true } | { game: string };
  knobs?: Knobs;
  /** Wait for this (a data-testid prefix, or text:…) before capturing. */
  ready: string;
  /** Scroll this (a data-testid prefix, or text:…) to the top of the viewport first. */
  scrollTo?: string;
  /** Reviewed rather than pixel-diffed (today's known phone defects the documents fix). */
  review?: string;
  /** Only at these viewports. */
  only?: string[];
}

const EVENT = (id: string) => `sports:sports:${id}`;
export const GAMES = { live: EVENT('nfl-nyg-phi'), final: EVENT('nba-mil-tor'), finalOT: EVENT('nhl-nyr-bos'), upcoming: EVENT('nba-bos-nyk'),
  spoiler: EVENT('epl-che-mci'), field: EVENT('f1-las-vegas') } as const;

export const VIEWS: View[] = [
  { name: 'index-top', description: 'Sports index, top: hero, companions, leagues, Your teams, Live now', page: { index: true }, ready: 'sports-hero' },
  { name: 'index-schedule', description: 'Schedule (today) and standings', page: { index: true }, ready: 'sports-hero', scrollTo: 'text:Schedule' },
  { name: 'index-teams', description: 'Standings and the team picker', page: { index: true }, ready: 'sports-hero', scrollTo: 'text:Pick your teams' },
  { name: 'index-spoiler-free', description: 'Index with Hide scores on', page: { index: true }, knobs: { spoilerFree: true }, ready: 'sports-hero' },
  { name: 'index-no-favourites', description: 'Index with no favourite teams (empty Your teams)', page: { index: true }, knobs: { favourites: [] }, ready: 'sports-hero' },
  { name: 'index-loading', description: 'Index while the first read is pending', page: { index: true }, knobs: { screenDelayMs: 600_000 }, ready: 'sports-skeleton' },
  { name: 'index-failure', description: 'Index when the first read fails', page: { index: true }, knobs: { screenFail: true }, ready: 'text:Try again' },
  { name: 'game-live', description: 'Game page, live NFL (graph, tables, plays)', page: { game: GAMES.live }, ready: 'sports-game' },
  { name: 'game-live-lower', description: 'Game page, live NFL, scrolled to plays', page: { game: GAMES.live }, ready: 'sports-game', scrollTo: 'text:Plays' },
  { name: 'game-final', description: 'Game page, final NBA', page: { game: GAMES.final }, ready: 'sports-game' },
  { name: 'game-final-ot', description: 'Game page, final NHL in overtime', page: { game: GAMES.finalOT }, ready: 'sports-game' },
  { name: 'game-upcoming', description: 'Game page, upcoming NBA', page: { game: GAMES.upcoming }, ready: 'sports-game' },
  { name: 'game-spoiler', description: 'Game page, final with scores hidden (reveal panel)', page: { game: GAMES.spoiler }, ready: 'sports-game' },
  { name: 'game-field', description: 'Game page, an N-competitor event (F1)', page: { game: GAMES.field }, ready: 'sports-game' },
  { name: 'game-loading', description: 'Game page while its read is pending', page: { game: GAMES.live }, knobs: { screenDelayMs: 600_000 }, ready: 'wait:2500' },
  { name: 'game-failure', description: 'Game page when its read fails', page: { game: GAMES.live }, knobs: { screenFail: true }, ready: 'text:Try again' },
];

/** The views compared by review, not pixels, at a viewport. */
export function reviewed(view: View, viewport: string): string | undefined {
  if (viewport === 'web-390' && (view.name === 'index-top' || view.name === 'index-spoiler-free' || view.name === 'index-no-favourites'))
    return 'Phone hero: today truncates both team names to one letter at 390 px; the document wraps short names under the crests (a fix, reviewed).';
  return view.review;
}

/** Where a variant draws a page, on the web. Each URL names its variant with the parity flag
 * (`?screens=1` documents, `?screens=0` legacy; the flag exists until the hard cut), so a capture
 * never depends on how Metro was started. */
export function webPath(variant: Variant, page: View['page']): string {
  if ('index' in page) return variant === 'legacy' ? '/screen/sports?screens=0' : '/screen/sports?screens=1';
  const event = encodeURIComponent(page.game);
  return variant === 'legacy' ? `/game/${event}` : `/screen/sports/game?event=${encodeURIComponent(`event:${page.game}`)}&screens=1`;
}

/** A data-testid prefix, `text:…` or `wait:ms`, as a CSS/Playwright selector (or a wait). */
export function target(spec: string): { selector: string } | { wait: number } {
  if (spec.startsWith('wait:')) return { wait: Number(spec.slice(5)) || 0 };
  if (spec.startsWith('text:')) return { selector: `text="${spec.slice(5)}"` };
  return { selector: `[data-testid^="${spec}"]` };
}

/** The capture's file name. */
export const captureName = (viewport: string, view: string) => `${viewport}--${view}.png`;

/** Regions of a platform's capture that belong to the device, not the app, and are left out of
 * every comparison there: the iPhone Duo cover display's camera and status island (its clock). */
export const DEVICE_MASKS: Record<string, { x: number; y: number; width: number; height: number }[]> = {
  'ios-phone': [{ x: 1150, y: 0, width: 248, height: 360 }],
};

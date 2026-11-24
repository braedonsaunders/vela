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
/** Views compared by review, with the reason (a one-line, written acceptance). */
export const REVIEWED_VIEWS: { viewports: RegExp; views: string[]; reason: string }[] = [
  { viewports: /^web-390$/, views: ['index-top', 'index-spoiler-free', 'index-no-favourites'],
    reason: 'Phone hero: names wrap under the crests (legacy truncated them), and without Watch from start (Ether v1) the hero is one button shorter, so the page below moves up' },
  { viewports: /^web-(1024|390)$/, views: ['index-schedule', 'index-teams'],
    reason: 'Standings light the viewer\'s team row (legacy meant to but compared full names with short cells); on the phone the schedule row sizes to all its cards (legacy\'s virtualised row left out the taller F1 card), so what follows sits 2.5 px lower' },
  { viewports: /^tvos$/, views: ['index-top', 'index-spoiler-free', 'index-no-favourites'],
    reason: 'TV index: the day strip shows 7 days (Ether) where legacy showed 8; the shell navigation (not Sports) changed between the legacy capture and now; legacy\'s first TV focus fell on Watch or Game details by the focus engine, the document focuses Game details' },
  { viewports: /^androidtv$/, views: ['index-top', 'index-spoiler-free', 'index-no-favourites'],
    reason: 'Android TV index: the day strip shows 7 days (Ether) where legacy showed 8; legacy\'s first focus landed on the shell navigation (Home), the document focuses the hero by the design\'s initial-focus rule (as legacy did on Apple TV)' },
  { viewports: /^(tvos|androidtv)$/, views: ['game-final', 'game-spoiler'],
    reason: 'Watch from start is absent (Ether v1 sends no catch-up targets); legacy showed it for this archived final, so the pills after it sit one button to the left' },
  { viewports: /^ios-phone$/, views: ['game-spoiler'],
    reason: 'Watch from start is absent (Ether v1 sends no catch-up targets); legacy showed it for this archived final, so the pills after it sit one button to the left' },
];

export function reviewed(view: View | { name: string; review?: string }, viewport: string): string | undefined {
  return REVIEWED_VIEWS.find(r => r.viewports.test(viewport) && r.views.includes(view.name))?.reason ?? view.review;
}

/** Where the document variant draws a page (`screen/[id]` and `screen/[id]/[page]`). The legacy
 * hard-coded Sports was deleted in the hard cut: its captures are archived baselines, and capturing
 * the legacy variant is refused rather than silently drawing documents. */
export function webPath(variant: Variant, page: View['page']): string {
  if (variant === 'legacy') throw new Error('legacy Sports was removed in the hard cut; compare against the archived legacy captures');
  if ('index' in page) return '/screen/sports';
  return `/screen/sports/game?event=${encodeURIComponent(`event:${page.game}`)}`;
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

/** Differences reviewed and accepted in writing, found by selector in each document capture and
 * left out of the pixel comparison (listed in the report instead). The box is the union of the
 * matches, widened to the full viewport width (a row that scrolls sideways). */
export const REVIEWED_REGIONS: { selector: string; note: string }[] = [
  { selector: '[role="tab"][data-testid^="sports-day-"]', note: 'Schedule day strip: Ether serves 7 days (-2..+4), legacy showed 8 (-3..+4); decided with Ether' },
  { selector: '[data-testid="sports-watch-row"], [data-testid="sports-hero-actions"]', note: 'Watch rows: Ether v1 sends no catch-up targets, so legacy\'s Watch from start (where the archive held the game) is absent; the rows are compared by review' },
];

/** Screenshot pixels per point (CSS px) on each capture platform, so a move is judged in points. */
export const CAPTURE_SCALE: Record<string, number> = { tvos: 2, 'ios-phone': 3, androidtv: 1 };

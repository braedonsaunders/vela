// A watched position applied to models already drawn, before the server's answer arrives: the
// title's resume point, its cards' progress (Continue Watching, the hero) and the hero's resume
// detail. The server's next read replaces these with its own.
import type { Card, DetailModel, HeroAction, HomeModel, Row } from '../models';
import { clock, duration as timeLeft, msg, percent } from '../i18n';

/** Where the viewer left a title: a position, or finished. */
export interface Watched {
  titleId: string;
  positionSeconds: number;
  finished: boolean;
}

function card(value: Card, watched: Watched): Card {
  if (value.id !== watched.titleId) return value;
  const position = watched.finished ? 0 : watched.positionSeconds;
  const duration = value.durationSeconds;
  return {
    ...value,
    progressSeconds: position,
    played: watched.finished || value.played,
    progressLabel: duration ? percent(Math.min(1, Math.max(0, position / duration))) : '',
  };
}

function heroAction(action: HeroAction, hero: Card | undefined, watched: Watched): HeroAction {
  if (action.heroId !== watched.titleId || action.action !== 'resume' || !hero) return action;
  const duration = hero.durationSeconds;
  const position = watched.finished ? 0 : watched.positionSeconds;
  const remaining = duration > position ? duration - position : 0;
  return {
    ...action,
    progress: duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0,
    actionDetail: remaining > 0 ? msg('hero.detail.remaining', { time: timeLeft(remaining) }) : '',
  };
}

export function homeWatched(home: HomeModel, watched: Watched): HomeModel {
  const hero = home.hero.map(value => card(value, watched));
  // Rows that do not show the title keep their objects, so only what changed draws again.
  const rows = home.rows.map(row => {
    if (!row.items.some(value => value.id === watched.titleId)) return row;
    return { ...row, items: row.items.map(value => card(value, watched)) };
  });
  return {
    ...home,
    hero,
    heroActions: home.heroActions.map(action => heroAction(action, hero.find(h => h.id === action.heroId), watched)),
    rows,
  };
}

const progressRow = (row: Row) => row.purpose === 'continue' || row.purpose === 'nextUp';

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * A fresh card drawn over the one already shown. The shown object when nothing about it changed,
 * so nothing draws again; otherwise the fresh card with the shown artwork, so a picture re-signed
 * for the same title is never reloaded and faded in again while the viewer looks at it.
 */
export function freshCard(shown: Card | undefined, fresh: Card): Card {
  if (!shown || shown.id !== fresh.id) return fresh;
  const next: Card = { ...fresh, poster: shown.poster || fresh.poster, backdrop: shown.backdrop || fresh.backdrop, logo: shown.logo || fresh.logo,
    ...(shown.thumbnail || fresh.thumbnail ? { thumbnail: shown.thumbnail || fresh.thumbnail } : {}) };
  return sameValue(shown, next) ? shown : next;
}

/** A fresh row drawn over the one already shown: the shown object when nothing changed, and every
 * card it still holds through freshCard. */
export function freshRow(shown: Row | undefined, fresh: Row): Row {
  if (!shown) return fresh;
  const known = new Map(shown.items.map(value => [value.id, value]));
  const items = fresh.items.map(value => freshCard(known.get(value.id), value));
  const next = { ...fresh, items };
  const sameItems = items.length === shown.items.length && items.every((value, index) => value === shown.items[index]);
  return sameItems && sameValue({ ...shown, items: [] }, { ...next, items: [] }) ? shown : next;
}

/** A card's progress (where the viewer is, finished, a book's place) taken from a fresh copy of it. */
function withProgress(shown: Card, fresh: Card | undefined): Card {
  if (!fresh) return shown;
  const media = shown.media && fresh.media ? { ...shown.media, readingFraction: fresh.media.readingFraction, readingLocator: fresh.media.readingLocator, readingLabel: fresh.media.readingLabel } : shown.media;
  const next: Card = { ...shown, progressSeconds: fresh.progressSeconds, progressLabel: fresh.progressLabel, played: fresh.played, ...(media ? { media } : {}) };
  return sameValue(shown, next) ? shown : next;
}

/**
 * Bring shown rows up to date with a fresh read of the same shelf, in place: progress shelves
 * (Continue Watching, Reading, Listening, Next Up) take the fresh row, other shelves keep their
 * exact objects, order and appended pages with only their cards' progress refreshed, and new
 * progress shelves are inserted beside the rows they were next to. Nothing unchanged is replaced,
 * so a page underneath a modal updates without a flash. `complete`: the fresh read is the whole
 * shelf list, so a progress shelf it no longer has (a book finished) is removed. Otherwise (Home's
 * first page) a missing progress shelf is removed only when it sat among the rows the fresh page
 * covers; one further down came with a later page and is kept, or taken from `later` (those
 * shelves read again one by one).
 */
export function reconcileProgressRows(current: Row[], fresh: Row[], complete: boolean, later: Row[] = []): Row[] {
  const freshRows = new Map([...later, ...fresh].map(row => [row.id, row]));
  const firstPage = new Set(fresh.map(row => row.id));
  const covered = (index: number) => current.slice(index + 1).some(row => firstPage.has(row.id));
  const freshCards = new Map<string, Card>();
  for (const row of fresh) for (const value of row.items) if (!freshCards.has(value.id)) freshCards.set(value.id, value);
  const rows: Row[] = [];
  current.forEach((row, index) => {
    const next = freshRows.get(row.id);
    if (progressRow(row)) {
      if (next) rows.push(freshRow(row, next));
      else if (!complete && !covered(index)) rows.push(row);
      return;
    }
    const items = row.items.map(value => withProgress(value, freshCards.get(value.id)));
    rows.push(items.every((value, at) => value === row.items[at]) ? row : { ...row, items });
  });
  // New progress shelves, before the first row that followed them in the fresh read (else after
  // the nearest one before them, else first).
  const shown = new Set(rows.map(row => row.id));
  fresh.forEach((row, index) => {
    if (!progressRow(row) || shown.has(row.id)) return;
    const after = fresh.slice(index + 1).find(next => shown.has(next.id));
    const before = [...fresh.slice(0, index)].reverse().find(previous => shown.has(previous.id));
    const at = after ? rows.findIndex(value => value.id === after.id) : before ? rows.findIndex(value => value.id === before.id) + 1 : 0;
    rows.splice(at, 0, row);
    shown.add(row.id);
  });
  return rows.length === current.length && rows.every((row, index) => row === current[index]) ? current : rows;
}

/**
 * Replace only Home's server-owned progress shelves (reconcileProgressRows): other shelves keep
 * their exact objects and order (including pages appended by moreRows), and a progress shelf from
 * a later page that the fresh first page does not carry is kept.
 */
export function reconcileHomeProgress(current: HomeModel, fresh: HomeModel, later: Row[] = []): HomeModel {
  const rows = reconcileProgressRows(current.rows, fresh.rows, false, later);
  const freshHeroes = new Map(fresh.hero.map(hero => [hero.id, hero]));
  const hero = current.hero.map(value => {
    const next = freshHeroes.get(value.id);
    if (!next || value.progressSeconds === next.progressSeconds && value.progressLabel === next.progressLabel && value.played === next.played) return value;
    return { ...value, progressSeconds: next.progressSeconds, progressLabel: next.progressLabel, played: next.played };
  });
  const freshActions = new Map(fresh.heroActions.map(action => [action.heroId, action]));
  const heroActions = current.heroActions.map(action => {
    const next = freshActions.get(action.heroId);
    return next && (action.action === 'resume' || next.action === 'resume') && !sameValue(action, next) ? next : action;
  });
  const same = rows === current.rows && hero.every((value, index) => value === current.hero[index]) && heroActions.every((value, index) => value === current.heroActions[index]);
  return same ? current : { ...current, hero, heroActions, rows };
}

/** Home's progress shelves the fresh first page does not carry and does not cover (they came with
 * a later page): each is read again on its own. */
export function laterProgressRows(current: HomeModel, fresh: HomeModel): Row[] {
  const firstPage = new Set(fresh.rows.map(row => row.id));
  return current.rows.filter((row, index) => progressRow(row) && !firstPage.has(row.id)
    && !current.rows.slice(index + 1).some(next => firstPage.has(next.id)));
}

export function detailWatched(detail: DetailModel, watched: Watched): DetailModel {
  const own = detail.title[0]?.id === watched.titleId;
  const position = watched.finished ? 0 : watched.positionSeconds;
  return {
    ...detail,
    title: detail.title.map(value => card(value, watched)),
    episodes: detail.episodes.map(value => card(value, watched)),
    ...(own ? { resumeSeconds: position, resumePosition: clock(position) } : {}),
  };
}

/** How far a server's recorded position may lag the player's last report and still agree. */
const AGREEMENT_SECONDS = 15;

/**
 * Whether a card the server sent already records where the viewer left the title. A server can
 * answer before it has stored the last report; such an answer is read again, not drawn.
 */
export function recorded(value: Card | undefined, watched: Watched): boolean {
  if (!value) return true;
  if (watched.finished) return value.played || value.progressSeconds === 0;
  return Math.abs(value.progressSeconds - watched.positionSeconds) <= AGREEMENT_SECONDS;
}

/** The card for the watched title among a detail's own and its episodes, if it shows one. */
export function detailCard(detail: DetailModel, titleId: string): Card | undefined {
  return detail.title.find(card => card.id === titleId) ?? detail.episodes.find(card => card.id === titleId);
}

/** The card for the watched title on home (hero or a row), if home shows one. */
export function homeCard(home: HomeModel, titleId: string): Card | undefined {
  return home.hero.find(card => card.id === titleId)
    ?? home.rows.flatMap(row => row.items).find(card => card.id === titleId);
}

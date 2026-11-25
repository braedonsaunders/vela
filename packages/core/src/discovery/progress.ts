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

/** A server-owned progress shelf: Continue Watching (Reading, Listening) or Next Up. */
export const progressRow = (row: Row) => row.purpose === 'continue' || row.purpose === 'nextUp';

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

/** What a row is, for matching it across reads without a key: a plugin's surface row by its plugin,
 * surface and library; a feed row by its purpose, name and library. */
function what(row: Row): string {
  if (row.surface) return `surface\u0000${row.plugin ?? ''}\u0000${row.surface}\u0000${row.library ?? ''}`;
  return `feed\u0000${row.purpose}\u0000${row.name}\u0000${row.library ?? ''}`;
}

/** What a row draws as: kept across reads that re-mint its id (Row.drawnAs), else its key, else its id. */
export const drawnAs = (row: Row): string => row.drawnAs ?? row.key ?? row.id;

/**
 * The same row in a newer read, for each fresh row that has one among `shown`: the same id; else
 * the same server key; else, when neither carries a key, the same surface (plugin, surface,
 * library) or the same purpose, name and library, provided exactly one row on each side has it.
 * A row the server re-minted (its id changes with the feed after playback) is still matched; two
 * rows that cannot be told apart are not.
 */
export function matchRows(shown: readonly Row[], fresh: readonly Row[]): Map<Row, Row> {
  const matched = new Map<Row, Row>();
  const taken = new Set<Row>();
  const take = (next: Row, value: Row | undefined) => { if (value && !taken.has(value)) { matched.set(next, value); taken.add(value); } };
  const byId = new Map(shown.map(row => [row.id, row]));
  for (const next of fresh) take(next, byId.get(next.id));
  const byKey = new Map(shown.flatMap(row => row.key ? [[row.key, row] as const] : []));
  for (const next of fresh) if (!matched.has(next) && next.key) take(next, byKey.get(next.key));
  const count = (rows: readonly Row[]) => rows.reduce((counts, row) => counts.set(what(row), (counts.get(what(row)) ?? 0) + 1), new Map<string, number>());
  const shownCount = count(shown), freshCount = count(fresh);
  const byWhat = new Map(shown.map(row => [what(row), row]));
  for (const next of fresh) {
    if (matched.has(next)) continue;
    const name = what(next), value = byWhat.get(name);
    // Two keys that differ are two rows, whatever they are called.
    if (value && next.key && value.key) continue;
    if (shownCount.get(name) === 1 && freshCount.get(name) === 1) take(next, value);
  }
  return matched;
}

/**
 * A fresh row drawn over the shown one it matched: the fresh row (its id, cursor, items in the
 * server's order) drawn as the shown row was (drawnAs), so it is not drawn again from scratch, with
 * every card it still holds (freshRow). A row the viewer paged further than the fresh read, whose
 * fresh items begin exactly as the shown ones, keeps the further items too, so what has focus stays.
 */
function adoptRow(shown: Row | undefined, fresh: Row): Row {
  if (!shown) return fresh;
  const drawn = drawnAs(shown);
  const further = fresh.continuation === 'more' && shown.items.length > fresh.items.length
    && fresh.items.every((value, index) => shown.items[index]?.id === value.id);
  const { drawnAs: _, ...own } = fresh;
  const next: Row = { ...own, ...(drawn !== (fresh.key ?? fresh.id) ? { drawnAs: drawn } : {}),
    ...(further ? { items: [...fresh.items, ...shown.items.slice(fresh.items.length)] } : {}) };
  return freshRow(shown, next);
}

/**
 * Take a fresh read of a page's rows over the rows on show. The fresh read decides which rows there
 * are, their ids and their order; a shown row it no longer has goes, and a shown row's old id is
 * never kept (a server re-mints row ids when the feed recomputes after playback, and the old id no
 * longer opens). What stays is what avoids a visible refresh: a row matched to a shown one
 * (matchRows) keeps its identity and its unchanged cards, and an unchanged row is the shown
 * object. Nothing changed: the very same list.
 */
export function adoptRows(current: Row[], fresh: Row[]): Row[] {
  const matched = matchRows(current, fresh);
  const rows = fresh.map(row => adoptRow(matched.get(row), row));
  return rows.length === current.length && rows.every((row, index) => row === current[index]) ? current : rows;
}

/**
 * A fresh Home read (its first page and any further pages read to cover what is shown) over Home on
 * show: the rows are the server's (adoptRows), with its cursor for the next page; the hero
 * carousel keeps its titles and order, taking their progress and resume actions from the read.
 */
export function adoptHome(current: HomeModel, fresh: HomeModel): HomeModel {
  const rows = adoptRows(current.rows, fresh.rows);
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
  const same = rows === current.rows && current.nextCursor === fresh.nextCursor && hero.every((value, index) => value === current.hero[index])
    && heroActions.every((value, index) => value === current.heroActions[index]);
  return same ? current : { ...current, hero, heroActions, rows, nextCursor: fresh.nextCursor };
}

/**
 * Home's progress shelves read again on their own (no full Home read), in place: each shelf read
 * takes its fresh copy (an emptied one goes), and the hero and other shelves showing a title from
 * them take its progress. A shelf that was not read keeps what it shows; heroes and their actions
 * keep the watched position already applied (homeWatched).
 */
export function reconcileShelves(current: HomeModel, shelves: Row[]): HomeModel {
  const read = new Map(shelves.map(row => [row.id, row]));
  const cards = new Map<string, Card>();
  for (const row of shelves) for (const value of row.items) if (!cards.has(value.id)) cards.set(value.id, value);
  const rows: Row[] = [];
  for (const row of current.rows) {
    const next = read.get(row.id);
    if (next) { if (next.items.length) rows.push(freshRow(row, next)); continue; }
    if (progressRow(row)) { rows.push(row); continue; }
    const items = row.items.map(value => withProgress(value, cards.get(value.id)));
    rows.push(items.every((value, at) => value === row.items[at]) ? row : { ...row, items });
  }
  const hero = current.hero.map(value => withProgress(value, cards.get(value.id)));
  const same = rows.length === current.rows.length && rows.every((row, index) => row === current.rows[index])
    && hero.every((value, index) => value === current.hero[index]);
  return same ? current : { ...current, hero, rows };
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

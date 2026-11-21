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
  return {
    ...home,
    hero,
    heroActions: home.heroActions.map(action => heroAction(action, hero.find(h => h.id === action.heroId), watched)),
    rows: home.rows.map(row => ({ ...row, items: row.items.map(value => card(value, watched)) })),
  };
}

const progressRow = (row: Row) => row.purpose === 'continue' || row.purpose === 'nextUp';

/**
 * Replace only Home's server-owned progress shelves. Non-progress shelves retain their exact
 * objects and order (including pages appended by moreRows); fresh progress shelves are inserted
 * beside the same first-page anchors the server returned.
 */
export function reconcileHomeProgress(current: HomeModel, fresh: HomeModel): HomeModel {
  const retained = current.rows.filter(row => !progressRow(row));
  const retainedIndex = new Map(retained.map((row, index) => [row.id, index]));
  const groups: { slot: number; rows: Row[] }[] = [];
  for (let index = 0; index < fresh.rows.length;) {
    if (!progressRow(fresh.rows[index]!)) { index++; continue; }
    const rows: Row[] = [];
    while (index < fresh.rows.length && progressRow(fresh.rows[index]!)) rows.push(fresh.rows[index++]!);
    let slot: number | undefined;
    for (let next = index; next < fresh.rows.length; next++) {
      const found = retainedIndex.get(fresh.rows[next]!.id);
      if (found !== undefined) { slot = found; break; }
    }
    if (slot === undefined) {
      for (let previous = index - rows.length - 1; previous >= 0; previous--) {
        const found = retainedIndex.get(fresh.rows[previous]!.id);
        if (found !== undefined) { slot = found + 1; break; }
      }
    }
    groups.push({ slot: slot ?? 0, rows });
  }
  const insertions = new Map<number, Row[]>();
  for (const group of groups) insertions.set(group.slot, [...(insertions.get(group.slot) ?? []), ...group.rows]);
  const rows: Row[] = [];
  for (let slot = 0; slot <= retained.length; slot++) {
    rows.push(...(insertions.get(slot) ?? []));
    if (slot < retained.length) rows.push(retained[slot]!);
  }

  const freshHeroes = new Map(fresh.hero.map(hero => [hero.id, hero]));
  const hero = current.hero.map(value => {
    const next = freshHeroes.get(value.id);
    if (!next || value.progressSeconds === next.progressSeconds && value.progressLabel === next.progressLabel && value.played === next.played) return value;
    return { ...value, progressSeconds: next.progressSeconds, progressLabel: next.progressLabel, played: next.played };
  });
  const freshActions = new Map(fresh.heroActions.map(action => [action.heroId, action]));
  const heroActions = current.heroActions.map(action => {
    const next = freshActions.get(action.heroId);
    return next && (action.action === 'resume' || next.action === 'resume') ? next : action;
  });
  return { ...current, hero, heroActions, rows };
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

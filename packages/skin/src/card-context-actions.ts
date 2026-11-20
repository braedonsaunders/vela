import { msg, type Card, type TitleActions } from '@vela/core';
import type { Action } from '../../protocol/skin';

export interface CardPress {
  action: Action;
  arg: string;
}

export type CardContextCommand =
  | { kind: 'dispatch'; action: Action; arg: string }
  | { kind: 'watch'; change: { played?: boolean; favorite?: boolean; watchlisted?: boolean; continueWatching?: false } };

export interface CardContextAction {
  id: string;
  label: string;
  command: CardContextCommand;
}

const TITLE_KINDS = new Set(['movie', 'show', 'season', 'episode']);
const PLAYABLE_KINDS = new Set(['movie', 'episode']);

function dispatch(id: string, label: string, action: Action, arg: string): CardContextAction {
  return { id, label, command: { kind: 'dispatch', action, arg } };
}

function restartArg(arg: string): string {
  const [id = '', source = '', audio = ''] = arg.split('|');
  return `${id}|${source}|${audio}|0`;
}

function resumeLabel(card: Card): string {
  const seconds = Math.max(0, Math.floor(card.progressSeconds));
  const clock = seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const time = card.progressLabel && !card.progressLabel.includes('%') ? card.progressLabel : clock;
  return time ? msg('cardMenu.resumeAt', { time }) : msg('cardMenu.resume');
}

function addParentActions(actions: CardContextAction[], card: Card): void {
  if (card.kind !== 'episode') return;
  const [show, season] = card.contextParts;
  if (show?.select) actions.push(dispatch('show', msg('cardMenu.goToShow'), 'select', show.select));
  if (season?.select) actions.push(dispatch('season', msg('cardMenu.goToSeason'), 'select', season.select));
}

/**
 * The useful actions for one drawn card. Server mutations are present only when the adapter
 * returned TitleActions; absence is a capability answer, never a disabled menu row.
 */
export function cardContextActions(card: Card, primary: CardPress, management?: TitleActions | null, context: { continueWatching?: boolean } = {}): CardContextAction[] {
  const actions: CardContextAction[] = [];
  const playable = PLAYABLE_KINDS.has(card.kind);
  const resumable = playable && card.progressSeconds > 0 && card.durationSeconds > 0 && !card.played;

  if (primary.action === 'watch') {
    actions.push(dispatch('watch-live', msg('cardMenu.watchLive'), primary.action, primary.arg));
  } else if (primary.action === 'playExtra') {
    actions.push(dispatch('play', msg('cardMenu.play'), primary.action, primary.arg));
  } else if (playable) {
    const playArg = primary.action === 'play' ? primary.arg : card.id;
    actions.push(dispatch('play', resumable ? resumeLabel(card) : msg('cardMenu.play'), 'play', playArg));
    if (resumable) actions.push(dispatch('restart', msg('ui.playFromBeginning'), 'play', restartArg(playArg)));
  } else {
    actions.push(dispatch('open', TITLE_KINDS.has(card.kind) ? msg('cardMenu.openDetails') : msg('cardMenu.open'), primary.action, primary.arg));
  }

  if (playable) {
    const details = primary.action === 'play'
      ? { action: 'select' as const, arg: `${card.id}|${card.kind}|${card.receipt}` }
      : primary;
    actions.push(dispatch('details', msg('cardMenu.openDetails'), details.action, details.arg));
  }

  if (management?.watched) {
    actions.push({
      id: 'watched',
      label: msg(management.watch.played ? 'cardMenu.markUnwatched' : 'cardMenu.markWatched'),
      command: { kind: 'watch', change: { played: !management.watch.played } },
    });
  }
  if (management?.favorite) actions.push({
    id: 'favorite',
    label: msg(management.watch.favorite ? 'cardMenu.removeFavourite' : 'cardMenu.addFavourite'),
    command: { kind: 'watch', change: { favorite: !management.watch.favorite } },
  });
  if (management?.watchlist) actions.push({
    id: 'watchlist',
    label: msg(management.watch.watchlisted ? 'cardMenu.removeWatchlist' : 'cardMenu.addWatchlist'),
    command: { kind: 'watch', change: { watchlisted: !management.watch.watchlisted } },
  });
  if (context.continueWatching && management?.removeFromContinue) actions.push({
    id: 'remove-continue', label: msg('cardMenu.removeContinue'),
    command: { kind: 'watch', change: { continueWatching: false } },
  });

  addParentActions(actions, card);
  return actions;
}

export function supportsTitleActions(card: Card): boolean {
  return TITLE_KINDS.has(card.kind);
}

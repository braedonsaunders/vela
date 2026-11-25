// The audio app's keyboard (web and desktop), whatever draws the app: play/pause, seek, previous
// and next, volume, mute, shuffle and repeat (music) or speed (spoken word, whose arrows skip
// 15/30 s), like, the queue, search and the shortcut list. What a key does is decided here, pure;
// the store's part is done by `runAudioKey`; the app does the rest (the queue, search, the list).
import type { Card } from '../models';
import type { Vela } from '../store';
import { AUDIO_RATES } from '../store/audio';
import { current } from './queue';

export type AudioKeyCommand =
  | { kind: 'toggle' } | { kind: 'skip'; seconds: number } | { kind: 'previous' } | { kind: 'next' }
  | { kind: 'volume'; delta: number } | { kind: 'mute' } | { kind: 'shuffle' } | { kind: 'repeat' }
  | { kind: 'rate'; step: 1 | -1 } | { kind: 'like' } | { kind: 'queue' } | { kind: 'search' } | { kind: 'help' };

export interface AudioKeyInput {
  key: string;
  /** ⌘ or Ctrl, Alt, Shift. */
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** The focused element's role: a button keeps Space, a slider its arrows. */
  role?: string | null;
  /** Spoken word (audiobooks, podcasts): skips and speed in place of shuffle and repeat. */
  spoken: boolean;
  /** Something is in the queue (most keys act on it). */
  playing: boolean;
}

/** What a key press does in the audio app, or null when the key is not the app's. */
export function audioKey(input: AudioKeyInput): AudioKeyCommand | null {
  const { key, role, spoken } = input;
  if (input.meta && key.toLowerCase() === 'k') return { kind: 'search' };
  if (input.meta || input.alt) return null;
  if (key === '?') return { kind: 'help' };
  if (key === 'q' || key === 'Q') return { kind: 'queue' };
  if (!input.playing) return null;
  const slider = role === 'adjustable' || role === 'slider';
  switch (key) {
    case ' ': return role === 'button' || role === 'link' || role === 'menuitem' ? null : { kind: 'toggle' };
    case 'ArrowLeft': case 'ArrowRight': {
      if (slider) return null;
      const back = key === 'ArrowLeft';
      if (input.shift) return { kind: back ? 'previous' : 'next' };
      return { kind: 'skip', seconds: spoken ? (back ? -15 : 30) : (back ? -5 : 5) };
    }
    case 'ArrowUp': case 'ArrowDown': return slider ? null : { kind: 'volume', delta: key === 'ArrowUp' ? 0.1 : -0.1 };
    case 'm': case 'M': return { kind: 'mute' };
    case 's': case 'S': return spoken ? null : { kind: 'shuffle' };
    case 'r': case 'R': return spoken ? null : { kind: 'repeat' };
    case '[': case ']': return spoken ? { kind: 'rate', step: key === ']' ? 1 : -1 } : null;
    case 'l': case 'L': return { kind: 'like' };
    default: return null;
  }
}

/** The next speed one step up or down the list (from 1× when the rate is not on it). */
export function nextRate(rate: number, step: 1 | -1): number {
  const at = AUDIO_RATES.indexOf(rate as typeof AUDIO_RATES[number]);
  return AUDIO_RATES[Math.min(AUDIO_RATES.length - 1, Math.max(0, (at < 0 ? AUDIO_RATES.indexOf(1) : at) + step))]!;
}

/** Do a command's store part. Returns false for the app's own (queue, search, help, like). */
export function runAudioKey(store: Pick<Vela, 'getState' | 'audio'>, command: AudioKeyCommand): boolean {
  const audio = store.getState().audio;
  switch (command.kind) {
    case 'toggle': store.audio.toggle(); return true;
    case 'skip': store.audio.skip(command.seconds); return true;
    case 'previous': store.audio.previous(); return true;
    case 'next': store.audio.next(); return true;
    case 'volume': store.audio.setVolume(audio.volume + command.delta); return true;
    case 'mute': store.audio.toggleMute(); return true;
    case 'shuffle': store.audio.toggleShuffle(); return true;
    case 'repeat': store.audio.cycleRepeat(); return true;
    case 'rate': store.audio.setRate(nextRate(audio.rate, command.step)); return true;
    default: return false;
  }
}

/** The viewer's liked titles as this device knows them: the role lists, else the Favorites playlist. */
export function likedTitleIds(state: ReturnType<Vela['getState']>): Set<string> {
  const ids = new Set<string>();
  for (const list of Object.values(state.music.liked)) for (const item of list?.value?.items ?? []) ids.add(item.id);
  for (const value of Object.values(state.collections)) {
    if (value?.value?.name !== 'Favorites') continue;
    for (const item of value.value.items) ids.add(item.id);
  }
  return ids;
}

/** Whether a title is liked: what the lists say, else its own card's favourite. */
export function isLiked(state: ReturnType<Vela['getState']>, card: Pick<Card, 'id' | 'favorite'>): boolean {
  return likedTitleIds(state).has(card.id) || card.favorite === true;
}

/**
 * Like or unlike a title (the server's favourite), then read again the lists that show it: its
 * role's liked list, else the Favorites playlist. Rejects when the server refuses.
 */
export async function setTitleLiked(store: Pick<Vela, 'getState' | 'catalogue' | 'music' | 'playlists'>, card: Pick<Card, 'id' | 'media'>, on: boolean): Promise<void> {
  await store.catalogue.setTitleWatch(card.id, { favorite: on });
  const role = card.media?.role;
  if (store.music.likedAvailable && role) { void store.music.liked(role, false, true); return; }
  const liked = store.getState().playlists.list.value?.find(playlist => playlist.name === 'Favorites');
  if (liked) void store.playlists.open(liked.id, false, true);
}

/** The item playing now, which `like` acts on. */
export const playingItem = (state: ReturnType<Vela['getState']>): Card | undefined => current(state.audio.queue);

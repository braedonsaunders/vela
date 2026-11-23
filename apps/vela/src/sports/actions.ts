// What Sports surfaces do in the app: open a game page, tune where it is on, and (once the
// multiview registers itself) add it as a tile. The widgets in @vela/skin never navigate themselves.
import { router } from 'expo-router';
import { useMemo, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';
import type { SportsActions } from '@vela/skin/src/widgets/sports';

type AddToMultiview = NonNullable<SportsActions['addToMultiview']>;
let multiview: AddToMultiview | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The multiview's hook (spec D): while registered, Sports offers "Add to multiview" for a game
 * with a Live TV channel, and calls `add` with that target and its event. */
export function registerMultiview(add: AddToMultiview): () => void {
  multiview = add;
  for (const listener of [...listeners]) listener();
  return () => {
    if (multiview !== add) return;
    multiview = undefined;
    for (const listener of [...listeners]) listener();
  };
}

export function useAppSportsActions(close?: () => void): SportsActions {
  const add = useSyncExternalStore(subscribe, () => multiview, () => multiview);
  return useMemo<SportsActions>(() => ({
    openEvent: event => router.push({ pathname: '/game/[id]', params: { id: event.id } }),
    watch: target => {
      if (target.channelId) router.navigate({ pathname: '/watch/[id]', params: { id: target.channelId, kind: 'channel' } });
    },
    // The game from its first minute: the programme on air from its start, or the ended one from the archive.
    watchFromStart: (target, kind) => {
      if (target.channelId && target.programme) router.navigate({ pathname: '/watch/[id]',
        params: { id: target.programme.id, kind: 'programme', channelId: target.channelId, ...(kind === 'startOver' ? { from: 'start' } : {}) } });
    },
    ...(add ? { addToMultiview: add } : {}),
    ...(close ? { close } : {}),
    openLink: url => { void Linking.openURL(url).catch(() => {}); },
  }), [close, add]);
}

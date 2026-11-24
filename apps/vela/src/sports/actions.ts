// What Sports surfaces do in the app: open a game page, tune where it is on, and (once the
// multiview registers itself) add it as a tile. The widgets in @vela/skin never navigate themselves.
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Linking } from 'react-native';
import type { SportsActions } from '@vela/skin/src/widgets/sports';
import { useMultiview } from '../multiview-registry';

export function useAppSportsActions(close?: () => void): SportsActions {
  const channel = useMultiview();
  const add = useMemo<SportsActions['addToMultiview']>(() => channel ? target => { if (target.channelId) channel(target.channelId); } : undefined, [channel]);
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

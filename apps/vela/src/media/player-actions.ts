// Media pages play through the store's audio queue.
import { useCallback, useMemo } from 'react';
import { currentInQueue } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import type { MediaActions } from '@vela/skin/src/widgets/media';
import { useVela } from '../vela';

export function useMediaPlayerActions(): Pick<MediaActions, 'play' | 'nowPlaying'> {
  const { store } = useVela();
  const id = useVelaState(state => currentInQueue(state.audio.queue)?.id ?? '');
  const playing = useVelaState(state => state.audio.phase === 'playing' || state.audio.phase === 'buffering' || state.audio.phase === 'loading');
  const play = useCallback<MediaActions['play']>(request => store.audio.play(request), [store]);
  const nowPlaying = useMemo(() => (id ? { id, playing } : undefined), [id, playing]);
  return { play, nowPlaying };
}

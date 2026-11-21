// Stage (a): audio plays through the watch route until the audio player lands.
import { router } from 'expo-router';
import { useCallback } from 'react';
import type { MediaActions } from '@vela/skin/src/widgets/media';

export function useMediaPlayerActions(): Pick<MediaActions, 'play' | 'nowPlaying'> {
  const play = useCallback<MediaActions['play']>(request => {
    const item = request.items[request.index];
    if (item) router.navigate({ pathname: '/watch/[id]', params: { id: item.id } });
  }, []);
  return { play, nowPlaying: undefined };
}

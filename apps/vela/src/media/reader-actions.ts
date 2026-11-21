// A book's Read button opens the reader route, out of the book's cover on the web.
import { router } from 'expo-router';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import type { MediaActions } from '@vela/skin/src/widgets/media';
import { heroCoverRect, noteReaderOrigin } from '@vela/skin/src/widgets/media/reader-origin';

export function useReaderActions(library: string | undefined): MediaActions['read'] {
  return useCallback<MediaActions['read']>(card => {
    noteReaderOrigin(Platform.OS === 'web' ? heroCoverRect() : null);
    router.push({ pathname: '/read/[id]', params: { id: card.id, library: library ?? '' } });
  }, [library]);
}

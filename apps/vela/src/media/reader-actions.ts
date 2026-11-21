// A book's Read button opens the reader route.
import { router } from 'expo-router';
import { useCallback } from 'react';
import type { MediaActions } from '@vela/skin/src/widgets/media';

export function useReaderActions(library: string | undefined): MediaActions['read'] {
  return useCallback<MediaActions['read']>(card => router.push({ pathname: '/read/[id]', params: { id: card.id, library: library ?? '' } }), [library]);
}

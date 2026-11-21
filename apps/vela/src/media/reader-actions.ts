// Stage (a): the reader lands separately.
import { useCallback } from 'react';
import type { MediaActions } from '@vela/skin/src/widgets/media';

export function useReaderActions(_library: string | undefined): MediaActions['read'] {
  return useCallback<MediaActions['read']>(card => console.info(`Vela: reading ${card.id} is not available yet`), []);
}

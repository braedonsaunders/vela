import { useSyncExternalStore } from 'react';
import { useLiveContext } from './live';

import { guideMinute } from './content';

/** Subscribe at the marker, so clock changes never invalidate the grid or its rows. */
export function useGuideMinute(fallback: number): number {
  const live = useLiveContext();
  const read = () => guideMinute(live?.controller.view().guide?.nowMinute ?? fallback);
  return useSyncExternalStore(live?.controller.subscribe ?? (() => () => {}), read, read);
}

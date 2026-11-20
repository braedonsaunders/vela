import type { PlaybackPlan } from '../wire';
import type { ServerAdapter } from './index';
export type { MediaVersion, TitleActions, TitleManagement } from './capabilities';
export { hasTitleManagement } from './capabilities';
export interface RemoteSubtitle { id: string; name: string; language: string }
export interface SubtitleSearch {
  searchSubtitles(sessionId: string, language: string): Promise<RemoteSubtitle[]>;
  downloadSubtitle(sessionId: string, id: string): Promise<PlaybackPlan>;
}
export function hasSubtitleSearch(api: ServerAdapter): api is ServerAdapter & SubtitleSearch {
  return 'searchSubtitles' in api && 'downloadSubtitle' in api;
}

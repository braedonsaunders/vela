import type { PlaybackPlan, Track, WatchState } from '../wire';
import type { ServerAdapter } from './index';

export interface MediaVersion { id: string; name: string; audioTrackId?: string }
export interface TitleActions { watched: boolean; list: 'favorite' | 'watchlist' | null; watch: WatchState; versions: MediaVersion[] }
export interface RemoteSubtitle { id: string; name: string; language: string }
export interface TitleManagement {
  titleActions(id: string): Promise<TitleActions>;
  setTitleWatch(id: string, change: { played?: boolean; listed?: boolean }): Promise<void>;
}
export interface SubtitleSearch {
  searchSubtitles(sessionId: string, language: string): Promise<RemoteSubtitle[]>;
  downloadSubtitle(sessionId: string, id: string): Promise<PlaybackPlan>;
}
export function hasTitleManagement(api: ServerAdapter): api is ServerAdapter & TitleManagement {
  return 'titleActions' in api && 'setTitleWatch' in api;
}
export function hasSubtitleSearch(api: ServerAdapter): api is ServerAdapter & SubtitleSearch {
  return 'searchSubtitles' in api && 'downloadSubtitle' in api;
}

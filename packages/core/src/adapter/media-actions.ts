import type { PlaybackPlan } from '../wire';
import type { SubtitleLanguage } from '../subtitle-languages';
import type { ServerAdapter } from './index';
export type { MediaVersion, TitleActions, TitleManagement } from './capabilities';
export { hasTitleManagement } from './capabilities';
/** One subtitle a search found, with what the server says about it (every detail optional). */
export interface RemoteSubtitle { id: string; name: string; language: string;
  provider?: string; format?: string; author?: string; downloads?: number;
  /** 0 to 10. */ rating?: number;
  /** Made for this release (a file hash or release-name match). */ releaseMatch?: boolean;
  hearingImpaired?: boolean; forced?: boolean;
  /** The server translates it with a language model once chosen. */ aiTranslated?: boolean }
export interface SubtitleSearchResult {
  /** The language searched: the one asked for, or the server's own pick when none was. */ language: string;
  offers: RemoteSubtitle[];
  /** The viewer's languages as the server keeps them, most preferred first. */ preferred: string[] }
export interface SubtitleLanguages { languages: SubtitleLanguage[]; preferred: string[] }
export interface SubtitleSearch {
  /** The languages a search takes, or null when this server offers no search (an older Ether). */
  subtitleLanguages(sessionId: string): Promise<SubtitleLanguages | null>;
  /** Without a language, the viewer's most preferred one. */
  searchSubtitles(sessionId: string, language?: string): Promise<SubtitleSearchResult>;
  /** The session's plan with the chosen subtitle added, on the same source. */
  downloadSubtitle(sessionId: string, id: string, idempotencyKey: string): Promise<PlaybackPlan>;
}
export function hasSubtitleSearch(api: ServerAdapter): api is ServerAdapter & SubtitleSearch {
  return 'searchSubtitles' in api && 'downloadSubtitle' in api && 'subtitleLanguages' in api;
}

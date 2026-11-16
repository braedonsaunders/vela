import type { OriginalBackend, OriginalRuntimeOptions } from '../universal/loader';
import type { SubtitleSession, SubtitleSessionOptions } from '../universal/subtitles/session';

/** Runtime construction is injected by the app bundle, never selected by a skin. */
export interface BrowserRuntimeServices {
  readonly hls: boolean;
  readonly live: boolean;
  create(options: Omit<OriginalRuntimeOptions, 'assets'>): Promise<OriginalBackend>;
  createSubtitles(options: Omit<SubtitleSessionOptions, 'assetBaseURL'>): Promise<SubtitleSession>;
}

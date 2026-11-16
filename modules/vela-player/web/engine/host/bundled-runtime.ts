import type { OriginalRuntimeOptions } from '../universal/loader';
import type { BrowserRuntimeServices } from './services';

/** Metro owns core JavaScript. This base contains static decoder/worklet/subtitle assets only. */
export function bundledRuntimeServices(assetBaseURL: string): BrowserRuntimeServices {
  const base = new URL(assetBaseURL, location.origin);
  const identity = /\/player\/([a-f0-9]{64})\/$/.exec(base.pathname);
  if (
    !identity ||
    base.origin !== location.origin ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Player assets require a same-origin immutable base');
  const assets: OriginalRuntimeOptions['assets'] = {
    baseURL: new URL('libraries/', base).href,
    audioDecoderURL: new URL('libraries/audio-decoders/', base).href,
    videoDecoderURL: new URL('libraries/video-decoders/', base).href,
    subtitleBaseURL: new URL('libraries/subtitles/', base).href,
    assetKey: identity[1],
  };
  return {
    hls: true,
    live: true,
    async create(options) {
      const { UniversalRuntime } = await import('../core/adapter');
      options.signal.throwIfAborted();
      return new UniversalRuntime({ ...options, assets });
    },
    async createSubtitles(options) {
      const { SubtitleSession } = await import('../universal/subtitles/session');
      options.signal.throwIfAborted();
      return new SubtitleSession({ ...options, assetBaseURL: assets.subtitleBaseURL! });
    },
  };
}

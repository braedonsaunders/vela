// Where the trailer embed loads from on the web: YouTube's nocookie origin, or mock-server's stand-in in
// a mock run. A mock build names it in EXPO_PUBLIC_VELA_TRAILER_EMBED_ORIGIN; the mock e2e proxy, which
// serves an ordinary export, names it in the page it serves (<meta name="vela-mock-trailer-embed-origin">).
// Either way it must be a plain loopback origin. Whoever serves the page already decides all of its code,
// so the meta grants nothing new; Ether never sends it, and nothing from the protocol can set it.
import { acceptEmbedOriginOverride, YOUTUBE_EMBED_ORIGIN } from '@vela/core';
import { config } from './data/config';

export function trailerEmbedOrigin(): string {
  const built = config.mock ? acceptEmbedOriginOverride(process.env.EXPO_PUBLIC_VELA_TRAILER_EMBED_ORIGIN) : null;
  if (built) return built;
  const meta = typeof document === 'undefined' ? null : document.querySelector('meta[name="vela-mock-trailer-embed-origin"]');
  return acceptEmbedOriginOverride(meta?.getAttribute('content')) ?? YOUTUBE_EMBED_ORIGIN;
}

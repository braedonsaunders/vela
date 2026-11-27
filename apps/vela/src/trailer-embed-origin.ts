// Where the trailer embed loads from on a native app: YouTube's nocookie origin, or in a mock build only
// (EXPO_PUBLIC_VELA_MOCK=1), mock-server's stand-in named by EXPO_PUBLIC_VELA_TRAILER_EMBED_ORIGIN, which
// must be a plain loopback origin (or the Android emulator's host alias). A release build never reads it.
import { acceptEmbedOriginOverride, YOUTUBE_EMBED_ORIGIN } from '@vela/core';
import { config } from './data/config';

export function trailerEmbedOrigin(): string {
  if (!config.mock) return YOUTUBE_EMBED_ORIGIN;
  return acceptEmbedOriginOverride(process.env.EXPO_PUBLIC_VELA_TRAILER_EMBED_ORIGIN) ?? YOUTUBE_EMBED_ORIGIN;
}

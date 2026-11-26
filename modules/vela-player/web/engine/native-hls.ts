import { cancelled } from './session';
import { defaultHlsVariant } from './hls';
import type { MediaFetch } from './media-auth';

/** Resolve once; native ABR must not restart a serial server encoder per rung. */
export async function nativeMediaPlaylist(
  url: string,
  signal: AbortSignal,
  depth = 0,
  fetcher: MediaFetch = (...args) => fetch(...args),
): Promise<{ url: string; duration: number | null }> {
  if (depth > 1) throw new Error('Nested HLS masters are unsupported');
  const response = await fetcher(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok) throw new TypeError(`HLS manifest HTTP ${response.status}`);
  const text = await response.text();
  cancelled(signal);
  if (text.length > 1024 * 1024 || !text.trimStart().startsWith('#EXTM3U'))
    throw new Error('Invalid HLS manifest');
  const variant = defaultHlsVariant(text, response.url);
  if (!variant) {
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const durations = lines
      .filter((line) => line.startsWith('#EXTINF:'))
      .map((line) => Number(line.slice(8).split(',')[0]));
    const duration =
      lines.includes('#EXT-X-ENDLIST') &&
      durations.length > 0 &&
      durations.every((d) => Number.isFinite(d) && d > 0)
        ? durations.reduce((a, b) => a + b, 0)
        : null;
    return { url: response.url, duration };
  }
  return nativeMediaPlaylist(variant, signal, depth + 1, fetcher);
}

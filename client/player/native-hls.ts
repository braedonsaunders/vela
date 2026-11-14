import { cancelled } from './session';

/** Resolve once; native ABR must not restart a serial server encoder per rung. */
export async function nativeMediaPlaylist(url: string, signal: AbortSignal, depth = 0): Promise<{ url: string; duration: number | null }> {
  if (depth > 1) throw new Error('Nested HLS masters are unsupported');
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), credentials: 'same-origin' });
  if (!response.ok) throw new TypeError(`HLS manifest HTTP ${response.status}`);
  const text = await response.text(); cancelled(signal);
  if (text.length > 1024 * 1024 || !text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS manifest');
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const first = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'));
  if (first < 0) {
    const durations = lines.filter(line => line.startsWith('#EXTINF:')).map(line => Number(line.slice(8).split(',')[0]));
    const duration = lines.includes('#EXT-X-ENDLIST') && durations.length > 0 && durations.every(d => Number.isFinite(d) && d > 0) ? durations.reduce((a,b) => a+b, 0) : null;
    return { url: response.url, duration };
  }
  const uri = lines.slice(first + 1).find(line => line && !line.startsWith('#'));
  if (!uri) throw new Error('HLS default variant is missing');
  const variant = new URL(uri, response.url);
  if (variant.origin !== new URL(response.url).origin || variant.username || variant.password) throw new Error('HLS variant outside broker origin');
  return nativeMediaPlaylist(variant.href, signal, depth + 1);
}

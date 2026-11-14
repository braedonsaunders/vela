import { cancelled } from './session';

/** Resolve once; native ABR must not restart a serial server encoder per rung. */
export async function nativeMediaPlaylist(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), credentials: 'same-origin' });
  if (!response.ok) throw new TypeError(`HLS manifest HTTP ${response.status}`);
  const text = await response.text(); cancelled(signal);
  if (text.length > 1024 * 1024 || !text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS manifest');
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const first = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'));
  if (first < 0) return response.url;
  const uri = lines.slice(first + 1).find(line => line && !line.startsWith('#'));
  if (!uri) throw new Error('HLS default variant is missing');
  const variant = new URL(uri, response.url);
  if (variant.origin !== new URL(response.url).origin || variant.username || variant.password) throw new Error('HLS variant outside broker origin');
  return variant.href;
}

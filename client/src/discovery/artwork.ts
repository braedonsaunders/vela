import type { ArtworkRef } from '../../wire/v0/types';

/** How the selected server addresses artwork. Ether resolves relative grants on its origin;
 * a native server sizes its own image URLs for each slot (`sized`), which may carry an
 * in-memory transient credential and is never persisted or logged. */
export interface Images { origin: string; sized?: (url: URL, width: number, height: number) => string | undefined }

/** Select the smallest supplied image that covers the requested display size. */
export function artworkURL(artwork: ArtworkRef, width: number, height: number, images?: Images): string | undefined {
  const sizes = [...artwork.sizes].sort((a, b) => a.width * a.height - b.width * b.height);
  const url = (sizes.find(size => size.width >= width && size.height >= height) ?? sizes[sizes.length - 1])?.url;
  if (!url || !images) return url;
  const origin = images.origin;
  const resolved = new URL(url, `${origin.replace(/\/$/, '')}/`);
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
  if (images.sized) return images.sized(resolved, Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  // Ether's current grant endpoint uses `w`; preserve every existing grant
  // parameter byte-for-byte and never rewrite URLs for other servers.
  if (resolved.origin === new URL(origin).origin && resolved.pathname.startsWith('/vela/v0/images/') && !resolved.searchParams.has('w')) {
    const maximum = Math.max(0, ...sizes.map(size => size.width));
    const target = maximum > 0 ? Math.max(1, Math.ceil(Math.min(width, maximum))) : 0;
    resolved.search = `${resolved.search}${resolved.search ? '&' : '?'}w=${target}`;
  }
  return resolved.href;
}

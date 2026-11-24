import type { ArtworkRef } from '../wire';

/** How the selected server addresses artwork. Ether resolves relative grants on its origin;
 * a native server sizes its own image URLs for each slot (`sized`), which may carry an
 * in-memory transient credential and is never persisted or logged. */
export interface Images {
  origin: string;
  sized?: (url: URL, width: number, height: number) => string | undefined;
  /** Ask Ether's proxy for widths between the advertised sizes. */
  fitProxyWidth?: boolean;
}

/** Select the smallest supplied image that covers the requested display size. */
export function artworkURL(artwork: ArtworkRef, width: number, height: number, images?: Images): string | undefined {
  const sizes = [...artwork.sizes].sort((a, b) => a.width * a.height - b.width * b.height);
  const size = sizes.find(size => size.width >= width && size.height >= height) ?? sizes[sizes.length - 1];
  const url = size?.url;
  if (!url || !images) return url;
  const origin = images.origin;
  const resolved = new URL(url, `${origin.replace(/\/$/, '')}/`);
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
  if (images.sized) return images.sized(resolved, Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  // Keep signed query parameters byte-for-byte. Only Ether's same-server image proxy offers
  // dynamic sizing; other URLs and adapters keep their own width semantics.
  if (resolved.origin === new URL(origin).origin && resolved.pathname.startsWith('/vela/v0/images/')) {
    const widths = resolved.searchParams.getAll('w');
    if (!widths.length) {
      const maximum = Math.max(0, ...sizes.map(size => size.width));
      const target = Math.max(1, Math.ceil(maximum > 0 ? Math.min(width, maximum) : width));
      resolved.search = `${resolved.search}${resolved.search ? '&' : '?'}w=${target}`;
    } else if (images.fitProxyWidth && widths.length === 1) {
      const advertised = Number(widths[0]);
      // A cover crop also needs enough source rows to fill the requested height.
      const cover = size.width > 0 && size.height > 0 ? height * size.width / size.height : width;
      const target = Math.ceil(Math.max(1, width, cover));
      if (!Number.isFinite(advertised) || advertised <= 0 || target < advertised) {
        resolved.search = resolved.search.replace(/([?&]w=)[^&]*(?=&|$)/, (_, prefix) => prefix + target);
      }
    }
  }
  return resolved.href;
}

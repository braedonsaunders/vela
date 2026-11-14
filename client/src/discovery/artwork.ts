import type { ArtworkRef } from '../../wire/v0/types';

/** Select the smallest supplied image that covers the requested display size. */
export function artworkURL(artwork: ArtworkRef, width: number, height: number, origin?: string): string | undefined {
  const sizes = [...artwork.sizes].sort((a, b) => a.width * a.height - b.width * b.height);
  const url = (sizes.find(size => size.width >= width && size.height >= height) ?? sizes[sizes.length - 1])?.url;
  if (!url || !origin) return url;
  const resolved = new URL(url, `${origin.replace(/\/$/, '')}/`);
  return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : undefined;
}

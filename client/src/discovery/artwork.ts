import type { ArtworkRef } from '../../../protocol/v0/types';

/** Select the smallest supplied image that covers the requested display size. */
export function artworkURL(artwork: ArtworkRef, width: number, height: number): string | undefined {
  const sizes = [...artwork.sizes].sort((a, b) => a.width * a.height - b.width * b.height);
  return (sizes.find(size => size.width >= width && size.height >= height) ?? sizes[sizes.length - 1])?.url;
}

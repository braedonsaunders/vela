import type { MediaLook } from './parts';

export function tilesPerRow(
  { small, width, gutter }: Pick<MediaLook, 'small' | 'width' | 'gutter'>,
  min: number,
  inner = Math.min(1360, width) - gutter * 2,
): { size: number; gap: number } {
  const gap = small ? 16 : 24;
  const count = Math.max(2, Math.floor((inner + gap) / (min + gap)));
  return { size: Math.floor((inner - gap * (count - 1)) / count), gap };
}

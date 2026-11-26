// Pure letter-jump helpers for the library toolbar: active bucket matching, grid column sizing, and post-jump poster target.
import type { LibraryJumpBucket } from '@vela/core';
import type { LibraryPage } from './model';

/** Gap between letter tiles in the Jump panel (px). */
export const JUMP_TILE_GAP = 8;

/** Column count for the Jump panel's letter grid so rows span the panel's inner width evenly. */
export function jumpGridColumns(innerWidth: number, isTV: boolean): number {
  const minTile = isTV ? 64 : 44;
  if (!Number.isFinite(innerWidth) || innerWidth <= minTile) return 1;
  return Math.max(1, Math.floor((innerWidth + JUMP_TILE_GAP) / (minTile + JUMP_TILE_GAP)));
}

/** Splits buckets into fixed-column rows so full rows span edge-to-edge and the last partial row aligns with them. */
export function jumpGridRows<T>(items: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** The bucket matching a jumped start offset, or undefined when browsing from the top. */
export function activeJumpBucket(
  buckets: readonly LibraryJumpBucket[] | undefined,
  jumpStart: number | undefined,
): LibraryJumpBucket | undefined {
  if (!buckets?.length || !jumpStart || jumpStart <= 0) return undefined;
  let matched: LibraryJumpBucket | undefined;
  for (const bucket of buckets) {
    if (bucket.startOffset === jumpStart) return bucket;
    if (bucket.startOffset < jumpStart) matched = bucket;
  }
  return matched;
}

/** The `select:` press action for the first poster of a ready jumped window, or undefined while still loading. */
export function firstPosterTarget(page: LibraryPage | undefined, targetStart: number): string[] | undefined {
  if (!page || page.loading) return undefined;
  const model = page.model;
  if (!model || (model.startOffset ?? 0) !== targetStart) return undefined;
  const first = model.items[0];
  if (!first) return [];
  return [`select:${first.id}|${first.kind}|${first.receipt}`];
}

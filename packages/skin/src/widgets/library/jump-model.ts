// Pure letter-jump helpers for the library toolbar: active bucket matching and post-jump poster target.
import type { LibraryJumpBucket } from '@vela/core';
import type { LibraryPage } from './model';

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

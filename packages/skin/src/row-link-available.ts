import { canSeeAll, type Row } from '@vela/core';

/** Whether a row's See all can open: its end card draws nothing (not even its frame) otherwise. */
export function rowLinkAvailable(row: Row | undefined, openRow: unknown, visible: number | undefined, limit?: string): boolean {
  return !!row && !!openRow && canSeeAll(row, visible ?? (limit ? Number(limit) : undefined));
}

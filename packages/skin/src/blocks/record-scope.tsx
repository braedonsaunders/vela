// Per-item / per-section record reader wrapper (`docs/plugin-screens.md` §Data, records and live updates):
// gives a subtree its own tracked `useRecordReader()` instance so a live record push (`event:<id>`,
// `detail:<id>`, `entity:<id>`, etc.) re-renders ONLY the item or section that read that `$record`,
// rather than re-rendering the entire page.
import { memo, useMemo, type ReactElement } from 'react';
import { useRecordReader } from '@vela/core/react';
import type { Ctx } from '../vocabulary';

export interface ScopedRecordNodeProps {
  node: unknown;
  ctx: Ctx;
  renderNode: (node: unknown, ctx: Ctx) => ReactElement | null;
}

export function sameScopedRecordProps(a: ScopedRecordNodeProps, b: ScopedRecordNodeProps): boolean {
  return (
    a.node === b.node &&
    a.renderNode === b.renderNode &&
    a.ctx.index === b.ctx.index &&
    samePageWithoutRev(a.ctx.screen?.page, b.ctx.screen?.page) &&
    sameStateMap(a.ctx.screen?.state, b.ctx.screen?.state) &&
    sameItems(a.ctx.screen?.items, b.ctx.screen?.items)
  );
}

export const ScopedRecordNode = memo(function ScopedRecordNode({
  node,
  ctx,
  renderNode,
}: ScopedRecordNodeProps): ReactElement | null {
  const record = useRecordReader();
  const scopedCtx = useMemo<Ctx>(
    () => (ctx.screen ? { ...ctx, screen: { ...ctx.screen, record } } : ctx),
    [ctx, record],
  );
  return renderNode(node, scopedCtx);
}, sameScopedRecordProps);

/**
 * When a `records` SSE frame arrives (`vela.screens.receive('records', ...)`), `core` bumps
 * `page.rev` for stream reconnection while preserving `page.sources`, `page.params`, `page.pending`,
 * `page.errors`, and `page.load` by reference. Ignoring `page.rev` here means a record push never
 * forces unaffected `ScopedRecordNode` siblings to re-render: only the `ScopedRecordNode` whose
 * own `useRecordReader()` subscribed to the changed `$record` key re-renders!
 */
export function samePageWithoutRev(
  a: NonNullable<Ctx['screen']>['page'] | undefined,
  b: NonNullable<Ctx['screen']>['page'] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.key === b.key &&
    a.load === b.load &&
    a.sources === b.sources &&
    a.params === b.params &&
    a.pending === b.pending &&
    a.errors === b.errors &&
    a.context === b.context
  );
}

export function sameStateMap(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function sameItems(
  a: NonNullable<Ctx['screen']>['items'] | undefined,
  b: NonNullable<Ctx['screen']>['items'] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const av = a[k];
    const bv = b[k];
    if (!av || !bv || av.index !== bv.index || av.value !== bv.value) return false;
  }
  return true;
}

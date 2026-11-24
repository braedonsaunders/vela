// Measure the structural reader re-render blast radius of a single live record push on a resolved
// plugin screen document (budget: a record push re-renders only its readers in <= 2 frames).
//
// Evaluates every collection item (`shelf`, `grid`, `repeat`, `tabs`, `marquee`) on the page
// before and after pushing a single record (`event:sports:sports:nfl-nyg-phi`) into the shared
// record pool, counting:
//   1. `actualReaders`: how many item subtrees actually read the pushed record key.
//   2. `currentInvalidatedItems`: how many items are invalidated under today's single-root
//      `useRecordReader()` in `ScreenView` (`packages/skin/src/screen/host.tsx`), where one
//      `record` function is shared across the entire page and recreated whenever *any* record
//      read anywhere on the page changes.
//   3. `perItemInvalidatedItems`: how many items are invalidated when each collection item uses
//      an isolated `RecordReader` (as `useRecordReader()` in `packages/core/src/react.ts` was
//      designed for).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ScreenDocument } from '../../packages/protocol/screen';
import type { ScreenPageState } from '../../packages/core/src/screens/types';
import { RecordStore } from '../../packages/core/src/screens/records';
import { resolveScreenDocument } from '../../packages/skin/src/resolve/screen';
import { resolveUi } from '../../packages/skin/src/resolve/ui';
import { fill, holds, type RNode } from '../../packages/skin/src/resolve';
import { screenItems, screenRoot, type Items } from '../../packages/skin/src/screen/items';
import type { RecordReader } from '../../packages/skin/src/screen/scope';
import type { Ctx, Env } from '../../packages/skin/src/vocabulary';

export interface RecordPushAudit {
  pushedRecordKey: string;
  totalCollectionItems: number;
  actualReaderItems: number;
  currentRootInvalidatedItems: number;
  isolatedPerItemInvalidatedItems: number;
  rootReadsTotalRecords: number;
  isolatesToReadersOnly: boolean;
  rootCause: string;
}

/** Walk an RNode tree in a given item context, evaluating its templates and `when` conditions so
 *  the active `RecordReader` records every `$record` key that this subtree actually touches. */
function touchSubtree(node: unknown, ctx: Ctx, env: Env): void {
  if (!node || typeof node !== 'object') return;
  const n = node as RNode & {
    item?: unknown;
    empty?: unknown;
    header?: unknown;
    footer?: unknown;
    sections?: { header?: unknown; body?: unknown; when?: unknown }[];
    data?: (c: Ctx, e: Env) => unknown;
    series?: (c: Ctx, e: Env) => unknown;
  };
  if (n.when && !holds(n.when, ctx, env)) return;
  if (n.text) fill(n.text, ctx, env);
  if (n.src) fill(n.src, ctx, env);
  if (n.label) fill(n.label, ctx, env);
  if (n.arg) fill(n.arg, ctx, env);
  if (n.args) {
    for (const v of Object.values(n.args)) fill(v, ctx, env);
  }
  if (n.base?.style) {
    for (const v of Object.values(n.base.style)) fill(v, ctx, env);
  }
  if (typeof n.data === 'function') n.data(ctx, env);
  if (typeof n.series === 'function') n.series(ctx, env);
  if (Array.isArray(n.children)) {
    for (const child of n.children) touchSubtree(child, ctx, env);
  }
  if (Array.isArray(n.sections)) {
    for (const sec of n.sections) {
      touchSubtree(sec.header, ctx, env);
      touchSubtree(sec.body, ctx, env);
    }
  }
}

interface CollectionSite {
  kind: string;
  items: Items;
  itemTemplate: unknown;
}

function collectSites(node: unknown, out: CollectionSite[] = []): CollectionSite[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as RNode & {
    items?: Items;
    item?: unknown;
    sections?: { header?: unknown; body?: unknown }[];
  };
  if (n.items && n.item) {
    out.push({ kind: n.kind, items: n.items, itemTemplate: n.item });
  }
  if (Array.isArray(n.children)) {
    for (const c of n.children) collectSites(c, out);
  }
  if (Array.isArray(n.sections)) {
    for (const s of n.sections) {
      collectSites(s.header, out);
      collectSites(s.body, out);
    }
  }
  return out;
}

export function auditRecordPushIsolation(
  doc: ScreenDocument,
  pageState: ScreenPageState,
  initialRecords: Record<string, { rev: number; value: unknown }>,
  pushedRecordKey: string,
): RecordPushAudit {
  const pool = new RecordStore();
  pool.merge(initialRecords);

  const resolved = resolveScreenDocument(doc, { width: 1920, tv: true, scale: 1 }, 'en', resolveUi(undefined));
  const env = { route: 'home', load: 'ready' } as unknown as Env;

  // 1. Simulate today's root `useRecordReader()` in `ScreenView` (`packages/skin/src/screen/host.tsx`):
  //    a single `seen` set at the root of `ScreenView` collects every record touched by any item.
  const rootSeen = new Set<string>();
  const rootReader: RecordReader = (key: string) => {
    rootSeen.add(key);
    return pool.get(key);
  };
  const rootCtx = screenRoot(pageState, rootReader, {});

  const sites = collectSites(resolved.tree);
  let totalCollectionItems = 0;
  let actualReaderItems = 0;

  for (const site of sites) {
    const itemCtxs = screenItems(site.items, rootCtx, env);
    for (const itemCtx of itemCtxs) {
      totalCollectionItems++;
      // Touch under the root reader (what today's ScreenView does):
      touchSubtree(site.itemTemplate, itemCtx, env);

      // Now touch under an isolated per-item RecordReader to see if THIS item actually reads pushedRecordKey:
      const itemSeen = new Set<string>();
      const itemReader: RecordReader = (key: string) => {
        itemSeen.add(key);
        return pool.get(key);
      };
      const isolatedCtx: Ctx = {
        ...itemCtx,
        screen: itemCtx.screen ? { ...itemCtx.screen, record: itemReader } : undefined,
      };
      touchSubtree(site.itemTemplate, isolatedCtx, env);
      if (itemSeen.has(pushedRecordKey)) {
        actualReaderItems++;
      }
    }
  }

  // Because `ScreenView` passes `rootReader` into `ctx = useMemo(() => screenRoot(page, record, state), [page, record, state])`,
  // when `pushedRecordKey` is in `rootSeen`, `useRecordReader()` in `ScreenView` bumps `version` and returns a new
  // `record` function reference, which recreates `rootCtx` and invalidates `SkinNode`'s `memo` check (`a.ctx === b.ctx`)
  // for every item on the page.
  const rootInvalidated = rootSeen.has(pushedRecordKey) ? totalCollectionItems : 0;

  return {
    pushedRecordKey,
    totalCollectionItems,
    actualReaderItems,
    currentRootInvalidatedItems: rootInvalidated,
    isolatedPerItemInvalidatedItems: actualReaderItems,
    rootReadsTotalRecords: rootSeen.size,
    isolatesToReadersOnly: rootInvalidated <= actualReaderItems,
    rootCause:
      'ScreenView (packages/skin/src/screen/host.tsx:102-111) calls useRecordReader() once at the root and passes that single RecordReader through screenRoot(page, record, state) to all ShelfBlock/GridBlock/repeat items. When any watched record updates, root `record` changes identity, recreating `ctx` and invalidating every item on the page instead of only the items reading that record.',
  };
}

/** Run the record-push reader audit against the Sports index fixture and data from a mock server. */
export async function auditSportsIndexRecordPush(mockOrigin: string): Promise<RecordPushAudit> {
  const root = resolve(import.meta.dir, '../..');
  const docPath = join(root, 'packages/protocol/fixtures/screens/sports/index.json');
  const rawDoc = JSON.parse(readFileSync(docPath, 'utf8')) as ScreenDocument;
  const doc: ScreenDocument = { ...rawDoc, screen: 'sports', page: 'index', presentation: 'section' };

  const headers = { 'X-Vela-Screen-Renderer': '19' };
  const res = await fetch(`${mockOrigin}/vela/v0/screens/sports/pages/index/data?tz=America/New_York`, { headers });
  if (!res.ok) throw new Error(`Sports index data read failed: HTTP ${res.status}`);
  const payload = (await res.json()) as {
    records: Record<string, { rev: number; value: unknown }>;
    sources: Record<string, unknown>;
  };

  const pageState: ScreenPageState = {
    href: '/vela/v0/screens/sports/pages/index/document',
    key: 'screen:sports:index',
    params: {},
    sources: payload.sources ?? {},
    pending: {},
    errors: {},
    load: 'ready',
    rev: 1,
  };

  return auditRecordPushIsolation(doc, pageState, payload.records ?? {}, 'event:sports:sports:nfl-nyg-phi');
}

// Measure the structural reader re-render blast radius of a single live record push on a resolved
// plugin screen document (budget: a record push re-renders only its readers in <= 2 frames).
//
// Evaluates every collection item (`shelf`, `grid`, `repeat`, `tabs`, `marquee`) on the page
// before and after pushing a single record (`event:sports:sports:nfl-nyg-phi`) into the shared
// record pool, counting:
//   1. `actualReaderItems`: how many item subtrees actually read the pushed record key.
//   2. `currentRootInvalidatedItems`: how many items are invalidated under the current
//      `ScreenView` (`packages/skin/src/screen/host.tsx`), `ScopedRecordNode`
//      (`packages/skin/src/blocks/record-scope.tsx`), and `SkinNode` (`packages/skin/src/render.tsx`).
//   3. `isolatedPerItemInvalidatedItems`: how many items are invalidated when every collection item
//      uses an isolated `RecordReader`.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ScreenDocument } from '../../packages/protocol/screen';
import type { ScreenPageState } from '../../packages/core/src/screens/types';
import { RecordStore } from '../../packages/core/src/screens/records';
import { sameScopedRecordProps } from '../../packages/skin/src/blocks/record-scope';
import { resolveScreenDocument } from '../../packages/skin/src/resolve/screen';
import { resolveUi } from '../../packages/skin/src/resolve/ui';
import { fill, holds, type RNode, type Template, type Test } from '../../packages/skin/src/resolve';
import { screenItems, screenRoot, type Items } from '../../packages/skin/src/screen/items';
import { refKey, type RecordReader } from '../../packages/skin/src/screen/scope';
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
  const n = node as {
    when?: Test[];
    text?: Template;
    src?: Template;
    label?: Template;
    arg?: Template;
    args?: Record<string, Template>;
    press?: { arg?: Template; args?: Record<string, Template> };
    base?: { style?: Record<string, Template> };
    children?: unknown[];
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
  if (n.press?.arg) fill(n.press.arg, ctx, env);
  if (n.press?.args) {
    for (const v of Object.values(n.press.args)) fill(v, ctx, env);
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
  const n = node as {
    kind?: string;
    items?: Items;
    item?: unknown;
    children?: unknown[];
    sections?: { header?: unknown; body?: unknown }[];
  };
  if (n.kind && n.items && n.item) {
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

const SCOPED_BLOCK_KINDS = new Set(['shelf', 'grid', 'marquee']);

function detectRuntimeIsolationArchitecture(): {
  hostSubscribesAtRoot: boolean;
  skinNodeUsesScopedReads: boolean;
  evalItemKeyAvoidsParentSubscribe: boolean;
} {
  const root = resolve(import.meta.dir, '../..');
  const hostPath = join(root, 'packages/skin/src/screen/host.tsx');
  const renderPath = join(root, 'packages/skin/src/render.tsx');
  const blockTypesPath = join(root, 'packages/skin/src/blocks/types.ts');

  const hostSrc = existsSync(hostPath) ? readFileSync(hostPath, 'utf8') : '';
  const renderSrc = existsSync(renderPath) ? readFileSync(renderPath, 'utf8') : '';
  const blockTypesSrc = existsSync(blockTypesPath) ? readFileSync(blockTypesPath, 'utf8') : '';

  return {
    hostSubscribesAtRoot: /\buseRecordReader\s*\(/.test(hostSrc),
    skinNodeUsesScopedReads: /\buseScopedReads\s*\(/.test(renderSrc),
    evalItemKeyAvoidsParentSubscribe: /\bnonSubscribingItemKey\b/.test(blockTypesSrc),
  };
}

export function auditRecordPushIsolation(
  doc: ScreenDocument,
  pageState: ScreenPageState,
  initialRecords: Record<string, { rev: number; value: unknown }>,
  pushedRecordKey: string,
): RecordPushAudit {
  const pool = new RecordStore();
  pool.merge(initialRecords);

  const arch = detectRuntimeIsolationArchitecture();
  const resolved = resolveScreenDocument(doc, { width: 1920, tv: true, scale: 1 }, 'en', resolveUi(undefined));
  const env = { route: 'home', load: 'ready' } as unknown as Env;

  const rootSeen = new Set<string>();
  const rootReaderRev1: RecordReader = (key: string) => {
    if (arch.hostSubscribesAtRoot) rootSeen.add(key);
    return pool.get(key);
  };
  const rootReaderRev2: RecordReader = (key: string) => pool.get(key);

  const nextPageState: ScreenPageState = { ...pageState, rev: pageState.rev + 1 };
  const rootCtxRev1 = screenRoot(pageState, rootReaderRev1, {});
  const rootCtxRev2 = screenRoot(nextPageState, rootReaderRev2, {});
  const renderNode = () => null;

  const sites = collectSites(resolved.tree);
  let totalCollectionItems = 0;
  let actualReaderItems = 0;
  let currentRootInvalidatedItems = 0;

  for (const site of sites) {
    const itemCtxsRev1 = screenItems(site.items, rootCtxRev1, env);
    const itemCtxsRev2 = screenItems(site.items, rootCtxRev2, env);
    const isScopedBlock = SCOPED_BLOCK_KINDS.has(site.kind);

    for (let i = 0; i < itemCtxsRev1.length; i++) {
      const itemCtx1 = itemCtxsRev1[i]!;
      const itemCtx2 = itemCtxsRev2[i] ?? itemCtx1;
      totalCollectionItems++;

      // When evalItemKey does not use refKey (nonSubscribingItemKey), key extraction in
      // ShelfBlock/GridBlock/MarqueeBlock evaluates `{e.id}` under the parent reader.
      if (isScopedBlock && site.items.key && !arch.evalItemKeyAvoidsParentSubscribe) {
        const as = site.items.as;
        const bound = as ? itemCtx1.screen?.items[as] : undefined;
        const rKey = refKey(bound?.value);
        if (rKey && arch.hostSubscribesAtRoot) {
          rootSeen.add(rKey);
        }
      }

      // Measure what this item subtree actually reads in its own isolated RecordReader:
      const itemSeen = new Set<string>();
      const itemReader: RecordReader = (key: string) => {
        itemSeen.add(key);
        return pool.get(key);
      };
      const isolatedCtx: Ctx = {
        ...itemCtx1,
        screen: itemCtx1.screen ? { ...itemCtx1.screen, record: itemReader } : undefined,
      };
      touchSubtree(site.itemTemplate, isolatedCtx, env);
      const readsPushedRecord = itemSeen.has(pushedRecordKey);
      if (readsPushedRecord) {
        actualReaderItems++;
      }

      // Check whether this item also touches the root reader or is isolated by ScopedRecordNode / useScopedReads:
      if (!isScopedBlock && !arch.skinNodeUsesScopedReads) {
        touchSubtree(site.itemTemplate, itemCtx1, env);
      }

      if (isScopedBlock) {
        // ShelfBlock, GridBlock, and MarqueeBlock wrap each item in <ScopedRecordNode>, which
        // short-circuits via sameScopedRecordProps unless the item's own reader subscribed to pushedRecordKey.
        const shortCircuitsParentPass = sameScopedRecordProps(
          { node: site.itemTemplate as RNode, ctx: itemCtx1, renderNode },
          { node: site.itemTemplate as RNode, ctx: itemCtx2, renderNode },
        );
        if (readsPushedRecord || !shortCircuitsParentPass) {
          currentRootInvalidatedItems++;
        }
      } else if (arch.skinNodeUsesScopedReads && !arch.hostSubscribesAtRoot) {
        // Each SkinNode uses useScopedReads() and ScreenView keeps drawnPage steady across rev bumps.
        if (readsPushedRecord) {
          currentRootInvalidatedItems++;
        }
      } else {
        // Without useScopedReads on SkinNode (e.g. repeat items in hero section), a rev bump or
        // root/section reader update re-renders the repeat items in that section.
        if (readsPushedRecord || rootSeen.has(pushedRecordKey)) {
          currentRootInvalidatedItems++;
        }
      }
    }
  }

  const isolatesToReadersOnly = currentRootInvalidatedItems <= actualReaderItems;

  return {
    pushedRecordKey,
    totalCollectionItems,
    actualReaderItems,
    currentRootInvalidatedItems,
    isolatedPerItemInvalidatedItems: actualReaderItems,
    rootReadsTotalRecords: rootSeen.size,
    isolatesToReadersOnly,
    rootCause: isolatesToReadersOnly
      ? 'Per-item ScopedRecordNode (ShelfBlock/GridBlock/MarqueeBlock) and per-node useScopedReads isolate live record pushes to only the items reading the pushed record.'
      : 'ScopedRecordNode isolates ShelfBlock/GridBlock/MarqueeBlock items, while ScreenView root useRecordReader() / repeat items without useScopedReads re-render on rev bump.',
  };
}

/** Run the record-push reader audit against the Sports index fixture and data from a mock server. */
export async function auditSportsIndexRecordPush(
  mockOrigin: string,
  authHeaders: Record<string, string> = {},
): Promise<RecordPushAudit> {
  const root = resolve(import.meta.dir, '../..');
  const docPath = join(root, 'packages/protocol/fixtures/screens/sports/index.json');
  const rawDoc = JSON.parse(readFileSync(docPath, 'utf8')) as ScreenDocument;
  const doc: ScreenDocument = { ...rawDoc, screen: 'sports', page: 'index', presentation: 'section' };

  const headers: Record<string, string> = {
    'X-Vela-Screen-Renderer': '19',
    ...authHeaders,
  };
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

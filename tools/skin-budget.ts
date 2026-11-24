/**
 * A skin document's performance report, read off the React renderer's resolved trees
 * (packages/skin/src/resolve.ts). The budgets and their reasons are
 * packages/skin/src/resolve/budget.ts's. Counts are upper bounds: every node counts, as if
 * each `when` held, and a repeat's item counts once.
 */
import type { CssT, Layer, ResolvedDocument, RNode } from '../packages/skin/src/resolve';
import { BUDGETS, type Finding, type PageCost, type PerfReport } from '../packages/skin/src/resolve/budget';

/** Collections that draw many items at once: what a node inside one costs is multiplied. */
const MANY = new Set([
  'row.items',
  'library.items',
  'collection.items',
  'detail.episodes',
  'detail.related',
  'detail.cast',
  'live.channels',
  'live.favorites',
  'search.titles',
  'search.descriptive',
  'search.ai',
  'search.onNow',
  'search.comingUp',
]);

const WHAT: Record<keyof typeof BUDGETS, string> = {
  nodes: 'nodes in the page',
  perItem: 'nodes per repeated item',
  imagesPerItem: 'images per repeated item',
  endlessPerItem: 'endless animations per item of a row, grid or list',
  blursPerItem: 'blur or backdrop filters per item of a row, grid or list',
};

interface Item {
  nodes: number;
  images: number;
  endless: number;
  blurs: number;
  many: boolean;
}

/** A style row's literal text (a bound row reads as empty: it cannot be judged before drawing). */
function row(style: CssT | undefined, name: string): string {
  const value = style?.[name];
  return typeof value === 'string' ? value : '';
}

function layers(node: RNode): CssT[] {
  const all: Layer[] = [node.base, ...node.states.map(s => s.layer)];
  return all.flatMap(l => [l.style, l.hover, l.focus, l.groupHover, l.groupFocus].filter((s): s is CssT => !!s));
}

function isEndless(node: RNode): boolean {
  if (node.motion?.iterations === 'infinite') return true;
  return layers(node).some(s => /infinite/.test(row(s, 'animation')));
}

function isBlurry(node: RNode): boolean {
  return layers(node).some(s => {
    const backdrop = row(s, 'backdrop-filter');
    return /blur\(/.test(row(s, 'filter')) || (backdrop !== '' && backdrop !== 'none');
  });
}

/** What a node draws inside it; the second list is drawn once per item (a repeat's or block's item). */
function children(node: RNode): RNode[] {
  switch (node.kind) {
    case 'box': case 'sections': return node.children;
    // A repeat that draws one item at most (a screen's hero) costs as the page, not per item.
    case 'repeat': return node.limit <= 1 ? [node.item] : [];
    case 'image': return node.fallback ? [node.fallback] : [];
    case 'shelf': return node.empty ? [node.empty] : [];
    case 'tabs': return node.after ?? [];
    default: return [];
  }
}

/** A block's repeated item (shelf, grid, marquee, tabs' chip), which costs as a repeat's does. */
function repeated(node: RNode): RNode | undefined {
  switch (node.kind) {
    case 'repeat': return node.limit <= 1 ? undefined : node.item;
    case 'shelf': case 'grid': case 'marquee': return node.item;
    case 'tabs': return node.chip;
    default: return undefined;
  }
}

function cost(route: string, tree: RNode): PageCost {
  const page: PageCost = { route, nodes: 0, perItem: 0, imagesPerItem: 0, endlessPerItem: 0, blursPerItem: 0, endless: 0, blurs: 0 };
  const walk = (node: RNode, item: Item | null) => {
    if (node.kind === 'slot') return;
    const each = repeated(node);
    const repeat = !!each;
    // A screen's shelves, grids and marquees draw many items; its repeats as many as they are given.
    const many = node.kind === 'repeat' ? MANY.has(node.over) || !!node.items : node.kind !== 'tabs';
    const own: Item | null = repeat ? { nodes: 0, images: 0, endless: 0, blurs: 0, many: many || !!item?.many } : item;
    const endless = isEndless(node);
    const blur = isBlurry(node);
    page.nodes++;
    if (endless) page.endless++;
    if (blur) page.blurs++;
    if (own && !repeat) {
      own.nodes++;
      if (node.kind === 'image') own.images++;
      if (endless) own.endless++;
      if (blur) own.blurs++;
    }
    for (const child of children(node)) walk(child, repeat ? item : own);
    if (each) walk(each, own);
    if (repeat && own) {
      page.perItem = Math.max(page.perItem, own.nodes);
      page.imagesPerItem = Math.max(page.imagesPerItem, own.images);
      if (own.many) {
        page.endlessPerItem = Math.max(page.endlessPerItem, own.endless);
        page.blursPerItem = Math.max(page.blursPerItem, own.blurs);
      }
    }
  };
  walk(tree, null);
  return page;
}

export function perfReport(resolved: ResolvedDocument): PerfReport {
  return treesReport([
    ...(resolved.shell ? [['shell', resolved.shell] as [string, RNode]] : []),
    ...Object.entries(resolved.routes).filter((e): e is [string, RNode] => !!e[1]),
  ]);
}

/** The report for named trees (a skin's routes, a screen's tree, loading and failure). */
export function treesReport(trees: readonly (readonly [string, RNode])[]): PerfReport {
  const pages = trees.map(([route, tree]) => cost(route, tree));
  const findings: Finding[] = [];
  for (const page of pages) {
    for (const key of Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]) {
      const value = page[key];
      const budget = BUDGETS[key];
      if (value > budget.fail) {
        findings.push({ level: 'error', route: page.route, message: `${WHAT[key]}: ${value}, over the limit of ${budget.fail}` });
      } else if (value > budget.warn) {
        findings.push({ level: 'warning', route: page.route, message: `${WHAT[key]}: ${value}, over the budget of ${budget.warn}` });
      }
    }
  }
  return { pages, findings };
}

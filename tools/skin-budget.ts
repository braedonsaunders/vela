/**
 * A skin document's performance report, read off the React renderer's resolved trees
 * (packages/skin/src/resolve.ts). The budgets and their reasons are client/src/skin/budget.ts's
 * (docs/performance.md, "Skin documents"). Counts are upper bounds: every node counts, as if
 * each `when` held, and a repeat's item counts once.
 */
import type { CssT, Layer, ResolvedDocument, RNode } from '../packages/skin/src/resolve/index';
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

function children(node: RNode): RNode[] {
  if (node.kind === 'box') return node.children;
  if (node.kind === 'repeat') return [node.item];
  return [];
}

function cost(route: string, tree: RNode): PageCost {
  const page: PageCost = { route, nodes: 0, perItem: 0, imagesPerItem: 0, endlessPerItem: 0, blursPerItem: 0, endless: 0, blurs: 0 };
  const walk = (node: RNode, item: Item | null) => {
    if (node.kind === 'slot') return;
    const repeat = node.kind === 'repeat';
    const own: Item | null = repeat
      ? { nodes: 0, images: 0, endless: 0, blurs: 0, many: MANY.has(node.over) || !!item?.many }
      : item;
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
    for (const child of children(node)) walk(child, own);
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
  const trees = [
    ...(resolved.shell ? [['shell', resolved.shell] as const] : []),
    ...Object.entries(resolved.routes).filter((e): e is [string, RNode] => !!e[1]),
  ];
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

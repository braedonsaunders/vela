/**
 * A skin document's performance budget, read off its resolved model (src/skin skinDoc). The
 * resolver refuses a document over a limit; the checker (`bun tools/skin.ts check <document>`)
 * prints the whole report. Counts are upper bounds: every node counts, as if each `when` held.
 *
 * Where the numbers come from (docs/performance.md, "Skin documents"): a page's cost is the
 * nodes it mounts, and a repeated item (a card) is mounted 20 at a time as a row arrives while
 * scrolling. Cinematic's card, at ~8 drawn nodes, scrolls a fresh row at 83 fps on an M4 Pro;
 * the cost is linear in the nodes. An endless animation or a blur inside a repeated item is
 * one per item: 20 a row, and a blur is an offscreen pass over its area every frame.
 */
import type { SkinDocModel } from './index';

/** Collections that draw many items at once (a row, a grid, a list): what a node inside one costs is multiplied. */
const MANY = new Set(['row.items', 'library.items', 'collection.items', 'detail.episodes', 'detail.related', 'detail.cast', 'live.channels', 'live.favorites', 'search.titles', 'search.descriptive', 'search.ai', 'search.onNow', 'search.comingUp']);

export const BUDGETS = {
  // Nodes in one page's tree (its repeats counted once).
  nodes: { warn: 320, fail: 1000 },
  // Nodes one repeated item draws.
  perItem: { warn: 24, fail: 48 },
  // Images one repeated item draws (each decodes and holds a texture).
  imagesPerItem: { warn: 4, fail: 8 },
  // Nodes with an endless animation, or a blur or backdrop filter, inside an item of a many-item collection.
  endlessPerItem: { warn: 0, fail: 4 },
  blursPerItem: { warn: 0, fail: 4 },
} as const;

type Level = Record<string, unknown> & { t: string; rep: string; kids?: Level[]; base: { s: number }; sts: { s: number }[]; mit: string };
export interface PageCost { route: string; nodes: number; perItem: number; imagesPerItem: number; endlessPerItem: number; blursPerItem: number; endless: number; blurs: number }
export interface Finding { level: 'warning' | 'error'; route: string; message: string }
export interface PerfReport { pages: PageCost[]; findings: Finding[] }

export function perfReport(model: SkinDocModel): PerfReport {
  const styles = model.styles as Record<string, string | number>[];
  const blurry = (i: number) => { const s = styles[i]; return !!s && (/blur\(/.test(String(s.filter ?? '')) || (s.backdropFilter !== '' && s.backdropFilter !== undefined && s.backdropFilter !== 'none')); };
  const endlessStyle = (i: number) => /infinite/.test(String(styles[i]?.animation ?? ''));
  const pages: PageCost[] = [];
  const trees = [{ name: 'shell', nodes: model.shell.nodes as Level[] }, ...model.routes.map(r => ({ name: r.name, nodes: r.nodes as Level[] }))];
  for (const tree of trees) {
    const page: PageCost = { route: tree.name, nodes: 0, perItem: 0, imagesPerItem: 0, endlessPerItem: 0, blursPerItem: 0, endless: 0, blurs: 0 };
    type Item = { nodes: number; images: number; endless: number; blurs: number; many: boolean };
    const walk = (ns: Level[], item: Item | null) => {
      for (const n of ns) {
        if (n.t === 'holder') continue;
        const own: Item | null = n.rep !== '' ? { nodes: 0, images: 0, endless: 0, blurs: 0, many: MANY.has(n.rep) || !!item?.many } : item;
        const states = [n.base, ...n.sts].map(x => x.s);
        const endless = n.mit === 'infinite' || states.some(endlessStyle), blur = states.some(blurry);
        page.nodes++; if (endless) page.endless++; if (blur) page.blurs++;
        if (own) { own.nodes++; if (n.t === 'image') own.images++; if (endless) own.endless++; if (blur) own.blurs++; }
        walk(n.kids ?? [], own);
        if (n.rep !== '' && own) {
          page.perItem = Math.max(page.perItem, own.nodes); page.imagesPerItem = Math.max(page.imagesPerItem, own.images);
          if (own.many) { page.endlessPerItem = Math.max(page.endlessPerItem, own.endless); page.blursPerItem = Math.max(page.blursPerItem, own.blurs); }
        }
      }
    };
    walk(tree.nodes, null);
    pages.push(page);
  }
  const findings: Finding[] = [];
  const what: Record<keyof typeof BUDGETS, string> = {
    nodes: 'nodes in the page', perItem: 'nodes per repeated item', imagesPerItem: 'images per repeated item',
    endlessPerItem: 'endless animations per item of a row, grid or list', blursPerItem: 'blur or backdrop filters per item of a row, grid or list',
  };
  for (const p of pages) for (const key of Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]) {
    const v = p[key], b = BUDGETS[key];
    if (v > b.fail) findings.push({ level: 'error', route: p.route, message: `${what[key]}: ${v}, over the limit of ${b.fail}` });
    else if (v > b.warn) findings.push({ level: 'warning', route: p.route, message: `${what[key]}: ${v}, over the budget of ${b.warn}` });
  }
  return { pages, findings };
}

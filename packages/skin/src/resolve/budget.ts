// Shared performance limits and report shapes for the React skin document budget checker.
// The traversal lives in tools/skin-budget.ts and reads the React resolver tree.

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

export interface PageCost { route: string; nodes: number; perItem: number; imagesPerItem: number; endlessPerItem: number; blursPerItem: number; endless: number; blurs: number }
export interface Finding { level: 'warning' | 'error'; route: string; message: string }
export interface PerfReport { pages: PageCost[]; findings: Finding[] }


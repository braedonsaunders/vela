// How a generic table (standings, box scores) fits its width: each column as wide as its content,
// the names column (the widest words) given room to read whole, numbers tight, and, when the room
// runs out, the least useful columns dropped rather than a name cut short. Pure, so it is tested
// without a renderer; widths are estimated from the text (no measuring pass, no layout jump).
import type { LiveTable } from '@vela/core';

/** Em widths of a proportional UI face, near enough for laying out columns. */
const NARROW = /[il.,:;'|!1Ijtf()[\]\s]/;
const WIDE = /[MWmw@%]/;
const UPPER = /[A-Z]/;

/** About how wide `text` is at `size` (in the same unit as `size`). Digits are tabular. */
export function textWidth(text: string, size: number, bold = false): number {
  let em = 0;
  for (const ch of text) {
    if (/\d/.test(ch)) em += 0.62;
    else if (NARROW.test(ch)) em += 0.3;
    else if (WIDE.test(ch)) em += 0.86;
    else if (UPPER.test(ch)) em += 0.68;
    else em += 0.55;
  }
  return em * size * (bold ? 1.06 : 1);
}

/** Header labels that carry a table's verdict (wins, losses, points, games back) and stay longest. */
const KEY = new Set(['W', 'L', 'D', 'PTS', 'P', 'PCT', 'GB', 'GD', 'TOT', 'TOTAL']);

const dash = (cell: string) => cell === '' || cell === '–' || cell === '-' || cell === '—';

/** A table's numeric columns align right; its first (names) left. */
export function numericColumn(rows: readonly (readonly string[])[], column: number): boolean {
  // A lone capital among numbers ("E" for even par) reads as a value, not a word.
  const cells = rows.map(row => row[column] ?? '').filter(cell => !dash(cell) && !/^[A-Z]$/.test(cell));
  // A column of only dashes (a round not played yet) sits with the numbers.
  if (!cells.length) return rows.some(row => dash(row[column] ?? '') && (row[column] ?? '') !== '');
  return cells.every(cell => /^[+\-−]?[\d.:%/–-]+[a-zA-Z]{0,3}$/.test(cell) || /^[WLTD]\d{1,2}$/.test(cell));
}

export interface ColumnFit {
  /** The column's index in the table. */
  index: number;
  width: number;
  align: 'left' | 'right';
  /** The names column: it takes any room left over, and is the one that ellipsises if it must. */
  name: boolean;
}

export interface TableFit {
  columns: ColumnFit[];
  /** The columns' total width before any were dropped or squeezed: the room the table would like. */
  natural: number;
  dropped: number[];
}

export interface FitText {
  /** Body and header type sizes, in the unit widths are wanted in. */
  size: number;
  headerSize: number;
  /** Space between columns. */
  gap: number;
}

/**
 * Fits `table` into `width` (Infinity for its natural size). The names column is the first text
 * column with the longest content; a leading short numeric column (the position) and the key
 * columns are kept longest; others are dropped from the right until the names read whole, but a
 * names column never shrinks below its full width (to about twenty letters) to keep a column.
 */
export function fitTable(table: LiveTable, width: number, text: FitText): TableFit {
  const count = table.columns.length;
  const numeric = table.columns.map((_, n) => numericColumn(table.rows, n));
  const longest = (n: number) => Math.max(0, ...table.rows.map(row => (row[n] ?? '').length));
  // The names column: the text column whose cells run longest (ties go to the leftmost).
  let name = -1;
  for (let n = 0; n < count; n++) if (!numeric[n] && (name < 0 || longest(n) > longest(name))) name = n;
  const natural = table.columns.map((header, n) => {
    const cells = Math.max(0, ...table.rows.map(row => textWidth(row[n] ?? '', text.size, n === name)));
    // A little over the estimate (faces differ), and the gap that keeps it off its neighbour.
    return Math.ceil(Math.max(textWidth(header, text.headerSize, true), cells) * 1.08 + 2 + text.gap);
  });
  const total = natural.reduce((sum, w) => sum + w, 0);
  // The names keep their full width (up to about twenty letters) before any column is kept.
  const floor = name >= 0 ? Math.min(natural[name]!, Math.ceil(20 * 0.55 * text.size * 1.06 + text.gap)) : 0;
  // Drop order: the least useful first, from the right; never the names, the position or a key column.
  const priority = (n: number) => {
    if (n === name) return 1000;
    if (n === 0 && numeric[0] && longest(0) <= 3) return 900;
    if (KEY.has(table.columns[n]!.trim().toUpperCase())) return 500 - n;
    return 100 - n;
  };
  const order = [...Array(count).keys()].filter(n => priority(n) < 900).sort((a, b) => priority(a) - priority(b));
  const kept = new Set(Array.from({ length: count }, (_, n) => n));
  const dropped: number[] = [];
  const sum = () => [...kept].reduce((s, n) => s + natural[n]!, 0);
  for (const n of order) {
    if (sum() <= width) break;
    // Keep this column if the names can give up the difference and still read whole.
    if (name >= 0 && sum() - (natural[name]! - floor) <= width) break;
    kept.delete(n);
    dropped.push(n);
  }
  const columns: ColumnFit[] = [...kept].sort((a, b) => a - b).map(n => ({ index: n, width: natural[n]!, align: numeric[n] ? 'right' : 'left', name: n === name }));
  if (columns[0] && !columns[0].name && columns[0].index === 0) columns[0].align = 'left';
  if (Number.isFinite(width)) {
    // Room to spare widens the other columns a little (up to half again) so a wide table does not
    // leave its numbers far from the names; the names take the rest, or give up what is short.
    let extra = width - columns.reduce((s, c) => s + c.width, 0);
    const others = columns.filter(c => !c.name);
    // Numbers first share one width (an even grid of columns), when the room allows it.
    const numbers = others.filter(c => numeric[c.index] && !(c.index === 0 && c.align === 'left'));
    const even = Math.max(0, ...numbers.map(c => c.width));
    const evenCost = numbers.reduce((s, c) => s + (even - c.width), 0);
    if (numbers.length > 1 && evenCost <= extra) { for (const c of numbers) c.width = even; extra -= evenCost; }
    if (extra > 0 && others.length) {
      const room = others.reduce((s, c) => s + c.width * 0.5, 0);
      const share = Math.min(1, extra / 2 / room);
      for (const c of others) { const add = Math.floor(c.width * 0.5 * share); c.width += add; extra -= add; }
    }
    const names = columns.find(c => c.name);
    if (names) names.width = Math.max(0, Math.floor(names.width + extra));
  }
  return { columns, natural: total, dropped: dropped.sort((a, b) => a - b) };
}

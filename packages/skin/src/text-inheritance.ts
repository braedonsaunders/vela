import type { Css } from './translate';
import { fontSizeOf, type Viewport } from './css';
import { inheritRows } from './inherit-rows';

export interface InheritedText { rows: Css; fontSize: number }

// Every box provides the text it passes on as a context value. A fresh object on each draw made
// every box below redraw whenever any box above did (a shell draw redrew every retained section),
// so equal text from the same parent is the same object.
const memo = new WeakMap<object, Map<string, InheritedText>>();
const MEMO_LIMIT = 64;

/** Inherited sizes are already in native points; reparsing them as CSS px scales them twice. */
export function inheritText(parent: InheritedText, inherited: Css, viewport: Viewport): InheritedText {
  const keys = Object.keys(inherited);
  if (!keys.length) return parent;
  let known = memo.get(parent);
  if (!known) memo.set(parent, known = new Map());
  let key = `${viewport.width}x${viewport.height}`;
  for (const row of keys.sort()) key += `|${row}:${inherited[row]}`;
  const held = known.get(key);
  if (held) return held;
  const rows = inheritRows(parent.rows, inherited);
  const fontSize = fontSizeOf(rows['font-size'], parent.fontSize, { viewport, fontSize: parent.fontSize, axis: 'x' });
  const text = { rows: { ...rows, 'font-size': String(fontSize) }, fontSize };
  if (known.size >= MEMO_LIMIT) known.clear();
  known.set(key, text);
  return text;
}

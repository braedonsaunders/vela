// A rich block's named parts (packages/protocol/rich-blocks.ts): the document's style for each part,
// already merged by the resolver (document parts < node parts < the skin's experiences.<id>.parts),
// filled once per block, then layered over the block's own look in the state the part is in.
// Pure: the drawing side (look.tsx) turns rows into styles.

/** One part's rows as CSS, in each state the part can be in. */
export interface FilledPart {
  style: Record<string, string>;
  hover?: Record<string, string>;
  focus?: Record<string, string>;
  active?: Record<string, string>;
}

export type FilledParts = Readonly<Record<string, FilledPart>>;

export interface PartState {
  hover?: boolean;
  focus?: boolean;
  /** Pressed. */
  active?: boolean;
}

/** Rows a child text inherits (translate.ts INHERITED): a part's text rows apply to its text. */
const TEXT_ROWS = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-transform', 'text-align', 'white-space', 'font-variant-numeric', 'text-shadow', 'text-decoration-line']);

export const NO_ROWS: Readonly<Record<string, string>> = Object.freeze({});

/** Fill every part's templates (the resolver's CssT) with `fill`. */
export function fillParts<T>(parts: Readonly<Record<string, { style: Record<string, T>; hover?: Record<string, T>; focus?: Record<string, T>; active?: Record<string, T> }>> | undefined,
  fill: (template: T) => string): FilledParts {
  const out: Record<string, FilledPart> = {};
  const rows = (css: Record<string, T> | undefined) => {
    if (!css) return undefined;
    const filled: Record<string, string> = {};
    for (const [row, value] of Object.entries(css)) {
      const text = fill(value);
      if (text !== '') filled[row] = text;
    }
    return filled;
  };
  for (const [name, part] of Object.entries(parts ?? {})) {
    out[name] = { style: rows(part.style) ?? {}, ...(part.hover ? { hover: rows(part.hover) } : {}), ...(part.focus ? { focus: rows(part.focus) } : {}),
      ...(part.active ? { active: rows(part.active) } : {}) };
  }
  return out;
}

/** The rows of `name` in force for `state`: the base, then hover, focus (a TV with no focus look
 * shows its hover look, as skin nodes do) and pressed. Several names layer in order (a row, then
 * the active row's look over it). */
export function partRows(parts: FilledParts, names: string | readonly (string | false | undefined)[], state: PartState = {}, tv = false): Record<string, string> {
  const list = typeof names === 'string' ? [names] : names;
  let out: Record<string, string> | undefined;
  const add = (rows: Record<string, string> | undefined) => {
    if (!rows) return;
    for (const key in rows) { out ??= {}; out[key] = rows[key]!; }
  };
  for (const name of list) {
    if (!name) continue;
    const part = parts[name];
    if (!part) continue;
    add(part.style);
    if (state.hover) add(part.hover);
    if (state.focus) add(part.focus ?? (tv ? part.hover : undefined));
    if (state.active) add(part.active);
  }
  return out ?? NO_ROWS;
}

/** A part's rows split into the box's own and the ones its text takes. */
export function splitRows(rows: Readonly<Record<string, string>>): { box: Record<string, string>; text: Record<string, string> } {
  const box: Record<string, string> = {}, text: Record<string, string> = {};
  for (const [row, value] of Object.entries(rows)) (TEXT_ROWS.has(row) ? text : box)[row] = value;
  return { box, text };
}

/** Whether a part has anything to apply (a block with no parts draws exactly its own look). */
export function hasRows(rows: Readonly<Record<string, string>>): boolean {
  for (const _ in rows) return true;
  return false;
}

// The parts API on the drawing side: a Listen block publishes its document's parts (filled once)
// and part templates to the engine under it, and the engine layers each part over its own look.
// Without a block around it (the music app as drawn today) there are no parts and no templates,
// so the engine draws exactly as it always has.
import { createContext, useContext, type ReactNode } from 'react';
import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { useMediaLook } from '../../widgets/media/parts';
import { hasRows, partRows, splitRows, type FilledParts, type PartState } from './part-style';

export interface ListenLook {
  parts: FilledParts;
  /** Draws a part's template for one item (`{item.*}`, `{part.*}`), or nothing when the document has none. */
  template?(name: string, item: unknown, part: Record<string, unknown>, index: number): ReactNode | null;
  /** The part templates the document gives. */
  templates?: ReadonlySet<string>;
}

const NONE: ListenLook = { parts: {} };
const ListenLookContext = createContext<ListenLook>(NONE);

export function ListenLookProvider({ look, children }: { look: ListenLook; children: ReactNode }) {
  return <ListenLookContext.Provider value={look}>{children}</ListenLookContext.Provider>;
}

export function useListenLook(): ListenLook {
  return useContext(ListenLookContext);
}

export interface PartLook {
  /** The part's box rows as a style (undefined when it has none: layer it last). */
  box?: ViewStyle;
  /** Its text rows as a style. */
  text?: TextStyle;
}

const EMPTY: PartLook = {};

/** The look of one part (or several layered: a row, then the active row) in a state. */
export function usePart(names: string | readonly (string | false | undefined)[], state?: PartState): PartLook {
  const { parts } = useListenLook();
  const m = useMediaLook();
  const rows = partRows(parts, names, state, Platform.isTV);
  if (!hasRows(rows)) return EMPTY;
  const { box, text } = splitRows(rows);
  return { box: hasRows(box) ? m.box(box) : undefined, text: hasRows(text) ? partText(m.text(text), text) : undefined };
}

/** The look's text style fills in the skin's font and ink; a part sets only the rows it gives,
 * so the engine's own colour (an active row's accent) stays unless the part changes it. */
function partText(style: TextStyle, rows: Record<string, string>): TextStyle {
  const out: Record<string, unknown> = { ...style };
  if (!('color' in rows)) delete out.color;
  if (!('font-family' in rows)) delete out.fontFamily;
  return out as TextStyle;
}

/** A part's box look as a function of state, for styles computed from the state a control is in
 * (a Surface's `style(lit, focus)`); undefined while the document styles none of `names`. */
export function usePartStyler(names: readonly (string | false | undefined)[]): ((state: PartState) => ViewStyle | undefined) | undefined {
  const { parts } = useListenLook();
  const m = useMediaLook();
  if (!names.some(name => name && parts[name])) return undefined;
  return state => {
    const { box } = splitRows(partRows(parts, names, state, Platform.isTV));
    return hasRows(box) ? m.box(box) : undefined;
  };
}

/** Whether the document gives a template for `name`. */
export function useHasTemplate(name: string): boolean {
  const look = useListenLook();
  return !!look.template && !!look.templates?.has(name);
}

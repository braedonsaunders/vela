// What every skin node and widget reads: the host (document, view state, actions, images), the
// inherited text rows, and the nearest group's hover and focus. Widgets import these hooks; the
// renderer provides them.
import type { ImageSource } from 'expo-image';
import { createContext, useContext, type ReactNode } from 'react';
import type { Action } from '../../protocol/skin';
import { PX, type Measure, type Viewport } from './css';
import type { ResolvedDocument } from './resolve';
import { textStyle, type Css } from './translate';
import type { Ctx, Env } from './vocabulary';

/** What the app gives the renderer. Areas add their capabilities (a live controller, the player
 * view) by augmenting this interface from their own files. */
export interface SkinHost {
  doc: ResolvedDocument;
  env: Env;
  viewport: Viewport;
  dispatch(action: Action, arg: string): void;
  /** An image source for a document path: an app asset, the document's own asset, or a URL. */
  image(src: string): ImageSource | number | undefined;
  openRow?(row: import('@vela/core').Row): void;
  refreshHeroArtwork?(id: string): Promise<{ backdrop: string; poster: string } | undefined>;
  setQuery(query: string): void;
  setFlag(flag: string, on: boolean): void;
  setPager(rowId: string, state: { atStart: boolean; atEnd: boolean }): void;
  /** Ask for the next page of a row, home, a library or a collection (the `sentinel` widget). */
  loadMore(on: 'row' | 'home' | 'library' | 'collection', id: string): void;
  /** Where the shell draws the route (slot `children`). */
  children?: ReactNode;
}

export interface InheritedText { rows: Css; fontSize: number }
export interface GroupState { hover: boolean; focus: boolean; report(kind: 'hover' | 'focus', on: boolean): void }

export const HostContext = createContext<SkinHost | null>(null);
export const InheritedContext = createContext<InheritedText>({ rows: {}, fontSize: 16 * PX });
export const GroupContext = createContext<GroupState | null>(null);

export function useHost(): SkinHost {
  const host = useContext(HostContext);
  if (!host) throw new Error('Skin nodes draw inside <SkinRoot>');
  return host;
}

/** The text rows in force where a widget draws, translated: colour, font, size, spacing. */
export function useInheritedText() {
  const host = useHost();
  const text = useContext(InheritedContext);
  return textStyle(text.rows, measure(host.viewport, text.fontSize));
}

export function measure(viewport: Viewport, fontSize: number): Measure {
  return { viewport, fontSize, axis: 'x' };
}

/** A widget: its document parameters (strings already filled) and the binding context it sits in.
 * The renderer draws the node's own box (style, motion, inherited text) around it. */
export interface WidgetProps {
  params: Record<string, string>;
  ctx: Ctx;
}
export type { Ctx, Env };

/** A widget's own hover and focus, which its node's hover and focus looks follow (a text field's
 * focus ring, say). Call report from the widget's own onFocus/onBlur and hover handlers. */
export interface WidgetInteraction { report(kind: 'hover' | 'focus', on: boolean): void }
export const WidgetInteractionContext = createContext<WidgetInteraction>({ report: () => undefined });
export function useWidgetInteraction(): WidgetInteraction {
  return useContext(WidgetInteractionContext);
}

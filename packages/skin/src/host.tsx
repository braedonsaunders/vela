// What every skin node and widget reads: the host (document, view state, actions, images), the
// inherited text rows, and the nearest group's hover and focus. Widgets import these hooks; the
// renderer provides them.
import type { ImageSource } from 'expo-image';
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Action } from '../../protocol/skin';
import { PX, type Measure, type Viewport } from './css';
import type { ResolvedDocument } from './resolve';
import { textStyle, type Css } from './translate';
import type { Ctx, Env } from './vocabulary';
import { HostReader, HostSource } from './host-source';
export { HostReader, HostSource } from './host-source';

/** What the app gives the renderer. Areas add their capabilities (a live controller, the player
 * view) by augmenting this interface from their own files. */
export interface SkinHost {
  doc: ResolvedDocument;
  env: Env;
  viewport: Viewport;
  dispatch(action: Action, arg: string): void;
  /** Screens (renderer 19): a press inside a screen or surface document, its arguments filled.
   * When present it receives every press drawn with a screen scope instead of `dispatch`. */
  screenPress?(press: ScreenPress): void;
  /** A canonical web destination for a navigation action; absent for non-navigation actions. */
  href?(action: Action, arg: string): string | undefined;
  /** An image source for a document path: an app asset, the document's own asset, or a URL. */
  image(src: string): ImageSource | number | undefined;
  openRow?(row: import('@vela/core').Row): void;
  rowHref?(row: import('@vela/core').Row): string;
  refreshHeroArtwork?(id: string): Promise<{ backdrop: string; poster: string } | undefined>;
  setQuery(query: string): void;
  setFlag(flag: string, on: boolean): void;
  /** Ask for the next page of a row, home, a library or a collection (the `sentinel` widget). */
  loadMore(on: 'row' | 'home' | 'library' | 'collection', id: string): void;
  /** A pointer is over, focus is on or a press began on a control with this press: the app may
   * read ahead what it will open (a section's first page). Never navigates. */
  prefetch?(action: Action, arg: string): void;
  /** Native touch pull-to-refresh for the current route, when it has a refreshable answer. */
  refresh?(): void;
  refreshing?: boolean;
  /** Where the shell draws the route (slot `children`). */
  children?: ReactNode;
}

/** A screen document's press, filled where it was drawn (docs/plugin-screens.md: Actions). */
export interface ScreenPress {
  action: Action;
  arg: string;
  args: Record<string, string>;
  optimistic?: { record?: string; source?: string; path: string; value: string };
  /** The pressed control's identity (its id, test id or label), for its busy state. */
  control: string;
}

export interface InheritedText { rows: Css; fontSize: number }
export interface GroupState { hover: boolean; focus: boolean; report(kind: 'hover' | 'focus', on: boolean): void }

/** A route tree's host as its nodes read it (TrackedHost); any other provider gives a plain host. */
export const HostContext = createContext<SkinHost | HostSource | null>(null);
export const InheritedContext = createContext<InheritedText>({ rows: {}, fontSize: 16 * PX });
export const GroupContext = createContext<GroupState | null>(null);

export function useHost(): SkinHost {
  const value = useContext(HostContext);
  const tracked = useTrackedHost(value instanceof HostSource ? value : null);
  if (tracked) return tracked;
  if (!value) throw new Error('Skin nodes draw inside <SkinRoot>');
  return value as SkinHost;
}

/** As useHost, or null outside any host (a guide over the player). */
export function useOptionalHost(): SkinHost | null {
  const value = useContext(HostContext);
  const tracked = useTrackedHost(value instanceof HostSource ? value : null);
  return tracked ?? (value as SkinHost | null);
}

type Listener = () => void;
const unsubscribed = () => {};
const noVersion = () => 0;

function useTrackedHost(source: HostSource | null): SkinHost | null {
  const reader = useRef<HostReader | null>(null);
  if (source && reader.current?.source !== source) reader.current = new HostReader(source);
  const current = source ? reader.current : null;
  const subscribe = useCallback((notify: Listener) => (current ? current.source.subscribe(notify) : unsubscribed), [current]);
  const snapshot = current ? current.snapshot : noVersion;
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return current ? current.host : null;
}

/** Gives a tree its host through a tracked source (see useHost). */
export function TrackedHost({ host, children }: { host: SkinHost; children: ReactNode }) {
  const [source] = useState(() => new HostSource(host));
  // Nodes drawn in this pass read the host being drawn; the rest hear of it once it is committed.
  source.latest = host;
  useLayoutEffect(() => source.publish(host), [source, host]);
  return <HostContext.Provider value={source}>{children}</HostContext.Provider>;
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

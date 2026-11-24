// One plugin surface drawn in a host slot (docs/plugin-screens.md: Surfaces): its document through
// the screen host (ScreenView, inline rather than as a route), opened with the context Ether reads
// and given the client-only context beside it. A surface is quiet: nothing draws until its first
// read answers, and one that is refused, fails, answers 404 or throws while drawing is left out
// silently, so a plugin's surface can never break the player, a toast or Home.
import { Component, createContext, useContext, useMemo, type ReactNode } from 'react';
import type { SurfaceContext, SurfaceContribution } from '../../../protocol/screen';
import { colour } from '../css';
import type { SkinHost } from '../host';
import { Unfocusable } from '../render';
import { resolveUi } from '../resolve/ui';
import { uiDefaults } from '../resolve/ui-defaults';
import { ScreenView, type ScreenAppActions } from '../screen/host';
import { playerPalette } from '../widgets/player/palette';

/** What the app does for surfaces: the screen actions that leave a surface (open a page, play, add to
 * the multiview, open a link, confirm), `watch` (tune a channel, or an event's primary target), and
 * the remote's play/pause key, which a standing toast may take from a playing player. */
export interface SurfaceApp {
  /** Plugin surfaces draw (while the hard-coded overlays still exist, the development flag). */
  enabled: boolean;
  actions: Omit<ScreenAppActions, 'setParams' | 'back' | 'dismiss'>;
  claimPlayPause?(onPress: () => void): () => void;
}

export const SurfaceAppContext = createContext<SurfaceApp | null>(null);
export const useSurfaceApp = () => useContext(SurfaceAppContext);

/** Whether plugin surfaces draw here (the app says so). */
export function useSurfacesEnabled(): boolean {
  return useContext(SurfaceAppContext)?.enabled === true;
}

const COLOUR_KEYS = Object.keys(uiDefaults).filter(k => typeof uiDefaults[k as keyof typeof uiDefaults] === 'string' && k !== 'font' && k !== 'fontDisplay');

/** The skin's look with the player's palette over it (video has no page colour), as the chrome draws. */
export function playerDoc(doc: SkinHost['doc']): SkinHost['doc'] {
  const document = doc.document;
  const ui = resolveUi(document.ui);
  const colours: Record<string, string> = {};
  for (const name of COLOUR_KEYS) colours[name] = colour(String(ui[name as keyof typeof ui])) ?? String(uiDefaults[name as keyof typeof uiDefaults]);
  return { ...doc, document: { ...document, ui: { ...document.ui, ...playerPalette(colours) } } };
}

/** Drops a surface that throws while drawing: it is logged once and draws nothing from then on. */
class Boundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn(`surface ${this.props.id} dropped: ${error instanceof Error ? error.message : String(error)}`); }
  render() { return this.state.failed ? null : this.props.children; }
}

export interface SurfaceViewProps {
  surface: SurfaceContribution;
  /** What Ether reads (p.event, p.channel, p.title, p.kind, p.alert.ref) and what stays here. */
  context: { server: SurfaceContext; local?: SurfaceContext };
  host: SkinHost;
  /** Drawn now: its data is followed live only while shown. */
  active?: boolean;
  /** Draw in the player's palette (overlays and toasts over the picture). */
  overPicture?: boolean;
  /** Presses take no focus (a player overlay while the chrome is hidden). */
  unfocusable?: boolean;
  /** A toast dismissing itself. */
  dismiss?(): void;
}

const NONE: ScreenAppActions = {
  navigate() {}, setParams() {}, play() {}, openLink() {}, back() {}, confirm: () => Promise.resolve(false), toast() {},
};

export function SurfaceView({ surface, context, host, active = true, overPicture = false, unfocusable = false, dismiss }: SurfaceViewProps) {
  const app = useSurfaceApp();
  // The document resolves once per look: the palette is derived from the skin's document, not per render.
  const doc = useMemo(() => (overPicture ? playerDoc(host.doc) : host.doc), [host.doc, overPicture]);
  const drawn = useMemo(() => (doc === host.doc ? host : { ...host, doc }), [host, doc]);
  const channel = context.server.channel ?? context.local?.channel;
  const actions = useMemo<ScreenAppActions>(() => {
    const base = app?.actions;
    return {
      ...NONE, ...base, setParams() {}, back() {},
      ...(dismiss ? { dismiss } : {}),
      // Watch with no channel and no event tunes the channel the surface is about.
      watch: args => base?.watch?.(args.channel || args.event ? args : { ...args, ...(channel ? { channel } : {}) }),
    };
  }, [app, dismiss, channel]);
  const target = useMemo(() => ({ kind: 'surface' as const, id: surface.id }), [surface.id]);
  return (
    <Boundary id={surface.id}>
      <Unfocusable.Provider value={unfocusable}>
        <ScreenView target={target} href={surface.document.href} context={context.server} local={context.local} host={drawn}
          active={active} actions={actions} route={false} quiet />
      </Unfocusable.Provider>
    </Boundary>
  );
}

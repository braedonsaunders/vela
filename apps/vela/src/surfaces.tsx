// Plugin surfaces in the app frame (docs/plugin-screens.md: Surfaces): what their presses do here
// (the screen actions, and `watch`: tune a channel, or the primary target of an event the surface
// shows), the remote's play/pause for a standing toast, and the toast stack over every screen. The
// player draws its own overlays and toasts (packages/skin/src/surfaces).
import { router, usePathname } from 'expo-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useVela as useCore } from '@vela/core/react';
import { HostContext } from '@vela/skin/src/host';
import { usePlayerLook } from '@vela/skin/src/widgets/player/look';
import { SurfaceAppContext, type SurfaceApp } from '@vela/skin/src/surfaces/view';
import { AppToasts } from '@vela/skin/src/surfaces/toasts';
import { HomeRowSurface, TitlePanels } from '@vela/skin/src/surfaces/slots';
import { SurfaceSlots, type SurfaceSlotViews } from '@vela/skin/src/render';
import { claimPlayPause } from '@vela/player';
import { useAppScreenActions } from './screen-actions';
import { useVela } from './vela';

/** A record key's id (`channel:ch-1` -> `ch-1`). */
const bare = (value: string) => value.replace(/^(channel|event):/, '');
const NOOP = () => {};

export function SurfaceProvider({ children }: { children: ReactNode }) {
  const vela = useVela();
  const core = useCore();
  const host = vela.host('home', '');
  const screen = useAppScreenActions({ host, back: NOOP, setParams: NOOP });
  // Watch: the channel named, else the event's primary target (its record is in the pool: the
  // surface that offers Watch draws it).
  const watch = useCallback((args: Record<string, string>) => {
    const event = args.event ? core.screens.records.get(args.event.startsWith('event:') ? args.event : `event:${args.event}`)?.value : undefined;
    const primary = (event as { watch?: { primary?: { channelId?: string } } } | undefined)?.watch?.primary?.channelId;
    const channel = args.channel ? bare(args.channel) : primary ?? '';
    if (channel) router.navigate({ pathname: '/watch/[id]', params: { id: channel, kind: 'channel' } });
  }, [core]);
  const enabled = true;
  const value = useMemo<SurfaceApp>(() => ({ enabled, actions: { ...screen, watch }, claimPlayPause }), [enabled, screen, watch]);
  return (
    <SurfaceAppContext.Provider value={value}>
      <SurfaceSlots.Provider value={enabled ? SLOTS : null}>{children}</SurfaceSlots.Provider>
    </SurfaceAppContext.Provider>
  );
}

/** Home rows and title panels that plugins fill, drawn by the skin's pages in their places. */
const SLOTS: SurfaceSlotViews = { row: HomeRowSurface, titlePanels: TitlePanels };

const SIGNED_OUT = ['/sign-in', '/connect'];

/** The alert toasts over every screen (an open player draws its own). */
export function SurfaceToasts() {
  const vela = useVela();
  const pathname = usePathname();
  const signedIn = !SIGNED_OUT.some(path => pathname.startsWith(path));
  const host = vela.host('home', '');
  if (!host || !signedIn) return null;
  return (
    <HostContext.Provider value={host}>
      <Placed />
    </HostContext.Provider>
  );
}

function Placed() {
  const look = usePlayerLook();
  const vela = useVela();
  const viewport = vela.host('home', '')?.viewport;
  // Below the sections' top bar, so a toast never covers navigation, search or the profile.
  const top = (viewport?.insets.top ?? 0) + (look.small ? 64 : look.size(100));
  const right = (viewport?.sides?.right ?? viewport?.insets.right ?? 0) + look.gutter;
  return <AppToasts look={look} top={top} right={right} />;
}

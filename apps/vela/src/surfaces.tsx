// Plugin surfaces in the app frame (docs/plugin-screens.md: Surfaces): what their presses do here
// (the screen actions, and `watch`: tune a channel, or the primary target of an event the surface
// shows), the remote's play/pause for a standing toast, and the toast stack over every screen. The
// player draws its own overlays and toasts (packages/skin/src/surfaces).
import { usePathname } from 'expo-router';
import { router } from './router';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useVela as useCore } from '@vela/core/react';
import { HostContext } from '@vela/skin/src/host';
import { usePlayerLook } from '@vela/skin/src/widgets/player/look';
import { SurfaceAppContext, type SurfaceApp } from '@vela/skin/src/surfaces/view';
import { AppToasts } from '@vela/skin/src/surfaces/toasts';
import { HomeRowSurface, PluginSlotSurfaces, TitlePanels } from '@vela/skin/src/surfaces/slots';
import { SurfaceSlots, type SurfaceSlotViews } from '@vela/skin/src/render';
import { claimPlayPause } from '@vela/player';
import { useAppScreenActions } from './screen-actions';
import { useVela } from './vela';
import { surfaceToastPlacement } from './surface-toast-placement';

interface ToastChrome {
  title?: { path: string; controls: Record<string, number> };
  photosFullscreen: number;
}
const ToastChromeState = createContext<ToastChrome>({ photosFullscreen: 0 });
const SetToastChrome = createContext<React.Dispatch<React.SetStateAction<ToastChrome>> | null>(null);

export function useTitleToastChrome(active: boolean) {
  const path = usePathname();
  const set = useContext(SetToastChrome);
  useLayoutEffect(() => {
    if (!active) return;
    return () => set?.(current => current.title?.path === path ? { ...current, title: undefined } : current);
  }, [active, path, set]);
  return useCallback((control: string, bottom: number) => {
    if (!active || !(bottom > 0)) return;
    set?.(current => {
      const controls = current.title?.path === path ? current.title.controls : {};
      return controls[control] === bottom ? current : { ...current, title: { path, controls: { ...controls, [control]: bottom } } };
    });
  }, [active, path, set]);
}

export function useFullscreenPhotoToastDeferral(active: boolean) {
  const set = useContext(SetToastChrome);
  useLayoutEffect(() => {
    if (!active || !set) return;
    set(current => ({ ...current, photosFullscreen: current.photosFullscreen + 1 }));
    return () => set(current => ({ ...current, photosFullscreen: current.photosFullscreen - 1 }));
  }, [active, set]);
}

/** A record key's id (`channel:ch-1` -> `ch-1`). */
const bare = (value: string) => value.replace(/^(channel|event):/, '');
const NOOP = () => {};

export function SurfaceProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<ToastChrome>({ photosFullscreen: 0 });
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
  const value = useMemo<SurfaceApp>(() => ({ actions: { ...screen, watch }, claimPlayPause }), [screen, watch]);
  return (
    <SurfaceAppContext.Provider value={value}>
      <SetToastChrome.Provider value={setChrome}>
        <ToastChromeState.Provider value={chrome}>
          <SurfaceSlots.Provider value={SLOTS}>{children}</SurfaceSlots.Provider>
        </ToastChromeState.Provider>
      </SetToastChrome.Provider>
    </SurfaceAppContext.Provider>
  );
}

/** Home rows, title panels and the published slots of built-in pages that plugins fill, drawn in their places. */
const SLOTS: SurfaceSlotViews = { row: HomeRowSurface, titlePanels: TitlePanels, slot: PluginSlotSurfaces };

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
      <Placed pathname={pathname} />
    </HostContext.Provider>
  );
}

function Placed({ pathname }: { pathname: string }) {
  const look = usePlayerLook();
  const vela = useVela();
  const chrome = useContext(ToastChromeState);
  const viewport = vela.host('home', '')?.viewport;
  const safeTop = viewport?.insets.top ?? 0;
  const placement = surfaceToastPlacement({
    pathname,
    sectionTop: safeTop + (look.small ? 64 : look.size(100)),
    titleFallbackBottom: safeTop + (look.small ? 124 : Math.max((viewport?.height ?? 0) * 0.04, look.size(100)) + look.size(74)),
    titleControlsBottoms: chrome.title?.path === pathname ? Object.values(chrome.title.controls) : undefined,
    clearance: Math.max(12, look.size(14)),
    photoFullscreen: chrome.photosFullscreen > 0,
  });
  const right = (viewport?.sides?.right ?? viewport?.insets.right ?? 0) + look.gutter;
  return <AppToasts look={look} {...placement} right={right} />;
}

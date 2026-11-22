// Sports in the app frame: what the live overlays need from the app (the Sports surfaces' own
// Watch and Add to multiview, a place to remember the ticker), and the favourite-team alert toasts
// over every screen. The app follows the viewer's alerts while it is signed in and in the
// foreground (on the one shared live stream); an open player draws the toasts itself (the watch
// route presents above this layer on phones).
import { usePathname } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { HostContext } from '@vela/skin/src/host';
import { usePlayerLook } from '@vela/skin/src/widgets/player/look';
import { AppAlertToasts, LiveOverlayContext, useAlertFollow, type LiveOverlayActions } from '@vela/skin/src/widgets/live-overlay';
import { preferences } from './data/preferences';
import { useAppSportsActions } from './sports/actions';
import { useVela } from './vela';

export function LiveOverlayProvider({ children }: { children: ReactNode }) {
  const sports = useAppSportsActions();
  const actions = useMemo<LiveOverlayActions>(() => ({
    watch: sports.watch,
    ...(sports.addToMultiview ? { addToMultiview: sports.addToMultiview } : {}),
    preferences,
  }), [sports]);
  return <LiveOverlayContext.Provider value={actions}>{children}</LiveOverlayContext.Provider>;
}

const SIGNED_OUT = ['/sign-in', '/connect'];

export function LiveAlerts() {
  const vela = useVela();
  const pathname = usePathname();
  const signedIn = !SIGNED_OUT.some(path => pathname.startsWith(path));
  useAlertFollow(signedIn);
  const host = vela.host('home', '');
  if (!host || !signedIn) return null;
  return (
    <HostContext.Provider value={host}>
      <Toasts />
    </HostContext.Provider>
  );
}

function Toasts() {
  const look = usePlayerLook();
  const vela = useVela();
  const viewport = vela.host('home', '')?.viewport;
  // Below the sections' top bar, so a toast never covers navigation, search or the profile.
  const top = (viewport?.insets.top ?? 0) + (look.small ? 64 : look.size(100));
  const right = (viewport?.sides?.right ?? viewport?.insets.right ?? 0) + look.gutter;
  return <AppAlertToasts look={look} top={top} right={right} />;
}

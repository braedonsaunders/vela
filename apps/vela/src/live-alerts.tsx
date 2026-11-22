// Sports in the app frame: what the live overlays need from the app (open a channel, a place to
// remember the ticker), and the favourite-team alert toasts over every screen. The app follows the
// viewer's alerts while it is signed in and in the foreground; an open player draws the toasts
// itself (the watch route presents above this layer on phones).
import { router, usePathname } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { HostContext } from '@vela/skin/src/host';
import { usePlayerLook } from '@vela/skin/src/widgets/player/look';
import { AppAlertToasts, LiveOverlayContext, useAlertFollow, type LiveOverlayActions } from '@vela/skin/src/widgets/live-overlay';
import { preferences } from './data/preferences';
import { useVela } from './vela';

function openChannel(channelId: string): void {
  const target = { pathname: '/watch/[id]' as const, params: { id: channelId, kind: 'channel' } };
  // From a player the channel takes its place, as a zap does; elsewhere it opens over the screen.
  if (router.canGoBack() && currentPath.startsWith('/watch')) router.replace(target);
  else router.push(target);
}
let currentPath = '';

export function LiveOverlayProvider({ children }: { children: ReactNode }) {
  currentPath = usePathname();
  const actions = useMemo<LiveOverlayActions>(() => ({ openChannel, preferences }), []);
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

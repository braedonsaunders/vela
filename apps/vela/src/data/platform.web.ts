// The store's platform on the web: the serving page's origin is the Ether server (a development
// build may point elsewhere; a desktop shell implies no server), secrets in the page's storage, a sign-in link's one-time code read
// once from the address and removed from it, and what the browser engine's probe says it plays.
import { Dimensions, PixelRatio } from 'react-native';
import type { VelaPlatform } from '@vela/core';
import { VelaPlayer } from '@vela/player';
import { config, DEVELOPMENT_SERVER } from './config';
import { consoleURL, parseWebHandoff } from '@vela/core';
import { secrets } from './secrets';

let handoff: { code?: string; consoleUrl?: string } | undefined;
function webHandoff(desktop: boolean): NonNullable<typeof handoff> {
  if (handoff) return handoff;
  const boot = globalThis as { __VELA_WEB_HANDOFF__?: string };
  const fragment = boot.__VELA_WEB_HANDOFF__ ?? location.hash;
  delete boot.__VELA_WEB_HANDOFF__;
  if (desktop) return handoff = {};
  handoff = readFragment(fragment);
  return handoff;
}

function readFragment(fragment: string) {
  const current = parseWebHandoff(fragment, location.origin);
  // A fallback for hosts without the HTML bootstrap; production strips in <head>.
  const live = new URLSearchParams(location.hash.slice(1));
  if (live.has('code') || live.has('console')) history.replaceState(history.state, '', location.pathname + location.search);
  try {
    if (new URLSearchParams(fragment.replace(/^#/, '')).has('console')) {
      if (current.consoleUrl) sessionStorage.setItem('vela.console', current.consoleUrl);
      else sessionStorage.removeItem('vela.console');
    } else current.consoleUrl = consoleURL(sessionStorage.getItem('vela.console'), location.origin);
  } catch { /* A private browser may disallow storage; the current link still works. */ }
  return current;
}

/** Ether can reuse an existing tab: fragment-only navigation never reruns the bundle. */
export function listenWebHandoff(receive: (value: { code?: string; consoleUrl?: string }) => void): () => void {
  const consume = () => {
    const boot = globalThis as { __VELA_WEB_HANDOFF__?: string };
    const fragment = boot.__VELA_WEB_HANDOFF__;
    delete boot.__VELA_WEB_HANDOFF__;
    if (fragment === undefined || desktopShell()) return;
    receive(readFragment(fragment));
  };
  window.addEventListener('vela:web-handoff', consume);
  consume(); // Also take a link that arrived between platform creation and this subscription.
  return () => window.removeEventListener('vela:web-handoff', consume);
}

export function screenArtWidth(): number {
  const { width, height } = Dimensions.get('window');
  return Math.ceil(Math.max(width, height, 960) * Math.min(2, PixelRatio.get()));
}

/** A desktop app (Windows, macOS, Linux) hosting this bundle from its own origin, as its shell
 * declares before the page runs. It is standalone: no server is implied by the page's origin. */
interface DesktopShell { version: number; platform: 'windows' | 'mac' | 'linux' }
const DESKTOP_NAMES: Record<DesktopShell['platform'], string> = { windows: 'Windows', mac: 'Mac', linux: 'Linux' };
export function desktopShell(): DesktopShell | undefined {
  const shell = (globalThis as { __VELA_DESKTOP__?: DesktopShell }).__VELA_DESKTOP__;
  return shell?.version === 1 && shell.platform in DESKTOP_NAMES ? shell : undefined;
}

export function platform(): VelaPlatform {
  const development = __DEV__ ? config.server || DEVELOPMENT_SERVER : '';
  const desktop = desktopShell();
  const link = webHandoff(!!desktop);
  return {
    etherOrigin: development || (desktop ? undefined : location.origin),
    secrets,
    device: desktop
      ? { name: `Vela for ${DESKTOP_NAMES[desktop.platform]}`, platform: desktop.platform === 'mac' ? 'macos' : desktop.platform }
      : { name: 'Vela browser', platform: 'web' },
    appVersion: config.appVersion,
    media: VelaPlayer.capabilities(),
    page: { origin: location.origin, webCode: link.code, consoleUrl: link.consoleUrl },
    mock: config.mock,
    artWidth: screenArtWidth(),
  };
}

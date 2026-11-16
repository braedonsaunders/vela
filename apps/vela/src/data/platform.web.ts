// The store's platform on the web: the serving page's origin is the Ether server (a development
// build may point elsewhere; a desktop shell implies no server), secrets in the page's storage, a sign-in link's one-time code read
// once from the address and removed from it, and what the browser engine's probe says it plays.
import { Dimensions, PixelRatio } from 'react-native';
import type { VelaPlatform } from '@vela/core';
import { VelaPlayer } from '@vela/player';
import { config, DEVELOPMENT_SERVER } from './config';
import { secrets } from './secrets';

/** What the web engine declares until it reports its own probe of the browser. */

/** A sign-in link's code (`#code=` or `?code=`), taken out of the address so it is used once. */
function takeWebCode(): string | undefined {
  const url = new URL(location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const code = hash.get('code') ?? url.searchParams.get('code') ?? undefined;
  if (!code) return undefined;
  hash.delete('code');
  url.searchParams.delete('code');
  url.hash = hash.toString();
  history.replaceState(history.state, '', url.href);
  return code;
}

export function screenArtWidth(): number {
  const { width, height } = Dimensions.get('window');
  return Math.ceil(Math.max(width, height, 960) * Math.min(2, PixelRatio.get()));
}

/** A desktop app (Windows, macOS, Linux) hosting this bundle from its own origin, as its shell
 * declares before the page runs. It is standalone: no server is implied by the page's origin. */
interface DesktopShell { version: number; platform: 'windows' | 'macos' | 'linux' }
const DESKTOP_NAMES: Record<DesktopShell['platform'], string> = { windows: 'Windows', macos: 'Mac', linux: 'Linux' };
export function desktopShell(): DesktopShell | undefined {
  const shell = (globalThis as { __VELA_DESKTOP__?: DesktopShell }).__VELA_DESKTOP__;
  return shell?.version === 1 && shell.platform in DESKTOP_NAMES ? shell : undefined;
}

export function platform(): VelaPlatform {
  const development = __DEV__ ? config.server || DEVELOPMENT_SERVER : '';
  const desktop = desktopShell();
  return {
    etherOrigin: development || (desktop ? undefined : location.origin),
    secrets,
    device: desktop
      ? { name: `Vela for ${DESKTOP_NAMES[desktop.platform]}`, platform: desktop.platform }
      : { name: 'Vela browser', platform: 'web' },
    appVersion: config.appVersion,
    media: VelaPlayer.capabilities(),
    page: { origin: location.origin, webCode: takeWebCode() },
    mock: config.mock,
    artWidth: screenArtWidth(),
  };
}

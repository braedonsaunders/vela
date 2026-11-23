// The About line a profile menu ends with: which Vela this is, where it runs and the server it is
// connected to, so a viewer can say what they run ("Vela 0.2.48 (2048) · Android · Ether 0.3.19").
import { msg, type VelaState } from '@vela/core';

/** What the About line says; '' where a fact is unknown (a server that has not answered yet). */
export interface About {
  /** The app's version ("0.2.48"). */
  version: string;
  /** The build number where the platform has one a viewer can see (Android's versionCode). */
  build: string;
  /** Where it runs: "Android", "Apple TV", "Web", "Windows". */
  platform: string;
  /** The connected server's product ("Ether", "Jellyfin", "Emby", "Plex"). */
  server: string;
  /** The server's own name, as it names itself. */
  serverName: string;
  /** The server's version, as it states it. */
  serverVersion: string;
}

const join = (...parts: string[]) => parts.filter(part => part !== '').join(' ');

/** The server as the line names it: its product and version ("Ether 0.3.19"); '' with neither. */
export function aboutServer(about: About): string {
  return join(about.server, about.serverVersion);
}

/** The line itself: "Vela 0.2.48 (2048) · Android · Ether 0.3.19"; '' without a version. */
export function aboutLine(about: About | undefined): string {
  if (!about?.version) return '';
  const app = join('Vela', about.version, about.build ? `(${about.build})` : '');
  return [app, about.platform, aboutServer(about)].filter(part => part !== '').join(' · ');
}

/** The line as a screen reader says it, the server's own name included: separators are not read
 * aloud well, and "(2048)" says nothing without "build". */
export function aboutLabel(about: About | undefined): string {
  if (!about?.version) return '';
  const server = aboutServer(about);
  const name = about.serverName && about.serverName !== about.server ? about.serverName : '';
  const facts = [
    join('Vela', about.version),
    about.build ? msg('about.build', { build: about.build }) : '',
    about.platform,
    server ? msg('about.server', { server: name ? `${server}, ${name}` : server }) : '',
  ].filter(part => part !== '');
  return msg('about.label', { facts: facts.join(', ') });
}

/** The facts for a state: the app's own, and the selected server's once it has answered (kept while
 * it is unreachable, gone once signed out or switching). */
export function aboutOf(state: Pick<VelaState, 'auth' | 'servers'>, app: Pick<About, 'version' | 'build' | 'platform'>): About {
  const { auth } = state;
  const connected = auth.phase === 'signed-in' || auth.phase === 'offline';
  const server = connected ? state.servers.list.find(item => item.selected && item.id === auth.serverId) : undefined;
  return {
    ...app,
    server: server?.kindLabel ?? '',
    serverName: server ? auth.serverName : '',
    serverVersion: server ? auth.serverVersion : '',
  };
}

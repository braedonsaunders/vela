import type * as V from '../wire';
import type { Credentials, MediaAccess, ServerAdapter } from './index';
import type { EtherAdapter } from './ether';
import { JellyfinAdapter } from './jellyfin';
import { PlexAdapter } from './plex';
import type { ServerRecord } from '../session/servers';
import type { Images } from '../discovery/artwork';
import { mediaPlan, scopedPlan } from '../protocol/media';

/** One configured server with its own adapter and session. The record is presentation-safe;
 * credentials stay behind `credentials` and `media`, which never reach a model. */
export interface Connection {
  readonly record: ServerRecord;
  readonly adapter: ServerAdapter;
  readonly credentials: Credentials;
  /** A native server's request credentials for the player host. Ether's broker needs none, but a
   * standalone app (whose page is on no server's origin) still scopes the player to its paths. */
  readonly media?: MediaAccess;
  /** Artwork addressing for one read, taken after that read so a rotated credential is current. */
  images(): Promise<Images>;
  /** The plan as the player receives it, with every media URL validated for this server. */
  plan(plan: V.PlaybackPlan): V.PlaybackPlan;
  /** A server whose cached answers depend on the declared client drops them when it changes. */
  setCapabilityContext?(context: string): void;
}

/** `crossOrigin`: the page is not on this server's origin (a standalone app), so the player is
 * told the broker's scope; its grant paths carry no credentials, so the scope adds no headers. */
export function etherConnection(record: ServerRecord, adapter: EtherAdapter, credentials: Credentials, crossOrigin = false, fitProxyWidth = true): Connection {
  const media: MediaAccess | undefined = crossOrigin
    ? { origin: record.origin, pathPrefix: '/sessions/', headers: async () => ({}), nativeURL: async url => url } : undefined;
  return { record, adapter, credentials, ...(media ? { media } : {}),
    images: async () => ({ origin: record.origin, fitProxyWidth }),
    plan: plan => mediaPlan(plan, record.origin),
    setCapabilityContext: context => adapter.setCapabilityContext(context) };
}

/** Jellyfin, Emby and Plex. Authenticated requests stay pinned to the record's origin and base path. */
export function nativeConnection(record: ServerRecord, credentials: Credentials, onSessionRejected: () => void): Connection {
  const base = record.origin + (record.basePath === '/' ? '' : record.basePath);
  if (record.kind === 'plex') {
    const adapter = new PlexAdapter({ origin: record.origin, credentials, clientIdentifier: credentials.device.id, name: record.name });
    const media: MediaAccess = { origin: record.origin, pathPrefix: '/', headers: () => adapter.mediaHeaders(), nativeURL: url => adapter.transientMediaURL(url) };
    return { record, adapter, credentials, media,
      images: async () => {
        // A server that refuses delegation shows no artwork rather than the persistent token.
        let token = '';
        try { token = await adapter.transientToken(); } catch { /* Artwork is unavailable. */ }
        return { origin: record.origin, sized: (url, width, height) => token ? plexImage(record.origin, url, width, height, token) : undefined };
      },
      plan: plan => scopedPlan(plan, media) };
  }
  const adapter = new JellyfinAdapter(base, credentials, onSessionRejected);
  const media: MediaAccess = { origin: record.origin, pathPrefix: record.basePath, headers: () => adapter.mediaHeaders(), nativeURL: url => adapter.nativePlaybackURL(url) };
  return { record, adapter, credentials, media,
    images: async () => ({ origin: record.origin, sized: (url, width, height) => jellyfinImage(record, url, width, height) }),
    plan: plan => scopedPlan(plan, media) };
}

/** PMS scales its own artwork; the transient delegation token lives only in this URL in memory. */
function plexImage(origin: string, url: URL, width: number, height: number, token: string): string | undefined {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return undefined;
  if (url.origin === origin && (!/^\/(library|photo|playlists|livetv)\//.test(url.pathname) || url.pathname.startsWith('/photo/:/transcode'))) return undefined;
  for (const key of url.searchParams.keys()) if (/token/i.test(key)) return undefined;
  const sized = new URL('/photo/:/transcode', origin);
  sized.search = new URLSearchParams({ width: String(width), height: String(height), minSize: '1', upscale: '1', url: url.origin === origin ? url.pathname + url.search : url.href, 'X-Plex-Token': token }).toString();
  return sized.href;
}

/** Jellyfin and Emby resize item images by maxWidth/maxHeight; any other URL is left absent. */
function jellyfinImage(record: ServerRecord, url: URL, width: number, height: number): string | undefined {
  const prefix = record.basePath === '/' ? '/' : `${record.basePath}/`;
  if (url.origin !== record.origin || url.username || url.password || url.hash || !url.pathname.startsWith(prefix) || !/\/Items\/[^/]+\/Images\//.test(url.pathname)) return undefined;
  const sized = new URL(url.href);
  sized.searchParams.set('maxWidth', String(width));
  sized.searchParams.set('maxHeight', String(height));
  sized.searchParams.set('quality', '90');
  return sized.href;
}

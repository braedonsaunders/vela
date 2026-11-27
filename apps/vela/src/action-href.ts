import type { Action } from '../../../packages/protocol/skin';
import type { Place } from './actions';
import { playParams } from './play-action';

const TITLE_KINDS = ['', 'movie', 'show', 'season', 'episode'];
const COLLECTION_KINDS = ['collection', 'directory', 'playlist'];
const PLAY_KINDS = ['channel', 'extra', 'library-live'];

function path(pathname: string, params: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value) query.set(name, value);
  const suffix = query.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

/** Canonical app destination for a document action. Non-navigation actions have no URL. */
export function actionHref(place: Place, action: Action, arg: string): string | undefined {
  switch (action) {
    case 'home': return '/';
    case 'live': return '/live';
    case 'library': return arg ? `/library/${encodeURIComponent(arg)}` : undefined;
    case 'playlists': return '/playlists';
    case 'manageLibraries': return '/libraries';
    case 'person': return place.entry && arg
      ? path('/person', { title: place.entry, name: arg, library: place.library }) : undefined;
    case 'play': {
      const [id = '', second = ''] = arg.split('|');
      if (!id) return undefined;
      if (PLAY_KINDS.includes(second)) return path(`/watch/${encodeURIComponent(id)}`, { kind: second });
      // The same parameters the press navigates with: Restart (`|||0`) is its own address.
      const { id: _, ...params } = playParams(arg);
      return path(`/watch/${encodeURIComponent(id)}`, params);
    }
    case 'select': {
      const [id = '', kind = '', , showId = ''] = arg.split('|');
      if (kind === 'channel') return id ? path('/live', { ch: id }) : undefined;
      if (COLLECTION_KINDS.includes(kind)) return id
        ? path(`/collection/${encodeURIComponent(id)}`, { playlist: kind === 'playlist' ? '1' : undefined }) : undefined;
      if (!TITLE_KINDS.includes(kind)) return undefined;
      const target = kind === 'season' && showId ? showId : id;
      const library = place.route === 'library' ? place.entry : place.library;
      return target ? path(`/title/${encodeURIComponent(target)}`, { library }) : undefined;
    }
    default: return undefined;
  }
}

/** Expo's export base is compile-time state; native builds intentionally leave it unset. */
export function webHref(href: string): string {
  const base = (process.env.EXPO_BASE_URL ?? '').replace(/\/$/, '');
  return `${base}${href}` || '/';
}

// Where a document's browse presses go: a library (a live library is Live TV), a collection, an
// extra played full screen, and a live hit from search (a channel's guide, or a programme: watched
// while it airs, else the guide at its time).
import { router } from 'expo-router';
import type { Vela as Store } from '@vela/core';

/** Row entries that open as a collection page rather than a title. */
export const COLLECTION_KINDS = ['collection', 'directory', 'playlist'];

/** A library from the shell or home. Moving between libraries replaces the page, so Back is home. */
export function openLibrary(store: Store, id: string, fromRoute: string): void {
  const destination = store.getState().libraries.value?.find(d => d.id === id);
  if (destination?.kind === 'live') {
    router.push('/live');
    return;
  }
  const target = { pathname: '/library/[id]' as const, params: { id } };
  if (fromRoute === 'library') router.replace(target);
  else router.push(target);
}

export function openCollection(id: string, kind?: string): void {
  router.push({ pathname: '/collection/[id]', params: { id, ...(kind === 'playlist' ? { playlist: '1' } : {}) } });
}

/** `playExtra {extra.id}`: a trailer or featurette, played on the watch route. */
export function playExtra(id: string): void {
  if (id) router.push({ pathname: '/watch/[id]', params: { id, kind: 'extra' } });
}

/** The search hand-off can only open the guide within its six days ahead. */
const GUIDE_REACH_MS = 6 * 24 * 3600 * 1000;

/** `openHit {hit.ref}`: `channel|<id>` or `programme|<id>` from the open query's live hits. */
export function openHit(store: Store, ref: string): void {
  const [kind = '', id = ''] = ref.split('|');
  if (!id) return;
  if (kind === 'channel') {
    router.push({ pathname: '/live', params: { ch: id } });
    return;
  }
  if (kind !== 'programme') return;
  const programme = store.getState().search.fast.liveProgrammes.find(p => p.id === id);
  if (!programme) return;
  const now = Date.now();
  if (programme.startMs <= now && now < programme.endMs) {
    router.push({ pathname: '/watch/[id]', params: { id: programme.channelId, kind: 'channel' } });
  } else if (programme.startMs - now <= GUIDE_REACH_MS) {
    const params = { ch: programme.channelId, prog: programme.id, at: programme.startISO };
    router.push({ pathname: '/live', params });
  }
}

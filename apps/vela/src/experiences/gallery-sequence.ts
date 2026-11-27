import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from '../router';
import { Image } from 'expo-image';
import type { Card, Vela } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { cardsOf } from '@vela/skin/src/blocks/listen/props';
import { photoImage, type PhotoNavigation } from '@vela/skin/src/blocks/gallery/viewer-nav';
import { FIT_VIEWER, galleryOriginKey, galleryOriginParam, photoFullscreen, photoNeighbours, type PhotoDirection } from '@vela/skin/src/blocks/gallery/viewer-nav-model';
import { orderTimelinePhotos } from '@vela/skin/src/blocks/gallery/timeline-layout';
import { noteTitleNavigation } from '../title-origin';

const galleryPages = {
  'vela:gallery/timeline': { page: 'timeline', source: 'photos' },
  'vela:gallery/album': { page: 'album', source: 'entries' },
  'vela:gallery/person': { page: 'person', source: 'entries' },
} as const;

function contextOf(store: Vela, pageKey: string, library: string | undefined) {
  const page = store.getState().screens.pages[pageKey];
  if (!page || page.params.library !== library || !Object.hasOwn(galleryPages, page.href)) return;
  const context = galleryPages[page.href as keyof typeof galleryPages];
  return { ...context, href: page.href, params: page.params };
}

function sequencePhotos(store: Vela, value: unknown, timeline: boolean): Card[] {
  const photos = cardsOf(value, key => store.screens.records.get(key))
    .filter(card => card.media?.class === 'photo' && card.media.role === 'item');
  return timeline ? orderTimelinePhotos(photos) : photos;
}

function hasMore(value: unknown): boolean {
  return !!(value && typeof value === 'object' && 'more' in value && value.more === true);
}

async function loadPhoto(store: Vela, id: string, signal: AbortSignal): Promise<boolean> {
  // A neighbour may already be loading from prefetch. Catalogue.title then returns immediately.
  await store.catalogue.title(id);
  const state = () => store.getState().titles[id];
  if (signal.aborted) return false;
  if (state()?.load !== 'loading') return !!state()?.value?.title[0];
  return new Promise(resolve => {
    const finish = () => {
      unsubscribe();
      signal.removeEventListener('abort', finish);
      resolve(!signal.aborted && !!state()?.value?.title[0]);
    };
    const unsubscribe = store.subscribe(() => { if (state()?.load !== 'loading') finish(); });
    signal.addEventListener('abort', finish, { once: true });
  });
}

export function openGalleryPhoto(id: string, library: string, pageKey: string): void {
  noteTitleNavigation(id);
  router.push({ pathname: '/title/[id]', params: { id, library, media: 'photo', galleryFrom: galleryOriginParam(pageKey) } });
}

/** Hold the opening document while the modal pages through it. This keeps its loaded records
 * available even after the section underneath stops following the screen. */
export function useGallerySequence(initialId: string, library: string | undefined, from: string | undefined, active: boolean) {
  const pageKey = from ? galleryOriginKey(from) : undefined;
  const store = useVela();
  const [id, setId] = useState(initialId);
  const [busy, setBusy] = useState(false);
  const [{ fullscreen, info, chrome }, setPresentation] = useState(FIT_VIEWER);
  const focused = useRef<string | null>(null);
  const focusedControl = useCallback(() => focused.current !== null, []);
  const reportFocus = useCallback((id: string, on: boolean) => {
    if (on) focused.current = id;
    else if (focused.current === id) focused.current = null;
  }, []);
  const movement = useRef<AbortController | null>(null);
  const origin = useMemo(() => pageKey ? contextOf(store, pageKey, library) : undefined, [store, pageKey, library]);
  const raw = useVelaState(state => origin && pageKey ? state.screens.pages[pageKey]?.sources[origin.source] : undefined);
  const photos = useMemo(() => sequencePhotos(store, raw, origin?.page === 'timeline'), [store, raw, origin?.page]);
  const current = id || initialId;
  const neighbours = useMemo(() => photoNeighbours(photos, current, hasMore(raw)), [photos, current, raw]);

  useEffect(() => {
    setId(initialId);
    setPresentation(FIT_VIEWER);
    setBusy(false);
    return () => { movement.current?.abort(); movement.current = null; };
  }, [initialId, pageKey]);

  useEffect(() => {
    if (!origin || !pageKey) return;
    const handle = store.screens.open({
      target: { kind: 'screen', id: 'vela.gallery', page: origin.page },
      href: origin.href,
      params: origin.params,
    });
    return handle.release;
  }, [origin, pageKey, store]);

  useEffect(() => {
    if (!active) return;
    const cards = [neighbours.previous, neighbours.next].filter((card): card is Card => !!card);
    const urls = cards.map(photoImage).filter(Boolean);
    if (urls.length) void Image.prefetch(urls, 'disk').catch(() => undefined);
    for (const card of cards) void store.catalogue.title(card.id);
  }, [active, neighbours.previous, neighbours.next, store]);

  const setFullscreen = useCallback((on: boolean) => {
    setPresentation(current => photoFullscreen(current, on));
  }, []);

  const setInfo = useCallback((on: boolean) => {
    setPresentation(current => current.info === on ? current : { ...current, info: on });
  }, []);
  const setChrome = useCallback((on: boolean) => {
    setPresentation(current => current.chrome === on ? current : { ...current, chrome: on });
  }, []);

  const move = useCallback((direction: PhotoDirection) => {
    if (!active || !pageKey || !origin || movement.current) return;
    const immediate = direction === -1 ? neighbours.previous : neighbours.next;
    if (!immediate && (direction === -1 || !neighbours.more)) return;
    const controller = new AbortController();
    movement.current = controller;
    setBusy(true);
    void (async () => {
      let next = immediate;
      if (!next) {
        const answer = await store.screens.action(pageKey, { name: 'vela.more', args: { source: origin.source } });
        const value = answer.sources?.[origin.source];
        next = photoNeighbours(sequencePhotos(store, value, origin.page === 'timeline'), current, hasMore(value)).next;
      }
      if (!next || controller.signal.aborted) return;
      if (await loadPhoto(store, next.id, controller.signal)) setId(next.id);
    })().catch(() => undefined).finally(() => {
      if (movement.current !== controller) return;
      movement.current = null;
      setBusy(false);
    });
  }, [active, current, origin, pageKey, neighbours, store]);

  const navigation: PhotoNavigation | null = origin ? {
    active, previous: !!neighbours.previous, next: !!neighbours.next || neighbours.more, busy,
    fullscreen, info, chrome, move, setFullscreen, setInfo, setChrome, focusedControl, reportFocus,
  } : null;
  return { id: current, navigation };
}

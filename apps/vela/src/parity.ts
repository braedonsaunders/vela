// Parity captures (tools/parity) need the same listening state on every run and platform: a fixed
// queue, its current track paused at a fixed position, and optionally Now Playing open. Only a mock
// build (EXPO_PUBLIC_VELA_MOCK=1) reads it, from EXPO_PUBLIC_VELA_PARITY_AUDIO (a simulator has no
// way to press play) or, on the web, the first page's `?parityAudio=` (one Metro serves every view).
//
//   <album or playlist title id>:<track index>:<seconds>[:open[-queue|-lyrics|-sound]]
//
// Nothing is heard: the track is paused before its plan loads, so the engine loads it and holds it.
import { Platform } from 'react-native';
import type { Vela as Store } from '@vela/core';
import { albumOrder, childrenKey } from '@vela/core';
import { openNowPlaying, type NowPlayingPanel } from '@vela/skin/src/blocks/listen/hub';
import { config } from './data/config';

export interface ParityAudio { titleId: string; index: number; seconds: number; open?: NowPlayingPanel | true }

export function parseParityAudio(raw: string | null | undefined): ParityAudio | null {
  const parts = (raw ?? '').trim().split(':');
  const [titleId = '', index = '', seconds = '', open = ''] = parts;
  if (!titleId || !/^\d+$/.test(index) || !/^\d+(\.\d+)?$/.test(seconds)) return null;
  const panel = open === 'open' ? true : open.startsWith('open-') ? open.slice(5) : undefined;
  if (panel !== undefined && panel !== true && panel !== 'queue' && panel !== 'lyrics' && panel !== 'sound') return null;
  return { titleId, index: Number(index), seconds: Number(seconds), ...(panel !== undefined ? { open: panel as NowPlayingPanel | true } : {}) };
}

/** The spec this run asked for, once (null in every build but a mock one). */
export function parityAudioSpec(): ParityAudio | null {
  if (!config.mock) return null;
  const fromPage = Platform.OS === 'web' && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('parityAudio') : null;
  return parseParityAudio(fromPage ?? process.env.EXPO_PUBLIC_VELA_PARITY_AUDIO);
}

let started = false;
/** Queue the spec's tracks, paused at its position, once home is ready. */
export function startParityAudio(store: Store, spec: ParityAudio): void {
  if (started) return;
  started = true;
  void (async () => {
    await store.media.children(spec.titleId);
    const children = store.getState().children[childrenKey(spec.titleId)]?.value?.items ?? [];
    const items = albumOrder(children.filter(item => item.media?.audio));
    if (!items.length) { console.warn(`Vela parity: ${spec.titleId} has no tracks`); return; }
    const name = items[0]!.media?.parents?.find(parent => parent.id === spec.titleId)?.name ?? '';
    store.audio.play({ items, index: Math.min(spec.index, items.length - 1), positionSeconds: spec.seconds,
      source: { id: spec.titleId, name, kind: 'title' } });
    store.audio.pause();
    if (spec.open) setTimeout(() => openNowPlaying(spec.open === true ? undefined : spec.open), 600);
  })();
}

// Live TV for the signed-in server: one live controller (listings, the preview tile, zapping)
// per server and viewer with live TV, disposed when either changes. Full watch of a channel opens
// the watch route with `kind=channel`.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import type { Vela as Store } from '@vela/core';
import { sampleUIFrames } from '@vela/player';
import { LiveController, liveSource } from '@vela/skin/src/widgets/guide';
import { preferences } from './data/preferences';

function openWatch(channelId: string, replace: boolean): void {
  const target = { pathname: '/watch/[id]' as const, params: { id: channelId, kind: 'channel' } };
  if (replace) router.replace(target);
  else router.push(target);
}

function openCatchUp(channelId: string, programmeId: string, from: 'start' | undefined, replace: boolean): void {
  const target = { pathname: '/watch/[id]' as const, params: { id: programmeId, kind: 'programme', channelId, ...(from ? { from } : {}) } };
  if (replace) router.replace(target);
  else router.push(target);
}

/** `session` changes with the server and viewer (the auth revision); null while signed out. */
export function useLiveController(store: Store, session: number | null): LiveController | null {
  const [controller, setController] = useState<LiveController | null>(null);
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS !== '1') return;
    const root = globalThis as typeof globalThis & { __velaGuideUIFrames?: typeof sampleUIFrames };
    root.__velaGuideUIFrames = sampleUIFrames;
    return () => { delete root.__velaGuideUIFrames; void sampleUIFrames(false); };
  }, []);
  useEffect(() => {
    if (session === null) return;
    let made: LiveController | null = null;
    let current = true;
    store.live.access().then(
      access => {
        if (!current || !access) return;
        made = new LiveController({
          source: liveSource(access.api, access.client),
          scope: access.scope,
          images: access.images,
          previewMode: access.previewMode,
          memory: preferences,
          openWatch,
          catchUp: access.catchUp,
          ...(access.catchUp.archive ? { openCatchUp } : {}),
        });
        setController(made);
      },
      () => undefined,
    );
    return () => {
      current = false;
      made?.dispose();
      setController(null);
    };
  }, [store, session]);
  return controller;
}

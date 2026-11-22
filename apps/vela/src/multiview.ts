// Multiview for the signed-in server: one MultiviewController per server and viewer with live TV,
// disposed when either changes. "Add to multiview" anywhere adds a channel and opens /multiview.
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import type { Vela as Store } from '@vela/core';
import type { LiveController } from '@vela/skin/src/widgets/guide';
import { MultiviewController, type MultiviewSource } from '@vela/skin/src/widgets/multiview';
import { liveSource } from '@vela/skin/src/widgets/guide';
import type * as V from '../../../packages/protocol/types';

const key = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** The live access's operations as a multiview source. Until the server's group endpoints are in the
 * shared client, tiles play as ordinary live sessions of an unnamed group. */
function multiviewSource(access: NonNullable<Awaited<ReturnType<Store['live']['access']>>>): MultiviewSource {
  const live = liveSource(access.api, access.client);
  return {
    open: async () => ({ groupId: '', maxTiles: 4 }),
    close: async () => undefined,
    async tune(channelId, multiview) {
      const request = { channelId, client: access.client, idempotencyKey: key('tile'), ...(multiview.groupId ? { multiview } : {}) } as V.PlaybackRequest;
      const answer = await access.api.startPlayback(request);
      if ('state' in answer && answer.state === 'preparing') throw new Error(`Channel ${channelId} is not ready to play`);
      return answer as V.PlaybackPlan;
    },
    stop: plan => live.stop(plan),
  };
}

export function useMultiviewController(store: Store, session: number | null, live: LiveController | null) {
  const [controller, setController] = useState<MultiviewController | null>(null);
  useEffect(() => {
    if (session === null || !live) return;
    let made: MultiviewController | null = null;
    let current = true;
    store.live.access().then(access => {
      if (!current || !access) return;
      made = new MultiviewController({
        source: multiviewSource(access),
        channelName: id => live.view().guide?.channels.find(channel => channel.id === id)?.name ?? '',
        report: (operation, error) => { if (__DEV__) console.warn(`[vela-multiview] ${operation}`, error instanceof Error ? error.message : error); },
      });
      setController(made);
    }, () => undefined);
    return () => {
      current = false;
      made?.dispose();
      setController(null);
    };
  }, [store, session, live]);
  return useMemo(() => controller ? {
    controller,
    open(channelId?: string) {
      if (channelId) controller.add(channelId);
      router.push('/multiview');
    },
  } : null, [controller]);
}

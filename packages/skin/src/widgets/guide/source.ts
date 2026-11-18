// What Live TV needs from the server: the lineup and listings (the adapter's LiveTv capability),
// and a channel session for the preview tile, which it must also be able to stop. The app builds
// one from its adapter; nothing under widgets/ issues a request of its own.
import { VelaError, type GuideApi } from '@vela/core';
import type * as V from '../../../../protocol/types';

export interface LiveSource extends GuideApi {
  /** A playback plan for a channel. The app adds its device and client capabilities. */
  tune(channelId: string): Promise<V.PlaybackPlan>;
  /** Ends the plan's session at the server. Resolves only once the server confirmed it. */
  stop(plan: V.PlaybackPlan): Promise<void>;
}

/** The adapter operations a LiveSource is made of (core's ServerAdapter and LiveTv shapes). */
export interface LiveAdapter extends GuideApi {
  startPlayback(request: V.PlaybackRequest): Promise<V.PlaybackPlan | V.PlaybackPreparing>;
  command(
    sessionId: string,
    command: Extract<V.SessionCommand, { kind: 'seek' | 'pause' | 'resume' | 'stop' }>,
  ): Promise<V.PlaybackPlan>;
}

const key = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** A LiveSource over an adapter. A channel that answers "preparing" has no picture to preview. */
export function liveSource(adapter: LiveAdapter, client: V.ClientCapabilities): LiveSource {
  return {
    channels: (cursor, limit) => adapter.channels(cursor, limit),
    guide: query => adapter.guide(query),
    guideWindow: adapter.guideWindow?.bind(adapter),
    async tune(channelId) {
      const answer = await adapter.startPlayback({ channelId, client, idempotencyKey: key('tune') });
      if ('state' in answer && answer.state === 'preparing')
        throw new Error(`Channel ${channelId} is not ready to play`);
      return answer as V.PlaybackPlan;
    },
    async stop(plan) {
      const stop = (generations: V.Generations, idempotencyKey: string) =>
        adapter.command(plan.sessionId, { kind: 'stop', ...generations, idempotencyKey });
      try {
        await stop(plan, `stop-${plan.sessionId}-${plan.sourceGeneration}-${plan.seekGeneration}`);
      } catch (error) {
        if (!(error instanceof VelaError)) throw error;
        // Ended, expired or unknown: the server holds nothing for this session any more.
        if (error.status === 404 || error.status === 410) return;
        // A stop can race a server-side generation change; it names the current ones.
        const current = error.detail.code === 'stale_generation' ? error.detail.currentGenerations : undefined;
        if (!current) throw error;
        await stop(current, key('stop'));
      }
    },
  };
}

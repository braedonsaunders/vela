// Live TV: a day of the channel guide, and what a channel is airing now (the player's title).
// Offered only by a server with the LiveTv capability; elsewhere every read fails honestly.
import type * as V from '../wire';
import { hasEventStream, hasLiveTv, hasMultiview, hasTileReplan } from '../adapter/capabilities';
import { followSession } from '../protocol/events';
import { randomId } from '../protocol/id';
import type { Connection } from '../adapter/connection';
import type { TransportCommand } from '../adapter';
import type { Images } from '../discovery/artwork';
import { guideFocus, liveIdentity, loadGuide, type GuideApi, type GuideModel } from '../live/guide';
import type { Playback } from './playback';
import type { Session } from './session';
import { failed, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

export interface LiveState {
  /** Guide days by offset from today (0: today). */
  guide: Record<number, Loadable<GuideModel>>;
}

export const initialLive: LiveState = { guide: {} };

/** The selected server's live TV, for a live controller: listings, and tuning that returns validated plans. */
import { catchUpOffer, type CatchUpOffer } from '../live/timeshift';
export interface LiveTvAccess {
  api: GuideApi & {
    startPlayback(request: V.PlaybackRequest): Promise<V.PlaybackPlan | V.PlaybackPreparing>;
    command(sessionId: string, command: TransportCommand): Promise<V.PlaybackPlan>;
  };
  client: V.ClientCapabilities;
  /** The server and viewer: what listings are cached under and the remembered channel is kept by. */
  scope: string;
  images: Images;
  /** Server-owner policy. Older servers omit it and retain the original automatic preview. */
  previewMode: V.LivePreviewMode;
  /** Catch-up and timeshift (features.liveCatchUp): past programmes and Start over, and the rewind window. */
  catchUp: CatchUpOffer;
  /** Multiview groups (features.multiview); absent where the server has none. Tiles join with
   * PlaybackRequest.multiview through `api.startPlayback`. */
  multiview?: {
    maxTiles: number;
    create(): Promise<V.MultiviewGroup>;
    /** Ends every tile of the group. */
    end(groupId: string): Promise<void>;
    /** A tile's session replanned at a new height (spec B); absent on servers without it. */
    replan?(plan: V.PlaybackPlan, maxHeight: number): Promise<V.PlaybackPlan>;
  };
  /** Follows one live session's stream until it closes or `signal` aborts: its validated plans and the
   * live event on air. Absent where the server streams no session events. */
  follow?(sessionId: string, on: { plan(plan: V.PlaybackPlan): void; liveEvent(liveEvent: V.LiveEventRef | null): void }, signal: AbortSignal): Promise<void>;
}

export class Live {
  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly playback: Playback,
  ) {
    session.onReset(() => this.box.update('live', () => initialLive));
  }

  private async tv(): Promise<{ connection: Connection; api: Connection['adapter'] & Parameters<typeof loadGuide>[0] }> {
    const connection = await this.session.ready();
    const api = connection.adapter;
    if (!hasLiveTv(api)) throw new Error('Live TV is not offered by this server');
    return { connection, api };
  }

  /** The selected server's live TV, or null when it offers none. Read again after a session change. */
  async access(): Promise<LiveTvAccess | null> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    if (!hasLiveTv(adapter)) return null;
    const features = this.session.features ?? (await adapter.viewerLiveFeatures?.()) ?? (await adapter.describe()).features;
    if (features.liveTV?.available === false) return null;
    const tokens = await this.session.tokens(connection);
    const server = this.playback.server;
    return {
      api: {
        channels: (cursor, limit) => adapter.channels(cursor, limit),
        guide: query => adapter.guide(query),
        guideWindow: adapter.guideWindow?.bind(adapter),
        startPlayback: request => server.startPlayback(request),
        command: (sessionId, command) => server.command(sessionId, command),
      },
      client: await this.session.declared(),
      scope: `${connection.record.id}|${tokens?.viewer.id ?? ''}`,
      images: await connection.images(),
      previewMode: features.livePreview?.available === false ? 'off' : features.livePreview?.mode ?? 'auto',
      catchUp: catchUpOffer(features),
      ...(hasMultiview(adapter) && features.multiview?.available ? {
        multiview: {
          maxTiles: features.multiview.maxTiles,
          create: () => adapter.createMultiview({ device: this.session.device, idempotencyKey: randomId() }),
          end: async (groupId: string) => { await adapter.endMultiview(groupId, { idempotencyKey: randomId() }); },
          ...(hasTileReplan(adapter) ? {
            replan: (plan: V.PlaybackPlan, maxHeight: number) => adapter.replanTile(plan.sessionId, {
              kind: 'replan', maxHeight, sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration, idempotencyKey: randomId(),
            }),
          } : {}),
        },
      } : {}),
      ...(hasEventStream(adapter) ? {
        follow: (sessionId: string, on: { plan(plan: V.PlaybackPlan): void; liveEvent(liveEvent: V.LiveEventRef | null): void }, signal: AbortSignal) =>
          followSession(adapter, plan => connection.plan(plan), sessionId, on.plan, signal, on.liveEvent),
      } : {}),
    };
  }

  /** One day of listings, read again when asked (airing state is projected at the read). */
  async guide(day: number): Promise<void> {
    const epoch = this.session.epoch;
    const set = (value: Loadable<GuideModel>) =>
      this.box.update('live', live => ({ ...live, guide: { ...live.guide, [day]: value } }));
    const previous = this.box.get().live.guide[day];
    set(loading(previous));
    try {
      const { connection, api } = await this.tv();
      const tokens = await this.session.tokens(connection);
      const scope = `${connection.record.id}|${tokens?.viewer.id ?? ''}`;
      const model = await loadGuide(api, day, Date.now(), scope, await connection.images());
      if (epoch === this.session.epoch) set(ready(model));
    } catch (error) {
      if (epoch === this.session.epoch) set(failed(error, previous));
    }
  }

  /** The player's title for a channel: the channel, and what it is airing now. */
  async identity(channelId: string): Promise<{ title: string }> {
    const { connection, api } = await this.tv();
    const tokens = await this.session.tokens(connection);
    return liveIdentity(api, channelId, Date.now(), undefined, `${connection.record.id}|${tokens?.viewer.id ?? ''}`);
  }

  /** Where a server timestamp falls in the guide: its day offset (-1 outside the week) and minute. */
  focus(at: string): { day: number; minute: number } {
    return guideFocus(at, Date.now());
  }
}

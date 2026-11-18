// Live TV: a day of the channel guide, and what a channel is airing now (the player's title).
// Offered only by a server with the LiveTv capability; elsewhere every read fails honestly.
import type * as V from '../wire';
import { hasLiveTv } from '../adapter/capabilities';
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
export interface LiveTvAccess {
  api: GuideApi & {
    startPlayback(request: V.PlaybackRequest): Promise<V.PlaybackPlan | V.PlaybackPreparing>;
    command(sessionId: string, command: TransportCommand): Promise<V.PlaybackPlan>;
  };
  client: V.ClientCapabilities;
  /** The server and viewer: what listings are cached under and the remembered channel is kept by. */
  scope: string;
  images: Images;
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
    const features = this.session.features ?? (await adapter.describe()).features;
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

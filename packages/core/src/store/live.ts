// Live TV: a day of the channel guide, and what a channel is airing now (the player's title).
// Offered only by a server with the LiveTv capability; elsewhere every read fails honestly.
import { hasLiveTv } from '../adapter/capabilities';
import type { Connection } from '../adapter/connection';
import { guideFocus, liveIdentity, loadGuide, type GuideModel } from '../live/guide';
import type { Session } from './session';
import { failed, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

export interface LiveState {
  /** Guide days by offset from today (0: today). */
  guide: Record<number, Loadable<GuideModel>>;
}

export const initialLive: LiveState = { guide: {} };

export class Live {
  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
  ) {
    session.onReset(() => this.box.update('live', () => initialLive));
  }

  private async tv(): Promise<{ connection: Connection; api: Connection['adapter'] & Parameters<typeof loadGuide>[0] }> {
    const connection = await this.session.ready();
    const api = connection.adapter;
    if (!hasLiveTv(api)) throw new Error('Live TV is not offered by this server');
    return { connection, api };
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
      const scope = `${connection.record.id}|${tokens?.viewer.id ?? ''}|${tokens?.accessToken ?? ''}`;
      const model = await loadGuide(api, day, Date.now(), scope, await connection.images());
      if (epoch === this.session.epoch) set(ready(model));
    } catch (error) {
      if (epoch === this.session.epoch) set(failed(error, previous));
    }
  }

  /** The player's title for a channel: the channel, and what it is airing now. */
  async identity(channelId: string): Promise<{ title: string }> {
    const { api } = await this.tv();
    return liveIdentity(api, channelId, Date.now());
  }

  /** Where a server timestamp falls in the guide: its day offset (-1 outside the week) and minute. */
  focus(at: string): { day: number; minute: number } {
    return guideFocus(at, Date.now());
  }
}

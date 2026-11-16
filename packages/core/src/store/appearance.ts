// The server's appearance: its default skin, whether the owner forces it, and the skin documents
// it offers (its own, then the release's built-ins it does not replace). Followed live through
// the viewer's event stream when the server has one. A server without an appearance of its own
// uses the local built-in one; nothing is invented for it.
import type * as V from '../wire';
import { hasAppearance, hasEventStream } from '../adapter/capabilities';
import { VelaError } from '../adapter/errors';
import { appearanceModel, builtInDocuments, followAppearance, type AppearanceModel } from '../appearance';
import type { Session } from './session';
import { failed, loading, ready, type StateBox } from './state';
import type { VelaState } from './index';

const LOCAL: V.Appearance = { revision: 0, defaultSkinId: 'cinematic', defaultEngineId: 'cinematic', force: false, packs: [] };
const MAX_FOLLOW_FAILURES = 5;

function missing(error: unknown): boolean {
  if (!(error instanceof VelaError)) return false;
  return error.status === 404 || error.detail.code === 'feature_unavailable' || error.detail.code === 'unsupported';
}

export class Appearance {
  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly rendererVersion: number,
  ) {
    session.onReset(kind => {
      if (kind === 'server') void this.load();
    });
  }

  private get origin(): string {
    return this.session.selected().record.origin;
  }

  /** Read the selected server's appearance (or the local one). */
  async load(): Promise<void> {
    const epoch = this.session.epoch;
    this.box.update('appearance', appearance => loading(appearance));
    try {
      const adapter = this.session.selected().adapter;
      let appearance = LOCAL;
      if (hasAppearance(adapter)) {
        try {
          appearance = await adapter.appearance();
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      const model = appearanceModel(appearance, this.origin, await builtInDocuments(this.origin, this.rendererVersion));
      if (epoch === this.session.epoch) this.box.update('appearance', () => ready(model));
    } catch (error) {
      if (epoch === this.session.epoch) this.box.update('appearance', appearance => failed(error, appearance));
    }
  }

  /** Follow appearance changes while the app is in front; call the returned function to stop. */
  follow(): () => void {
    const controller = new AbortController();
    const show = (model: AppearanceModel) => {
      if (!controller.signal.aborted) this.box.update('appearance', () => ready(model));
    };
    const loop = async () => {
      let failures = 0;
      while (!controller.signal.aborted && failures < MAX_FOLLOW_FAILURES) {
        try {
          const api = (await this.session.ready()).adapter;
          if (!hasAppearance(api) || !hasEventStream(api)) return;
          const floor = this.box.get().appearance.value?.revision ?? 0;
          await followAppearance(this.origin, onEvent => api.streamViewerEvents(onEvent, controller.signal), floor, show);
          failures = 0;
        } catch (error) {
          if (controller.signal.aborted || missing(error)) return;
          failures++;
          await new Promise(resolve => setTimeout(resolve, Math.min(30, 2 ** failures) * 1000));
        }
      }
    };
    void loop();
    return () => controller.abort();
  }

  /**
   * A skin document as the server serves it, unresolved: a built-in under /vela/skins/, or the
   * server's own under its appearance tree. Anything else is refused.
   */
  async document(url: string): Promise<unknown> {
    const path = new URL(url, `${this.origin}/`).pathname;
    if (path.startsWith('/vela/skins/') && path.endsWith('/document.json')) {
      const response = await fetch(`${this.origin}${path}`);
      if (!response.ok) throw new Error(`Built-in skin document ${path}: ${response.status}`);
      return response.json();
    }
    if (!path.startsWith('/vela/v0/appearance/skins/')) throw new Error('Skin document outside the appearance tree');
    const adapter = this.session.selected().adapter;
    if (!hasAppearance(adapter)) throw new Error('This server publishes no skin documents');
    return adapter.skinDocument(path.slice('/vela/v0'.length));
  }
}

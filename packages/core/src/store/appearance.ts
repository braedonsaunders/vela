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

/** An unchanged appearance keeps its identity, so a refresh (returning to the app, coming back
 * online) does not re-resolve the skin and replay the page's entrance. */
export function settled(previous: AppearanceModel | undefined, next: AppearanceModel): AppearanceModel {
  return previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}

function missing(error: unknown): boolean {
  if (!(error instanceof VelaError)) return false;
  return error.status === 404 || error.detail.code === 'feature_unavailable' || error.detail.code === 'unsupported';
}

export class Appearance {
  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly rendererVersion: number,
    /** The app's own page, which serves the release's built-in skins (/vela/skins/). Natively
     * there is none, and the built-ins come from the selected Ether server. */
    private readonly appOrigin?: string,
  ) {
    session.onReset(kind => {
      void this.load();
    });
  }

  private get origin(): string {
    return this.session.hasServer() ? this.session.selected().record.origin : this.appOrigin ?? '';
  }

  /** Where the built-in skins live: the app's own page, else the selected server. */
  private get builtInOrigin(): string {
    return this.appOrigin ?? this.origin;
  }

  /** Read the selected server's appearance (or the local one). */
  async load(): Promise<void> {
    const epoch = this.session.epoch;
    this.box.update('appearance', appearance => loading(appearance));
    try {
      const adapter = this.session.hasServer() ? this.session.selected().adapter : undefined;
      let appearance = LOCAL;
      if (adapter && hasAppearance(adapter)) {
        try {
          appearance = await adapter.appearance();
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      const model = appearanceModel(appearance, this.origin, await builtInDocuments(this.builtInOrigin, this.rendererVersion), this.builtInOrigin);
      if (epoch === this.session.epoch) this.box.update('appearance', current => ready(settled(current.value, model)));
    } catch (error) {
      if (epoch === this.session.epoch) this.box.update('appearance', appearance => failed(error, appearance));
    }
  }

  /** Follow appearance changes while the app is in front; call the returned function to stop. */
  follow(): () => void {
    const controller = new AbortController();
    const show = (model: AppearanceModel) => {
      if (!controller.signal.aborted) this.box.update('appearance', current => ready(settled(current.value, model)));
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

  /** Credentials are returned only for this server's appearance assets. */
  async assetHeaders(url: string): Promise<Record<string, string>> {
    const parsed = new URL(url, `${this.origin}/`);
    if (parsed.origin !== this.origin || !parsed.pathname.startsWith('/vela/v0/appearance/') || parsed.search || parsed.hash) return {};
    const tokens = await this.session.selected().credentials.get();
    return tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {};
  }

  /**
   * A skin document as the server serves it, unresolved: a built-in under /vela/skins/, or the
   * server's own under its appearance tree. Anything else is refused.
   */
  async document(url: string): Promise<unknown> {
    const parsed = new URL(url, `${this.origin}/`);
    if (parsed.origin !== this.origin && parsed.origin !== this.builtInOrigin) throw new Error('Foreign skin origin');
    const path = parsed.pathname;
    if (path.startsWith('/vela/skins/') && path.endsWith('/document.json')) {
      const response = await fetch(`${this.builtInOrigin}${path}`);
      if (!response.ok) throw new Error(`Built-in skin document ${path}: ${response.status}`);
      return response.json();
    }
    if (!path.startsWith('/vela/v0/appearance/skins/')) throw new Error('Skin document outside the appearance tree');
    const adapter = this.session.selected().adapter;
    if (!hasAppearance(adapter)) throw new Error('This server publishes no skin documents');
    return adapter.skinDocument(path.slice('/vela/v0'.length));
  }
}

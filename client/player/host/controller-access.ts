import type { MediaAccess as ControllerAccess } from '../../../packages/player-api/src/types';
import {
  authorizedMediaFetch,
  parseMediaAuthorization,
  permittedMediaURL,
  type BrowserMediaAccess,
  type MediaAuthorization,
} from '../media-auth';

import { abortable } from '../core/async';

const retired = () => new DOMException('Media authorization retired', 'AbortError');

/** The controller owns credentials; the view owns only a private, revocable request scope. */
export class ControllerMediaAccess implements BrowserMediaAccess {
  private provider: ControllerAccess | null = null;
  private value?: MediaAuthorization;
  private lifetime = new AbortController();
  private pending?: Promise<boolean>;
  private disposed = false;

  constructor(private readonly access: () => ControllerAccess | null) {}

  refresh(): Promise<boolean> {
    if (this.disposed) return Promise.reject(retired());
    const provider = this.access();
    const replaced = provider !== this.provider;
    if (replaced) {
      this.lifetime.abort();
      this.lifetime = new AbortController();
      this.provider = provider;
      this.value = undefined;
      this.pending = undefined;
    }
    if (this.pending) return this.pending;
    const lifetime = this.lifetime;
    const pending = (async () => {
      if (!provider) return replaced;
      let headers: Record<string, string>;
      try {
        headers = await abortable(
          provider.headers(),
          AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]),
        );
      } catch {
        throw new Error('Media authorization unavailable');
      }
      this.assertCurrent(provider, lifetime);
      const next = parseMediaAuthorization(
        JSON.stringify({
          handle: this.value?.handle ?? crypto.randomUUID(),
          origin: provider.origin,
          pathPrefix: provider.pathPrefix,
          headers,
        }),
      );
      const changed = replaced || JSON.stringify(next) !== JSON.stringify(this.value);
      if (changed && this.value) {
        this.lifetime.abort();
        this.lifetime = new AbortController();
        next!.handle = crypto.randomUUID();
      }
      this.value = next;
      return changed;
    })().catch((error) => {
      if (this.provider === provider && this.lifetime === lifetime) {
        this.lifetime.abort();
        this.lifetime = new AbortController();
        this.value = undefined;
      }
      throw error;
    });
    this.pending = pending;
    void pending
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      })
      .catch(() => {});
    return pending;
  }

  private assertCurrent(provider: ControllerAccess | null, lifetime: AbortController) {
    if (this.disposed || lifetime.signal.aborted || this.access() !== provider) throw retired();
  }

  authorization() {
    if (this.disposed || this.access() !== this.provider || (this.provider && !this.value)) throw retired();
    return this.value ? { ...this.value, headers: { ...this.value.headers } } : undefined;
  }

  allows(url: URL) {
    try {
      permittedMediaURL(url, this.authorization());
      return true;
    } catch {
      return false;
    }
  }

  fetch: typeof fetch = async (input, init) => {
    const provider = this.provider;
    const lifetime = this.lifetime;
    this.assertCurrent(provider, lifetime);
    await this.refresh();
    this.assertCurrent(provider, lifetime);
    return authorizedMediaFetch(this.authorization(), lifetime.signal)(input, init);
  };

  async nativeURL(input: string, signal: AbortSignal): Promise<string> {
    const provider = this.provider;
    const lifetime = this.lifetime;
    this.assertCurrent(provider, lifetime);
    await this.refresh();
    this.assertCurrent(provider, lifetime);
    signal.throwIfAborted();
    const target = permittedMediaURL(input, this.authorization());
    if (!provider) return target.href;
    if (!provider.nativeURL) throw new Error('Native media authorization unavailable');
    let attached: URL;
    try {
      attached = new URL(
        await abortable(
          provider.nativeURL(target.href),
          AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(10000)]),
        ),
      );
    } catch {
      throw new Error('Native media authorization unavailable');
    }
    signal.throwIfAborted();
    this.assertCurrent(provider, lifetime);
    // The native attachment alone may contain credentials in its query.
    const scoped = new URL(attached);
    scoped.search = '';
    permittedMediaURL(scoped, this.authorization());
    if (attached.pathname !== target.pathname) throw new Error('Native media authorization unavailable');
    return attached.href;
  }

  dispose() {
    this.disposed = true;
    this.lifetime.abort();
    this.provider = null;
    this.value = undefined;
    this.pending = undefined;
  }
}

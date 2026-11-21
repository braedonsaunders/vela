import type { SkinHost } from './host';

// A route's host changes whenever anything a document can read changes (a flag, the hero on show,
// a preview starting, a row loading). Given through a plain context, every node of the route drew
// again for each change: a TV redrew all of home twice per focus move in the hero. A tracked host
// instead gives each node a view that notes which host and env keys the node reads; the node draws
// again only when one of those changes. Reads always see the latest host, so handlers called later
// are never stale.

type Listener = () => void;

/** The host of one tree, updated as its provider draws and published once committed. */
export class HostSource {
  private readonly listeners = new Set<Listener>();
  constructor(public latest: SkinHost) {}
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  publish(host: SkinHost): void {
    this.latest = host;
    for (const listener of [...this.listeners]) listener();
  }
}

/** One reader's view of a source: the keys it has read, and a version that moves only when one of
 * them changes. */
export class HostReader {
  readonly hostKeys = new Set<string>();
  readonly envKeys = new Set<string>();
  version = 0;
  host: SkinHost;
  private seen: SkinHost;
  constructor(readonly source: HostSource) {
    this.seen = source.latest;
    this.host = this.view();
  }
  /** The version for the source's latest host (useSyncExternalStore's snapshot). */
  readonly snapshot = (): number => {
    const next = this.source.latest;
    if (next !== this.seen) {
      if (this.differs(this.seen, next)) {
        this.version++;
        this.host = this.view();
      }
      this.seen = next;
    }
    return this.version;
  };
  private differs(a: SkinHost, b: SkinHost): boolean {
    const hostA = a as unknown as Record<string, unknown>, hostB = b as unknown as Record<string, unknown>;
    for (const key of this.hostKeys) if (key !== 'env' && hostA[key] !== hostB[key]) return true;
    if (a.env === b.env) return false;
    const envA = a.env as unknown as Record<string, unknown>, envB = b.env as unknown as Record<string, unknown>;
    for (const key of this.envKeys) if (envA[key] !== envB[key]) return true;
    return false;
  }
  private view(): SkinHost {
    const source = this.source;
    const env = tracking(() => source.latest.env as unknown as Record<string, unknown>, this.envKeys);
    return tracking(() => source.latest as unknown as Record<string, unknown>, this.hostKeys, { env }) as unknown as SkinHost;
  }
}

/** An object whose reads come from target() and are noted in keys; `fixed` answers some keys itself. */
function tracking(target: () => Record<string, unknown>, keys: Set<string>, fixed: Record<string, unknown> = {}): object {
  const read = (key: string) => {
    keys.add(key);
    return key in fixed ? fixed[key] : target()[key];
  };
  return new Proxy({}, {
    get: (_, key) => (typeof key === 'string' ? read(key) : undefined),
    has: (_, key) => key in target(),
    ownKeys: () => {
      const own = Reflect.ownKeys(target());
      for (const key of own) if (typeof key === 'string') keys.add(key);
      return own;
    },
    getOwnPropertyDescriptor: (_, key) => (typeof key === 'string' && key in target()
      ? { configurable: true, enumerable: true, writable: false, value: read(key) } : undefined),
  });
}


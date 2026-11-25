import type { SkinHost } from './host';

// A route's host changes whenever anything a document can read changes (a flag, the hero on show,
// a preview starting, a row loading). Given through a plain context, every node of the route drew
// again for each change: a TV redrew all of home twice per focus move in the hero. A tracked host
// instead gives each node a view that notes which host and env keys the node reads; the node draws
// again only when one of those changes. Reads always see the latest host, so handlers called later
// are never stale.

type Listener = () => void;
type Bag = Record<string, unknown>;

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

const READER = Symbol('reader');
interface Target { [READER]: HostReader }
/** An env view's reader, for selectEnv. */
const SELECT = Symbol('select');

const note = (keys: string[], key: string) => { if (!keys.includes(key)) keys.push(key); };

// One handler pair for every view: a view's target holds its reader. A node reads a handful of
// keys, so they are kept in small arrays.
const hostHandler: ProxyHandler<Target> = {
  get(target, key) {
    if (typeof key !== 'string') return undefined;
    const reader = target[READER];
    note(reader.hostKeys, key);
    return key === 'env' ? reader.env : (reader.source.latest as unknown as Bag)[key];
  },
  has: (target, key) => key in target[READER].source.latest,
  ownKeys(target) {
    const reader = target[READER];
    const own = Reflect.ownKeys(reader.source.latest);
    for (const key of own) if (typeof key === 'string') note(reader.hostKeys, key);
    return own;
  },
  getOwnPropertyDescriptor(target, key) {
    if (typeof key !== 'string' || !(key in target[READER].source.latest)) return undefined;
    return { configurable: true, enumerable: true, writable: false, value: hostHandler.get!(target, key, target) };
  },
};
const envHandler: ProxyHandler<Target> = {
  get(target, key) {
    if (key === SELECT) return target[READER];
    if (typeof key !== 'string') return undefined;
    const reader = target[READER];
    note(reader.envKeys, key);
    return (reader.source.latest.env as unknown as Bag)[key];
  },
  has: (target, key) => key in target[READER].source.latest.env,
  ownKeys(target) {
    const reader = target[READER];
    const own = Reflect.ownKeys(reader.source.latest.env);
    for (const key of own) if (typeof key === 'string') note(reader.envKeys, key);
    return own;
  },
  getOwnPropertyDescriptor(target, key) {
    if (typeof key !== 'string' || !(key in target[READER].source.latest.env)) return undefined;
    return { configurable: true, enumerable: true, writable: false, value: envHandler.get!(target, key, target) };
  },
};

type Env = SkinHost['env'];

/** What a node draws from one env key, read through selectEnv: re-read to see whether it changed. */
interface Selection { key: string; select(value: unknown): unknown; value: unknown }

/**
 * Reads what a node draws from one env key: whether this card's preview plays, whether this flag is
 * up. A tracked node then draws again only when that answer changes, not whenever the key does: a
 * card's preview starting or ending redraws that card, not every card of home, and a flag redraws
 * only the nodes it shows or hides. `id` names the answer among the node's others (`card:<id>`,
 * `flag:<name>`). Outside a tracked host it is the plain read.
 */
export function selectEnv<K extends keyof Env & string, T>(env: Env, key: K, id: string, select: (value: Env[K]) => T): T {
  const reader = (env as unknown as { [SELECT]?: HostReader })[SELECT];
  if (!reader) return select(env[key]);
  return reader.select(key, id, select as (value: unknown) => T);
}

/** One reader's view of a source: the keys it has read, and a version that moves only when one of
 * them changes. */
export class HostReader {
  readonly hostKeys: string[] = [];
  readonly envKeys: string[] = [];
  /** Answers read through selectEnv, by key and id. */
  private readonly selections = new Map<string, Selection>();
  version = 0;
  host: SkinHost;
  env: SkinHost['env'];
  private seen: SkinHost;
  constructor(readonly source: HostSource) {
    this.seen = source.latest;
    this.host = this.env = undefined as never;
    this.view();
  }
  /** The version for the source's latest host (useSyncExternalStore's snapshot). */
  readonly snapshot = (): number => {
    const next = this.source.latest;
    if (next !== this.seen) {
      if (this.differs(this.seen, next)) {
        this.version++;
        this.view();
      }
      this.seen = next;
    }
    return this.version;
  };
  /** selectEnv's read: the answer, noted with how to read it again. */
  select<T>(key: string, id: string, select: (value: unknown) => T): T {
    const value = select((this.source.latest.env as unknown as Bag)[key]);
    this.selections.set(`${key}\u0000${id}`, { key, select, value });
    return value;
  }
  private differs(a: SkinHost, b: SkinHost): boolean {
    const hostA = a as unknown as Bag, hostB = b as unknown as Bag;
    for (const key of this.hostKeys) if (key !== 'env' && hostA[key] !== hostB[key]) return true;
    if (a.env === b.env) return false;
    const envA = a.env as unknown as Bag, envB = b.env as unknown as Bag;
    for (const key of this.envKeys) if (envA[key] !== envB[key]) return true;
    for (const read of this.selections.values()) {
      if (envA[read.key] !== envB[read.key] && !Object.is(read.select(envB[read.key]), read.value)) return true;
    }
    return false;
  }
  /** Fresh views, so memos and effects that depend on the host or env see a change. */
  private view(): void {
    this.env = new Proxy({ [READER]: this }, envHandler) as unknown as SkinHost['env'];
    this.host = new Proxy({ [READER]: this }, hostHandler) as unknown as SkinHost;
  }
}

/** One demux epoch, shared by AV consumers. Entries reference parsed bytes;
 * neither packets nor cluster byte buffers are copied by this cache. */
const MAX_BYTES = 32 * 1024 * 1024,
  MAX_ENTRIES = 16,
  MAX_BLOCKS = 65536;
interface Entry {
  value: unknown;
  sourceBytes: number;
  charge: number;
  blocks: number;
  release(): void;
}
interface State {
  entries: Map<number, Entry>;
  pending: Map<number, Promise<unknown>>;
  bytes: number;
  sourceBytes: number;
  blocks: number;
  hits: number;
  loads: number;
  joins: number;
  evictions: number;
}
const owners = new WeakMap<object, State>(),
  sources = new WeakMap<object, State>();
function stateFor(owner: object, source: object): State {
  let state = owners.get(owner);
  if (!state) {
    state = {
      entries: new Map(),
      pending: new Map(),
      bytes: 0,
      sourceBytes: 0,
      blocks: 0,
      hits: 0,
      loads: 0,
      joins: 0,
      evictions: 0,
    };
    owners.set(owner, state);
  }
  sources.set(source, state);
  return state;
}
export function cachedCluster<T>(owner: object, position: number): T | null {
  const state = owners.get(owner),
    entry = state?.entries.get(position);
  if (!state || !entry) return null;
  state.entries.delete(position);
  state.entries.set(position, entry);
  state.hits++;
  return entry.value as T;
}
/** Includes in-flight deduplication: concurrent metadata consumers parse once. */
export async function loadCluster<T>(
  owner: object,
  source: object,
  position: number,
  read: () => Promise<T>,
  describe: (value: T) => { sourceBytes: number; blocks: number; release(): void },
): Promise<T> {
  const state = stateFor(owner, source),
    cached = cachedCluster<T>(owner, position);
  if (cached !== null) return cached;
  const pending = state.pending.get(position);
  if (pending) {
    state.joins++;
    return pending as Promise<T>;
  }
  state.loads++;
  const work = Promise.resolve()
    .then(read)
    .then((value) => {
      const { sourceBytes, blocks, release } = describe(value);
      // Charge packet metadata as well as retained cluster data; independently cap
      // packet count because JS object overhead is not measurable byte-for-byte.
      const charge = sourceBytes + blocks * 256;
      if (
        !Number.isSafeInteger(charge) ||
        sourceBytes < 0 ||
        blocks < 0 ||
        charge > MAX_BYTES ||
        blocks > MAX_BLOCKS
      ) {
        release();
        return value;
      }
      state.entries.set(position, { value, sourceBytes, charge, blocks, release });
      state.bytes += charge;
      state.sourceBytes += sourceBytes;
      state.blocks += blocks;
      while (state.bytes > MAX_BYTES || state.entries.size > MAX_ENTRIES || state.blocks > MAX_BLOCKS) {
        const key = state.entries.keys().next().value!,
          entry = state.entries.get(key)!;
        state.entries.delete(key);
        state.bytes -= entry.charge;
        state.sourceBytes -= entry.sourceBytes;
        state.blocks -= entry.blocks;
        state.evictions++;
        entry.release();
      }
      return value;
    })
    .finally(() => state.pending.delete(position));
  state.pending.set(position, work);
  return work;
}
export function clusterCacheAudit(source: object) {
  const state = sources.get(source);
  return state
    ? {
        entries: state.entries.size,
        sourceBytes: state.sourceBytes,
        chargedBytes: state.bytes,
        blocks: state.blocks,
        hits: state.hits,
        loads: state.loads,
        joins: state.joins,
        evictions: state.evictions,
      }
    : null;
}

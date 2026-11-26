import type { Connection } from '../adapter/connection';
import {
  findWorkingPlexOrigin,
  isUnreachableError,
  PLEX_RELOCATE_CANDIDATE_TIMEOUT_MS,
  PLEX_RELOCATE_COOLDOWN_MS,
  PLEX_RELOCATE_DEADLINE_MS,
} from '../adapter/plex/relocate';
import { ServerCredentials, type ServerRecord } from '../session/servers';
import type { VelaState } from './index';
import type { Session } from './session';
import type { StateBox } from './state';

/** Whether video or audio playback is currently active (relocation must not reset the app while playing). */
export function isPlaybackActive(state: Partial<Pick<VelaState, 'playback' | 'audio'>> | undefined): boolean {
  const video = state?.playback?.phase;
  if (video === 'starting' || video === 'preparing' || video === 'playing') return true;
  const audio = state?.audio?.phase;
  if (audio === 'loading' || audio === 'playing' || audio === 'paused' || audio === 'buffering') return true;
  return false;
}

export interface PlexRelocatorOptions {
  deadlineMs?: number;
  candidateTimeoutMs?: number;
  cooldownMs?: number;
  now?: () => number;
  findOrigin?: typeof findWorkingPlexOrigin;
}

interface ActiveSearch {
  serverId: string;
  origin: string;
  epoch: number;
  controller: AbortController;
  promise: Promise<boolean>;
  join(signal?: AbortSignal): boolean;
}

function waitForResult(promise: Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>(resolve => {
    const onAbort = () => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(signal.aborted ? false : value);
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve(false);
      },
    );
  });
}

/**
 * Shared relocation search for a directly linked Plex server whose saved address stopped answering.
 * Concurrent callers share one search per `(serverId, origin, epoch)`, bounded by one overall
 * deadline and cooled down after a genuine miss. A search aborts as soon as every reader leaves or
 * the session/server resets, and commits only if nothing changed and nothing is playing.
 */
export class PlexRelocator {
  private active: ActiveSearch | undefined;
  private readonly misses = new Map<string, number>();
  private readonly deadlineMs: number;
  private readonly candidateTimeoutMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly findOrigin: typeof findWorkingPlexOrigin;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    options: PlexRelocatorOptions = {},
  ) {
    this.deadlineMs = options.deadlineMs ?? PLEX_RELOCATE_DEADLINE_MS;
    this.candidateTimeoutMs = options.candidateTimeoutMs ?? PLEX_RELOCATE_CANDIDATE_TIMEOUT_MS;
    this.cooldownMs = options.cooldownMs ?? PLEX_RELOCATE_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
    this.findOrigin = options.findOrigin ?? findWorkingPlexOrigin;
    session.onReset(() => {
      this.misses.clear();
      const current = this.active;
      if (current) {
        this.active = undefined;
        current.controller.abort();
      }
    });
  }

  tryRelocate(connection: Connection, epoch: number, error: unknown, signal?: AbortSignal): Promise<boolean> {
    if (!isUnreachableError(error, signal?.aborted)) return Promise.resolve(false);
    if (signal?.aborted || epoch !== this.session.epoch) return Promise.resolve(false);
    const record = connection.record;
    if (record.kind !== 'plex' || !record.machineIdentifier) return Promise.resolve(false);
    if (!(connection.credentials instanceof ServerCredentials)) return Promise.resolve(false);
    if (isPlaybackActive(this.box.get())) return Promise.resolve(false);

    let registry;
    try { registry = this.session.servers.read(); } catch { return Promise.resolve(false); }
    if (registry.selectedId !== record.id) return Promise.resolve(false);
    const currentRecord = registry.servers.find(s => s.id === record.id);
    if (!currentRecord
      || currentRecord.kind !== 'plex'
      || currentRecord.origin !== record.origin
      || currentRecord.machineIdentifier !== record.machineIdentifier) {
      return Promise.resolve(false);
    }

    const existing = this.active;
    if (existing && existing.serverId === record.id && existing.origin === record.origin && existing.epoch === epoch) {
      if (existing.join(signal)) return waitForResult(existing.promise, signal);
    }

    const missKey = `${record.id}\0${record.origin}`;
    const missedAt = this.misses.get(missKey);
    if (missedAt !== undefined && this.now() - missedAt < this.cooldownMs) {
      return Promise.resolve(false);
    }

    if (existing) {
      this.active = undefined;
      existing.controller.abort();
    }

    // Register the shared search synchronously before any await so concurrent callers on the same tick share it.
    const controller = new AbortController();
    let readers = 0;
    const detach: (() => void)[] = [];
    const join = (reader?: AbortSignal): boolean => {
      if (controller.signal.aborted || reader?.aborted) return false;
      if (!reader) {
        readers = Number.POSITIVE_INFINITY;
        return true;
      }
      readers++;
      const onAbort = () => {
        if (--readers <= 0 && !controller.signal.aborted) controller.abort(reader.reason);
      };
      reader.addEventListener('abort', onAbort, { once: true });
      detach.push(() => reader.removeEventListener('abort', onAbort));
      return true;
    };
    join(signal);

    const search: ActiveSearch = {
      serverId: record.id,
      origin: record.origin,
      epoch,
      controller,
      promise: Promise.resolve(false),
      join,
    };
    this.active = search;
    search.promise = this.run(connection, currentRecord, epoch, missKey, controller.signal)
      .finally(() => {
        for (const cleanup of detach) cleanup();
        if (this.active === search) this.active = undefined;
      });
    return waitForResult(search.promise, signal);
  }

  private async run(
    connection: Connection,
    record: ServerRecord,
    epoch: number,
    missKey: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const credentials = connection.credentials as ServerCredentials;
    const initialTokens = await credentials.get();
    const initialAccount = await credentials.plexAccount();
    if (signal.aborted || epoch !== this.session.epoch || !initialTokens?.accessToken) return false;
    if (isPlaybackActive(this.box.get())) return false;

    let excludedOrigins: Set<string>;
    try {
      excludedOrigins = new Set(
        this.session.servers.read().servers
          .filter(s => s.id !== record.id && s.kind === 'plex')
          .map(s => s.origin),
      );
    } catch {
      return false;
    }

    const found = await this.findOrigin({
      device: this.session.device,
      accountToken: initialAccount ?? initialTokens.accessToken,
      serverToken: initialTokens.accessToken,
      machineIdentifier: record.machineIdentifier!,
      currentOrigin: record.origin,
      excludedOrigins,
      deadlineMs: this.deadlineMs,
      candidateTimeoutMs: this.candidateTimeoutMs,
      signal,
      now: this.now,
    });

    // An aborted search or one whose session/server moved on is not a genuine miss.
    if (signal.aborted || epoch !== this.session.epoch) return false;
    if (!found) {
      this.misses.set(missKey, this.now());
      return false;
    }

    // Re-check every invariant right before committing relocation.
    if (isPlaybackActive(this.box.get())) return false;
    const sameRecord = () => {
      let registry;
      try { registry = this.session.servers.read(); } catch { return null; }
      if (registry.selectedId !== record.id) return null;
      const latest = registry.servers.find(s => s.id === record.id);
      if (!latest
        || latest.kind !== 'plex'
        || latest.origin !== record.origin
        || latest.machineIdentifier !== record.machineIdentifier) return null;
      return latest;
    };
    if (!sameRecord()) return false;

    const latestTokens = await credentials.get();
    const latestAccount = await credentials.plexAccount();
    if (signal.aborted || epoch !== this.session.epoch || isPlaybackActive(this.box.get())) return false;
    if (!latestTokens
      || latestTokens.accessToken !== initialTokens.accessToken
      || latestTokens.viewer.id !== initialTokens.viewer.id
      || latestTokens.viewer.name !== initialTokens.viewer.name
      || latestAccount !== initialAccount) {
      return false;
    }
    const finalRecord = sameRecord();
    if (!finalRecord) return false;

    try {
      this.session.relocateServer(record.id, found.name || finalRecord.name, found.origin);
    } catch {
      return false;
    }
    this.misses.delete(missKey);
    return true;
  }
}

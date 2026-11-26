import { VelaError } from '../errors';
import { fetchBounded, readJsonBody } from '../../protocol/timeout';
import { discoverPlexServers, plexHeaders, type PlexDevice, type PlexResource } from './auth';

/** One overall deadline for finding a moved Plex server; fits inside SESSION_RESTORE_TIMEOUT_MS after validateSession. */
export const PLEX_RELOCATE_DEADLINE_MS = 12_000;
/** Per-candidate probe budget (identity + library check combined). */
export const PLEX_RELOCATE_CANDIDATE_TIMEOUT_MS = 4_000;
/** Cool-down after a genuine miss so an offline server is not looked up on every failed read. */
export const PLEX_RELOCATE_COOLDOWN_MS = 60_000;
/** Bounded wait for PlexAdapter.validateSession so a blackholed address fails before the restore deadline. */
export const PLEX_VALIDATE_TIMEOUT_MS = 6_000;

const unreachableErrors = new WeakSet<object>();

/** Tag a transport or timeout error thrown by a Plex request so callers know the server gave no answer. */
export function markPlexUnreachable(error: unknown): void {
  if (!error || typeof error !== 'object') return;
  if (error instanceof VelaError || error instanceof SyntaxError) return;
  unreachableErrors.add(error);
}

/**
 * Whether `error` represents "no answer at all" (timeout or network failure), rather than an HTTP
 * refusal, an unparseable response, or a caller-initiated abort.
 */
export function isUnreachableError(error: unknown, callerAborted = false): boolean {
  if (callerAborted || !error) return false;
  if (error instanceof VelaError || error instanceof SyntaxError) return false;
  if (typeof error === 'object' && unreachableErrors.has(error)) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return false;
    if (error.name === 'TimeoutError' || error.message === 'Request timed out') return true;
  }
  return false;
}

/**
 * Ranked HTTPS candidate origins listed by plex.tv for this server: `*.plex.direct` first, other
 * HTTPS addresses next, relays last; deduplicated, excluding the current origin and any origin
 * already owned by another saved Plex server record.
 */
export function relocationCandidates(
  resource: Pick<PlexResource, 'connections'>,
  currentOrigin: string,
  excludedOrigins?: ReadonlySet<string>,
): string[] {
  const ranked: { origin: string; rank: number; index: number }[] = [];
  for (let index = 0; index < resource.connections.length; index++) {
    const connection = resource.connections[index];
    if (!connection || typeof connection.uri !== 'string') continue;
    let url: URL;
    try { url = new URL(connection.uri); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) continue;
    const origin = url.origin;
    if (origin === currentOrigin || excludedOrigins?.has(origin)) continue;
    const direct = url.hostname.toLowerCase().endsWith('.plex.direct');
    const rank = connection.relay ? 2 : direct ? 0 : 1;
    ranked.push({ origin, rank, index });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of ranked) {
    if (seen.has(item.origin)) continue;
    seen.add(item.origin);
    result.push(item.origin);
  }
  return result;
}

/** Confirm a `/library/sections` payload is a valid Plex MediaContainer response for this server. */
export function isValidLibrarySectionsResponse(body: unknown, machineIdentifier: string): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const container = (body as { MediaContainer?: unknown }).MediaContainer;
  if (!container || typeof container !== 'object' || Array.isArray(container)) return false;
  const record = container as Record<string, unknown>;
  if (record.machineIdentifier !== undefined && record.machineIdentifier !== machineIdentifier) return false;
  const hasDirectory = Array.isArray(record.Directory);
  const hasSize = typeof record.size === 'number' && Number.isInteger(record.size) && record.size >= 0;
  if (record.Directory !== undefined && !hasDirectory) return false;
  if (record.size !== undefined && !hasSize) return false;
  if (hasDirectory && !(record.Directory as unknown[]).every(item => !!item && typeof item === 'object' && !Array.isArray(item))) {
    return false;
  }
  return hasDirectory || hasSize;
}

/**
 * Prove a candidate origin is the same Plex server and answers `/library/sections` with the stored
 * server token (never the plex.tv account token). Both reads share the candidate's timeout budget.
 */
export async function probePlexCandidate(
  origin: string,
  machineIdentifier: string,
  serverToken: string,
  device: PlexDevice,
  timeoutMs: number,
  signal?: AbortSignal,
  now: () => number = Date.now,
): Promise<boolean> {
  const deadline = now() + timeoutMs;
  const remaining = () => deadline - now();
  const baseHeaders = plexHeaders(device);
  const readJson = async (url: string, headers: Record<string, string>) => {
    const left = remaining();
    if (left <= 0 || signal?.aborted) return null;
    return fetchBounded(
      url,
      { method: 'GET', headers, redirect: 'error', credentials: 'omit', cache: 'no-store' },
      async (response, onCancel) => ({ status: response.status, ok: response.ok, body: response.ok ? await readJsonBody(response, onCancel) : null }),
      left,
      signal,
    );
  };
  try {
    // Ask /identity without a token first so a server proves its identity before seeing the session token.
    // A relay/proxy that asks for authentication on /identity gets one retry with the server token.
    let identity = await readJson(`${origin}/identity`, baseHeaders);
    if (identity && identity.status === 401) {
      identity = await readJson(`${origin}/identity`, { ...baseHeaders, 'X-Plex-Token': serverToken });
    }
    if (!identity?.ok) return false;
    const idBody = identity.body as { MediaContainer?: { machineIdentifier?: unknown } } | null;
    if (idBody?.MediaContainer?.machineIdentifier !== machineIdentifier) return false;

    const sections = await readJson(`${origin}/library/sections`, { ...baseHeaders, 'X-Plex-Token': serverToken });
    if (!sections?.ok) return false;
    return isValidLibrarySectionsResponse(sections.body, machineIdentifier);
  } catch {
    return false;
  }
}

export interface FindWorkingPlexOriginOptions {
  device: PlexDevice;
  accountToken: string;
  serverToken: string;
  machineIdentifier: string;
  currentOrigin: string;
  excludedOrigins?: ReadonlySet<string>;
  deadlineMs?: number;
  candidateTimeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}

/**
 * Look up the server by `machineIdentifier` in the account's plex.tv resources and probe its listed
 * HTTPS addresses inside one overall deadline. Returns the first working origin (and resource name),
 * or null if none answers.
 */
export async function findWorkingPlexOrigin(
  options: FindWorkingPlexOriginOptions,
): Promise<{ origin: string; name: string } | null> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? PLEX_RELOCATE_DEADLINE_MS);
  const candidateTimeout = options.candidateTimeoutMs ?? PLEX_RELOCATE_CANDIDATE_TIMEOUT_MS;
  const remaining = () => deadline - now();
  if (options.signal?.aborted || remaining() <= 0) return null;

  let resources: PlexResource[];
  try {
    resources = await discoverPlexServers(options.device, options.accountToken, {
      timeoutMs: remaining(),
      signal: options.signal,
    });
  } catch {
    return null;
  }
  if (options.signal?.aborted) return null;

  const resource = resources.find(r => r.clientIdentifier === options.machineIdentifier);
  if (!resource) return null;

  const candidates = relocationCandidates(resource, options.currentOrigin, options.excludedOrigins);
  for (const origin of candidates) {
    const left = remaining();
    if (options.signal?.aborted || left <= 0) return null;
    const ok = await probePlexCandidate(
      origin,
      options.machineIdentifier,
      options.serverToken,
      options.device,
      Math.min(candidateTimeout, left),
      options.signal,
      now,
    );
    if (ok) return { origin, name: typeof resource.name === 'string' ? resource.name.trim() : '' };
  }
  return null;
}

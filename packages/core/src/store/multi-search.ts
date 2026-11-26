import type { Connection } from '../adapter/connection';
import type { Card } from '../models';
import type { Viewer } from '../wire';
import type { VelaState } from './index';

export interface SearchResult {
  ref: string;
  card: Card;
  viewer: string;
  policy: string;
}

export interface SearchSection {
  id: string;
  name: string;
  status: 'loading' | 'ready' | 'failed' | 'timed-out';
  results: SearchResult[];
  nextCursor?: string;
}

export function searchServers({ auth, servers }: Pick<VelaState, 'auth' | 'servers'>) {
  if (auth.phase !== 'signed-in' || !auth.crossServerSearch || auth.serverId !== servers.selectedId) return [];
  return servers.list.filter(server => server.status !== 'signed-out');
}

export function resultViewer(result: SearchResult, viewer: Viewer | undefined): boolean {
  return !!viewer && result.viewer === viewer.id && result.policy === viewer.policyRevision;
}

export function resultKey(server: string, result: SearchResult): string {
  return JSON.stringify([server, result.viewer, result.card.kind, result.card.id]);
}

export class SearchTimeout extends Error {}

/** Bound the whole page, including artwork lookup. A late adapter reply cannot publish a page. */
export async function searchDeadline<T>(parent: AbortSignal, ms: number, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  parent.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new SearchTimeout()), ms);
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  try {
    return await Promise.race([cancelled, read(controller.signal)]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', abort);
  }
}

/** All-server title search uses each adapter's fast lane and its own cursor. */
export async function searchServer(connection: Connection, query: string, generation: number, idempotencyKey: string, cursor: string | undefined, signal: AbortSignal) {
  const tokens = await connection.credentials.get();
  signal.throwIfAborted();
  if (!tokens) throw new Error('Session ended');
  const page = await connection.adapter.search({ query, generation, idempotencyKey, cursor }, signal);
  signal.throwIfAborted();
  const images = await connection.images();
  signal.throwIfAborted();
  const current = await connection.credentials.get();
  const { id: viewer, policyRevision: policy } = tokens.viewer;
  if (page.generation !== generation || !current || current.viewer.id !== viewer || current.viewer.policyRevision !== policy) {
    throw new Error('Search session changed');
  }
  return { page, images, viewer, policy };
}

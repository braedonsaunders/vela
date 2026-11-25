// A page being unloaded on the web (a tab closed or reloaded, or the page navigated away) ends its
// playback sessions at the server instead of leaving them running until the server times them out.
import type { UnloadRequest } from '../adapter/capabilities';

type Fetch = (url: string, init: RequestInit) => Promise<unknown>;

/** Fires one unload request without waiting for it: fetch with keepalive, so it outlives the page. */
export function sendKeepalive(request: UnloadRequest, fetcher: Fetch = (url, init) => fetch(url, init)): void {
  try {
    void fetcher(request.url, { method: request.method, ...(request.headers ? { headers: request.headers } : {}), ...(request.body !== undefined ? { body: request.body } : {}),
      keepalive: true, credentials: 'omit', redirect: 'error', cache: 'no-store' }).catch(() => undefined);
  } catch { /* Best-effort: the server's timeout ends the session. */ }
}

/**
 * Stops the playback's sessions when the page goes away: on pagehide, and only then. A page that
 * is merely hidden (visibilitychange: another tab, a minimised window, a locked phone) plays on,
 * since music in the background is the point. Returns the listener's removal.
 */
export function stopSessionsOnPageHide(
  page: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  playback: { stopOnUnload(send: (request: UnloadRequest) => void): number },
  send: (request: UnloadRequest) => void = request => sendKeepalive(request),
): () => void {
  const hide = () => { playback.stopOnUnload(send); };
  page.addEventListener('pagehide', hide);
  return () => page.removeEventListener('pagehide', hide);
}

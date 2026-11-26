/** A signal that aborts after `ms`, without relying on `AbortSignal.timeout` (absent on some hosts). */
export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('Request timed out')), ms);
  return controller.signal;
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * Read a response body as text while registering a cancel hook that works even while the stream is
 * actively being read (a locked `ReadableStream` ignores `body.cancel()`, whereas `reader.cancel()`
 * closes it immediately). Falls back to `response.text()` when streaming readers are unavailable.
 */
export async function readTextBody(response: Response, onCancel?: (cancel: () => void) => void): Promise<string> {
  if (response.body && typeof response.body.getReader === 'function' && typeof TextDecoder === 'function') {
    const reader = response.body.getReader();
    onCancel?.(() => { void reader.cancel().catch(() => {}); });
    const decoder = new TextDecoder();
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } finally {
      try { reader.releaseLock(); } catch { /* already closed or cancelled */ }
    }
  }
  return response.text();
}

/**
 * Fetch and read a response inside one combined timeout + caller abort race. On Android (Expo's
 * native fetch), `response.text()` can stall even after the fetch signal aborts; racing the whole
 * fetch + body read against the deadline and cancelling the body ensures a stalled response never
 * outlives its budget.
 */
export async function fetchBounded<T>(
  url: string,
  init: RequestInit,
  read: (response: Response, onCancel: (cancel: () => void) => void) => Promise<T>,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw signal.reason ?? abortError();
  if (timeoutMs !== undefined && timeoutMs <= 0) throw new Error('Request timed out');
  const controller = new AbortController();
  let responseRef: Response | undefined;
  let cancelBody: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failRace!: (reason: unknown) => void;
  const race = new Promise<never>((_, reject) => { failRace = reject; });
  const cancelActiveBody = () => {
    if (cancelBody) cancelBody();
    else void responseRef?.body?.cancel?.().catch(() => {});
  };
  const stop = (reason: unknown) => {
    cancelActiveBody();
    if (!controller.signal.aborted) controller.abort(reason);
    failRace(reason);
  };
  const onAbort = () => stop(signal?.reason ?? abortError());
  signal?.addEventListener('abort', onAbort, { once: true });
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => stop(new Error('Request timed out')), timeoutMs);
  }
  const work = (async () => {
    const response = await fetch(url, { ...init, signal: controller.signal });
    responseRef = response;
    if (controller.signal.aborted) {
      cancelActiveBody();
      throw controller.signal.reason ?? abortError();
    }
    const result = await read(response, cancel => {
      cancelBody = cancel;
      if (controller.signal.aborted) cancel();
    });
    if (controller.signal.aborted) throw controller.signal.reason ?? abortError();
    return result;
  })();
  // Suppress unhandled rejection if the underlying fetch/body rejects after the race settles.
  void work.catch(() => {});
  try {
    return await Promise.race([work, race]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Fetch and read a response body as text when `readBody(response)` is true, bounded as one operation. */
export function fetchTextBounded(
  url: string,
  init: RequestInit,
  timeoutMs?: number,
  signal?: AbortSignal,
  readBody: (response: Response) => boolean = response => response.ok && response.status !== 204,
): Promise<{ response: Response; text: string }> {
  return fetchBounded(
    url,
    init,
    async (response, onCancel) => ({ response, text: readBody(response) ? await readTextBody(response, onCancel) : '' }),
    timeoutMs,
    signal,
  );
}

/** Parse a response as JSON inside `fetchBounded`, tolerating mock responses with only `.json()`. */
export async function readJsonBody(response: Response, onCancel?: (cancel: () => void) => void): Promise<unknown> {
  if (typeof response.text === 'function' || response.body) {
    const text = await readTextBody(response, onCancel);
    return JSON.parse(text);
  }
  return response.json();
}

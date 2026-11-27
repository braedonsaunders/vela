import type { MediaRequestPolicy } from './media-auth';

const downloadsPrefix = '/vela-downloads/';

/** Check the raw path before URL parsing can normalize a traversal segment away. */
export function localMediaURL(input: string, origin = globalThis.location?.origin): URL | undefined {
  if (!origin || origin === 'null' || /[\\?#\u0000-\u0020\u007f]/.test(input)) return;
  const blobPrefix = `blob:${origin}/`;
  const routePrefix = origin + downloadsPrefix;
  const blob = input.startsWith(blobPrefix);
  const prefix = blob ? blobPrefix : routePrefix;
  if (!input.startsWith(prefix)) return;
  const raw = input.slice(prefix.length);
  if (blob && raw.includes('/')) return;
  try {
    if (/%(?:2f|5c|25)/i.test(raw) || raw.split('/').some(segment => {
      const decoded = decodeURIComponent(segment);
      return !decoded || decoded === '.' || decoded === '..' || /[:\\\u0000-\u001f\u007f]/.test(decoded);
    })) return;
    const url = new URL(input);
    // WHATWG URL reports a null origin for Electron's standard custom scheme.
    const actualOrigin = url.origin === 'null' && url.protocol === 'vela-app:'
      ? `${url.protocol}//${url.host}` : url.origin;
    if (actualOrigin === origin && !url.username && !url.password) return url;
  } catch {
    return;
  }
}

/** Local file policy for the range-backed ByteReader, metadata and subtitle reads. */
export function localMediaPolicy(origin = globalThis.location?.origin): MediaRequestPolicy {
  // Fetch resolves an object URL to its existing backing Blob. Slice that Blob
  // for every read, independently of browser support for blob fetch ranges.
  const blobs = new Map<string, Blob>();
  return {
    allows: url => !!localMediaURL(url.href, origin),
    authorization: () => undefined,
    async fetch(input, init) {
      const url = localMediaURL(input instanceof Request ? input.url : String(input), origin);
      if (!url) throw new Error('Local media URL is outside the downloads scope');
      const signal = init?.signal;
      signal?.throwIfAborted();
      const range = new Headers(init?.headers).get('Range');
      const request = { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' } as const;
      if (url.protocol !== 'blob:')
        return fetch(url, { ...request, headers: range ? { Range: range } : undefined, method: init?.method });
      let blob = blobs.get(url.href);
      if (!blob) {
        const response = await fetch(url, request);
        if (!response.ok) return response;
        blob = await response.blob();
        blobs.set(url.href, blob);
      }
      signal?.throwIfAborted();
      const headers = new Headers({ 'Content-Type': blob.type, 'Accept-Ranges': 'bytes' });
      if (!range) {
        headers.set('Content-Length', String(blob.size));
        return new Response(init?.method === 'HEAD' ? null : blob, { headers });
      }
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : -1;
      const end = Math.min(blob.size - 1, match?.[2] ? Number(match[2]) : blob.size - 1);
      if (!Number.isSafeInteger(start) || start < 0 || start > end) {
        headers.set('Content-Range', `bytes */${blob.size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${blob.size}`);
      headers.set('Content-Length', String(end - start + 1));
      return new Response(init?.method === 'HEAD' ? null : blob.slice(start, end + 1), { status: 206, headers });
    },
  };
}

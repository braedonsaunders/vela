import { homedir } from 'node:os';
import { join } from 'node:path';
export const fixtureDurationSeconds = 180;
export const mediaRoot = join(homedir(), '.scratch/tmp/vela/media');
export interface Faults { bandwidthBps: number; failEvery: number; truncateEvery: number; stallMs: number; fallbackUnavailable: boolean; capacityExhausted: boolean }
export const faults: Faults = { bandwidthBps: 0, failEvery: 0, truncateEvery: 0, stallMs: 0, fallbackUnavailable: false, capacityExhausted: false };
let segmentCount = 0;
export async function serveMedia(req: Request, resource: string): Promise<Response> {
  if (!/^(master\.m3u8|mse-master\.m3u8|ts-master\.m3u8|direct\.mp4|subtitles\.vtt|(?:v(?:360|540|720)|video(?:360|540|720)|a_(?:en|es))\/(?:index\.m3u8|init\.mp4|seg-\d+\.m4s)|ts(?:360|540|720)\/(?:index\.m3u8|seg-\d+\.ts))$/.test(resource)) return new Response('Not found', { status: 404 });
  const file = Bun.file(join(mediaRoot, resource));
  if (!await file.exists()) return Response.json({ error: 'media_not_generated', message: 'Run bun mock-server/scripts/make-media.ts' }, { status: 503 });
  const f = { ...faults };
  for (const key of ['bandwidthBps', 'failEvery', 'truncateEvery', 'stallMs'] as const) {
    const q = new URL(req.url).searchParams.get(key);
    if (q !== null && Number.isFinite(Number(q))) f[key] = Math.max(0, Math.min(60_000_000, Number(q)));
  }
  const segment = resource.endsWith('.m4s') || resource.endsWith('.ts'), count = segment ? ++segmentCount : 0;
  if (segment && f.failEvery > 0 && count % f.failEvery === 0) return new Response('Injected source failure', { status: 502 });
  const audio = resource.startsWith('a_');
  const headers = new Headers({ 'Content-Type': resource.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : resource.endsWith('.vtt') ? 'text/vtt' : resource.endsWith('.ts') ? 'video/mp2t' : resource.endsWith('.m4s') ? (audio ? 'audio/iso.segment' : 'video/iso.segment') : (audio ? 'audio/mp4' : 'video/mp4'), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  let start = 0, end = file.size - 1, status = 200;
  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
    start = m[1] ? Number(m[1]) : Math.max(0, file.size - Number(m[2]));
    end = m[1] && m[2] ? Math.min(Number(m[2]), end) : end;
    if (start > end || start >= file.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
    headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`); status = 206;
  }
  const length = end - start + 1;
  headers.set('Content-Length', String(length));
  if (req.method === 'HEAD') return new Response(null, { status, headers });
  const truncate = segment && f.truncateEvery > 0 && count % f.truncateEvery === 0;
  if (!f.bandwidthBps && !f.stallMs && !truncate) return new Response(file.slice(start, end + 1), { status, headers });
  const stop = truncate ? start + Math.floor(length / 2) : end + 1;
  let pos = start, first = true, cancelled = false;
  const wait = (ms: number) => new Promise<void>(resolve => { const timer = setTimeout(done, ms); function done() { clearTimeout(timer); req.signal.removeEventListener('abort', done); resolve(); } req.signal.addEventListener('abort', done, { once: true }); if (req.signal.aborted) done(); });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (first) { first = false; if (f.stallMs) await wait(Math.min(f.stallMs, 60000)); }
      if (cancelled || req.signal.aborted) { if (!cancelled) controller.close(); return; }
      if (pos >= stop) { if (truncate) controller.error(new Error('Injected truncated segment')); else controller.close(); return; }
      const size = f.bandwidthBps ? Math.max(1, Math.min(16384, Math.floor(f.bandwidthBps / 8 / 10))) : 16384;
      const next = Math.min(stop, pos + size), bytes = new Uint8Array(await file.slice(pos, next).arrayBuffer());
      if (f.bandwidthBps) await wait(bytes.length * 8000 / f.bandwidthBps);
      if (cancelled) return;
      pos = next; controller.enqueue(bytes);
    }, cancel() { cancelled = true; },
  });
  return new Response(body, { status, headers });
}

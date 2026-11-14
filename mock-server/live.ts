import { join } from 'node:path';
import { mediaRoot, serveMedia } from './media';

// One shared broadcast clock; URLs keep sequence identity across playlist refreshes.
const epoch = Date.now() - 60_000;
export const liveFaults = { gapEvery: 0, delayEvery: 0, delayMs: 8000 };
export function liveWindow() {
  const edge = Math.floor((Date.now() - epoch) / 4000) * 4;
  return { mode: 'adaptive' as const, windowStartSeconds: Math.max(0, edge - 48), liveEdgeSeconds: edge, maxDriftSeconds: 45 };
}
const headers = { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' };

// Rebase CMAF decode times when the synthetic ladder loops. This preserves a
// continuous timeline without discontinuities or resetting the media sequence.
function boxes(bytes: Uint8Array, begin: number, end: number, visit: (type: string, start: number, end: number) => void) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = begin; at + 8 <= end;) {
    const size = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (size < 8 || at + size > end) break;
    visit(type, at + 8, at + size); at += size;
  }
}
async function rebase(resource: string, cycle: number): Promise<Uint8Array> {
  const [variant] = resource.split('/');
  const init = new Uint8Array(await Bun.file(join(mediaRoot, variant, 'init.mp4')).arrayBuffer());
  const scales = new Map<number, number>();
  const iv = new DataView(init.buffer);
  boxes(init, 0, init.length, (type, a, b) => {
    if (type !== 'moov') return;
    boxes(init, a, b, (type, a, b) => {
      if (type !== 'trak') return;
      let id = 0, scale = 0;
      boxes(init, a, b, (type, a, b) => {
        if (type === 'tkhd') id = iv.getUint32(a + (init[a] === 1 ? 20 : 12));
        if (type === 'mdia') boxes(init, a, b, (type, a) => { if (type === 'mdhd') scale = iv.getUint32(a + (init[a] === 1 ? 20 : 12)); });
      });
      if (id && scale) scales.set(id, scale);
    });
  });
  const bytes = new Uint8Array(await Bun.file(join(mediaRoot, resource)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  boxes(bytes, 0, bytes.length, (type, a, b) => {
    if (type !== 'moof') return;
    boxes(bytes, a, b, (type, a, b) => {
      if (type !== 'traf') return;
      let track = 0;
      boxes(bytes, a, b, (type, a) => { if (type === 'tfhd') track = view.getUint32(a + 4); });
      boxes(bytes, a, b, (type, a) => {
        if (type !== 'tfdt') return;
        const scale = scales.get(track);
        if (!scale) throw new Error('Missing live track timescale');
        const delta = BigInt(cycle * 60 * scale);
        if (bytes[a] === 1) view.setBigUint64(a + 4, view.getBigUint64(a + 4) + delta);
        else view.setUint32(a + 4, view.getUint32(a + 4) + Number(delta));
      });
    });
  });
  return bytes;
}
export async function serveLive(req: Request, resource: string): Promise<Response> {
  if (resource === 'master.m3u8') {
    const text = await Bun.file(join(mediaRoot, resource)).text();
    // The generated video ladder already contains English audio. Avoid a second
    // independent audio timeline in the small mock live fixture.
    return new Response(text.split('\n').filter(l => !l.startsWith('#EXT-X-MEDIA:')).map(l => l.replace(',AUDIO="audio"', '')).join('\n'), { headers });
  }
  const playlist = /^(v360|v540|v720)\/index\.m3u8$/.exec(resource);
  if (playlist) {
    const edge = Math.floor((Date.now() - epoch) / 4000), first = Math.max(0, edge - 12);
    const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-TARGETDURATION:4', `#EXT-X-MEDIA-SEQUENCE:${first}`, '#EXT-X-MAP:URI="init.mp4"'];
    for (let seq = first; seq < edge; seq++) {
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(epoch + seq * 4000).toISOString()}`, '#EXTINF:4.000,');
      if (liveFaults.gapEvery > 0 && seq % liveFaults.gapEvery === 0) lines.push('#EXT-X-GAP');
      lines.push(`segment-${seq}.m4s`);
    }
    return new Response(lines.join('\n') + '\n', { headers });
  }
  const segment = /^(v360|v540|v720)\/segment-(\d+)\.m4s$/.exec(resource);
  if (segment) {
    const seq = Number(segment[2]);
    if (!Number.isSafeInteger(seq) || seq >= Math.floor((Date.now() - epoch) / 4000)) return new Response('Not published', { status: 404 });
    if (liveFaults.gapEvery > 0 && seq % liveFaults.gapEvery === 0) return new Response('Upstream gap', { status: 410 });
    if (liveFaults.delayEvery > 0 && seq % liveFaults.delayEvery === 0) {
      await new Promise<void>(resolve => { const timer = setTimeout(done, Math.min(60000, liveFaults.delayMs)); function done() { clearTimeout(timer); req.signal.removeEventListener('abort', done); resolve(); } req.signal.addEventListener('abort', done, { once: true }); if (req.signal.aborted) done(); });
      if (req.signal.aborted) return new Response(null, { status: 499 });
    }
    const bytes = await rebase(`${segment[1]}/seg-${String(seq % 15).padStart(3, '0')}.m4s`, Math.floor(seq / 15));
    return new Response(req.method === 'HEAD' ? null : bytes.buffer as ArrayBuffer, { headers: { 'Content-Type': 'video/iso.segment', 'Cache-Control': 'no-store', 'Content-Length': String(bytes.length) } });
  }
  return serveMedia(req, resource);
}

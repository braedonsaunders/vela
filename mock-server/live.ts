import { join } from 'node:path';
import { mediaRoot, serveMedia } from './media';

// One shared broadcast clock; URLs keep sequence identity across playlist refreshes. With catch-up
// (VELA_MOCK_CATCHUP, on unless 0) the broadcast began twenty minutes before the mock did, so a channel
// opens with a rewind window that keeps growing to VELA_MOCK_TIMESHIFT_MINUTES (60).
export const catchUpEnabled = process.env.VELA_MOCK_CATCHUP !== '0';
export const timeshiftMinutes = catchUpEnabled ? Math.max(0, Math.min(240, Number(process.env.VELA_MOCK_TIMESHIFT_MINUTES ?? 60) || 0)) : 0;
const epoch = Date.now() - (timeshiftMinutes ? 20 * 60_000 : 60_000);
/**
 * mediaLeadSeconds: every live segment's media starts this much later than its playlist time, as a
 * relay starting from its backlog published it (Ether, November 2026: 5 s). A player that parks at
 * the playlist's time sits in front of a hole it never fills.
 */
export const liveFaults = { gapEvery: 0, delayEvery: 0, delayMs: 8000, mediaLeadSeconds: 0 };
/** The newest published segment's sequence number. */
export const edgeSequence = (now = Date.now()) => Math.floor((now - epoch) / 4000);
/** The segment carrying a wall-clock instant (negative before the broadcast began: the archive). */
export const sequenceAt = (ms: number) => Math.floor((ms - epoch) / 4000);
const windowSegments = () => (timeshiftMinutes ? timeshiftMinutes * 15 : 12);
export function liveWindow() {
  const edgeSeq = edgeSequence(), edge = edgeSeq * 4;
  return { mode: 'adaptive' as const, windowStartSeconds: Math.max(0, edgeSeq - windowSegments()) * 4, liveEdgeSeconds: edge, maxDriftSeconds: 45,
    ...(timeshiftMinutes ? { timeshift: { maxMinutes: timeshiftMinutes }, edgeAt: new Date(epoch + edgeSeq * 4000).toISOString() } : {}) };
}
/** A programme from the archive, on its own timeline from zero: its start, and its end (still airing: open). */
export function archiveWindow(startSeq: number, endSeq: number | null) {
  const edgeSeq = Math.min(edgeSequence(), endSeq ?? Infinity);
  return { edge: Math.max(0, edgeSeq - startSeq) * 4, edgeAt: new Date(epoch + edgeSeq * 4000).toISOString(), ended: endSeq !== null && endSeq <= edgeSequence() };
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
async function rebase(resource: string, offsetSeconds: number): Promise<Uint8Array> {
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
        const delta = BigInt(Math.round(offsetSeconds * scale));
        // An archive starts at zero, and the fixture's audio begins a little before each 4 s mark:
        // its first decode time is held at zero rather than wrapping negative (Media3 refuses it).
        const at = (value: bigint) => (value + delta < 0n ? 0n : value + delta);
        if (bytes[a] === 1) view.setBigUint64(a + 4, at(view.getBigUint64(a + 4)));
        else view.setUint32(a + 4, Number(at(BigInt(view.getUint32(a + 4)))));
      });
    });
  });
  return bytes;
}
/** One fixture segment for a sequence number, its decode times moved `shift` seconds earlier. */
async function segmentBytes(variant: string, seq: number, shift: number): Promise<Uint8Array> {
  const k = ((seq % 15) + 15) % 15, cycle = Math.floor(seq / 15);
  return rebase(`${variant}/seg-${String(k).padStart(3, '0')}.m4s`, cycle * 60 - shift);
}

/**
 * A programme from the archive: `archive/<startSeq>/<endSeq|open>/…`. Its playlist runs from the
 * programme's first segment, rebased so the programme starts at zero: an ended one is on-demand
 * media (ENDLIST), one still airing an EVENT playlist that grows with the broadcast (Start over).
 */
async function serveArchive(req: Request, startSeq: number, endSeq: number | null, rest: string): Promise<Response> {
  if (rest === 'master.m3u8') return serveLive(req, rest);
  const playlist = /^(v360|v540|v720)\/index\.m3u8$/.exec(rest);
  if (playlist) {
    const last = Math.min(edgeSequence(), endSeq ?? Infinity), ended = endSeq !== null && endSeq <= edgeSequence();
    const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-TARGETDURATION:4', `#EXT-X-PLAYLIST-TYPE:${ended ? 'VOD' : 'EVENT'}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-MAP:URI="init.mp4"'];
    for (let seq = startSeq; seq < last; seq++) lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(epoch + seq * 4000).toISOString()}`, '#EXTINF:4.000,', `segment-${seq}.m4s`);
    if (ended) lines.push('#EXT-X-ENDLIST');
    return new Response(lines.join('\n') + '\n', { headers });
  }
  const segment = /^(v360|v540|v720)\/segment-(-?\d+)\.m4s$/.exec(rest);
  if (segment) {
    const seq = Number(segment[2]);
    if (!Number.isSafeInteger(seq) || seq < startSeq || seq >= Math.min(edgeSequence(), endSeq ?? Infinity)) return new Response('Not in the archive', { status: 404 });
    const bytes = await segmentBytes(segment[1]!, seq, startSeq * 4);
    return new Response(req.method === 'HEAD' ? null : bytes.buffer as ArrayBuffer, { headers: { 'Content-Type': 'video/iso.segment', 'Cache-Control': 'no-store', 'Content-Length': String(bytes.length) } });
  }
  return serveMedia(req, rest);
}

export async function serveLive(req: Request, resource: string): Promise<Response> {
  const archive = /^archive\/(-?\d+)\/(-?\d+|open)\/(.+)$/.exec(resource);
  if (archive) return serveArchive(req, Number(archive[1]), archive[2] === 'open' ? null : Number(archive[2]), archive[3]!);
  if (resource === 'master.m3u8') {
    const text = await Bun.file(join(mediaRoot, resource)).text();
    // The generated video ladder already contains English audio. Avoid a second
    // independent audio timeline in the small mock live fixture.
    return new Response(text.split('\n').filter(l => !l.startsWith('#EXT-X-MEDIA:')).map(l => l.replace(',AUDIO="audio"', '')).join('\n'), { headers });
  }
  const playlist = /^(v360|v540|v720)\/index\.m3u8$/.exec(resource);
  if (playlist) {
    const edge = edgeSequence(), first = Math.max(0, edge - windowSegments());
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
    const bytes = await segmentBytes(segment[1]!, seq, -liveFaults.mediaLeadSeconds);
    return new Response(req.method === 'HEAD' ? null : bytes.buffer as ArrayBuffer, { headers: { 'Content-Type': 'video/iso.segment', 'Cache-Control': 'no-store', 'Content-Length': String(bytes.length) } });
  }
  return serveMedia(req, resource);
}

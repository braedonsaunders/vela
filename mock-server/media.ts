import { serveAudioFixture } from './audio-fixtures';
import type { OriginalVideo, Track } from '../packages/protocol/types';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const fixtureDurationSeconds = 180;
export const mediaRoot = join(homedir(), '.scratch/tmp/vela/media');
/** Format-matrix fixtures (scripts/make-format-matrix.ts), served one at a time as sessions' original file. */
export const formatsRoot = process.env.VELA_MOCK_FORMATS_ROOT ?? join(homedir(), '.scratch/tmp/vela/formats');
export const originalFixture: { name: string | null; durationSeconds: number; video?: OriginalVideo; audio?: Track[] } = { name: null, durationSeconds: 30 };

/** What Ether's ffprobe reports for an original: the plan's originalVideo and the audio inventory. */
export async function probeOriginalFixture(name: string): Promise<Pick<typeof originalFixture, 'durationSeconds' | 'video' | 'audio'>> {
  const probe = Bun.spawn(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(formatsRoot, name)], { stdout: 'pipe', stderr: 'ignore' });
  const data = await new Response(probe.stdout).json() as { format: { duration?: string }; streams: Record<string, any>[] };
  if (await probe.exited) throw new Error('ffprobe failed');
  const v = data.streams.find((stream) => stream.codec_type === 'video');
  const dovi = v?.side_data_list?.find((side: { side_data_type?: string }) => side.side_data_type === 'DOVI configuration record');
  const [num, den] = String(v?.r_frame_rate ?? '0/1').split('/').map(Number);
  const video: OriginalVideo | undefined = v && {
    codec: v.codec_name, width: v.width, height: v.height, profile: v.profile, level: v.level,
    bitDepth: Number(v.bits_per_raw_sample) || (String(v.pix_fmt).includes('10') ? 10 : 8),
    ...(num && den ? { frameRate: num / den } : {}),
    colorPrimaries: v.color_primaries, colorTransfer: v.color_transfer, colorSpace: v.color_space, colorRange: v.color_range,
    isInterlaced: v.field_order ? v.field_order !== 'progressive' : undefined,
    ...(dovi ? { dvProfile: dovi.dv_profile, dvLevel: dovi.dv_level, dvBlSignalCompatibilityId: dovi.dv_bl_signal_compatibility_id,
      rpuPresent: dovi.rpu_present_flag === 1, elPresent: dovi.el_present_flag === 1, blPresent: dovi.bl_present_flag === 1 } : {}),
  };
  const audio = data.streams.filter((stream) => stream.codec_type === 'audio').map((stream, n) => ({
    id: `original-audio-${n}`, kind: 'audio' as const, streamIndex: stream.index, language: stream.tags?.language ?? 'und',
    name: `${String(stream.codec_name).toUpperCase()} ${stream.channel_layout ?? `${stream.channels} ch`}`, codec: stream.codec_name, channels: stream.channels, default: n === 0 }));
  return { durationSeconds: Number(data.format.duration) || 30, video, audio };
}
const originalTypes: Record<string, string> = { mkv: 'video/x-matroska', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime' };
export const originalFixtureName = /^[\w.()-]+\.(mkv|webm|mp4|mov)$/;
export interface Faults { rangeFailSeconds: number; bandwidthBps: number; failEvery: number; truncateEvery: number; stallMs: number; fallbackUnavailable: boolean; capacityExhausted: boolean }
export const faults: Faults = { rangeFailSeconds: 0, bandwidthBps: 0, failEvery: 0, truncateEvery: 0, stallMs: 0, fallbackUnavailable: false, capacityExhausted: false };
let segmentCount = 0;
let rangeFailureUntil = 0;
let rangeFailureSetting = 0;
export async function serveMedia(req: Request, resource: string): Promise<Response> {
  if (faults.rangeFailSeconds !== rangeFailureSetting) {
    rangeFailureSetting = faults.rangeFailSeconds;
    rangeFailureUntil = Date.now() + rangeFailureSetting * 1000;
  }
  if (req.headers.has('range') && rangeFailureSetting > 0 && Date.now() < rangeFailureUntil)
    return new Response('Injected temporary range failure', { status: 503 });
  if (resource.startsWith('audio/')) return serveAudioFixture(req, resource.slice(6));
  const original = /^original\/(.+)$/.exec(resource)?.[1];
  if (original !== undefined && !originalFixtureName.test(original)) return new Response('Not found', { status: 404 });
  if (original === undefined && !/^(master\.m3u8|mse-master\.m3u8|ts-master\.m3u8|direct\.mp4|universal-avc\.mp4|subtitles\.vtt|(?:v(?:360|540|720)|video(?:360|540|720)|a_(?:en|es))\/(?:index\.m3u8|init\.mp4|seg-\d+\.m4s)|ts(?:360|540|720)\/(?:index\.m3u8|seg-\d+\.ts))$/.test(resource)) return new Response('Not found', { status: 404 });
  const file = Bun.file(original ? join(formatsRoot, original) : join(mediaRoot, resource));
  if (original && !await file.exists()) return new Response('Not found', { status: 404 });
  if (!await file.exists()) return Response.json({ error: 'media_not_generated', message: 'Run bun mock-server/scripts/make-media.ts' }, { status: 503 });
  const f = { ...faults };
  for (const key of ['bandwidthBps', 'failEvery', 'truncateEvery', 'stallMs'] as const) {
    const q = new URL(req.url).searchParams.get(key);
    if (q !== null && Number.isFinite(Number(q))) f[key] = Math.max(0, Math.min(60_000_000, Number(q)));
  }
  const segment = resource.endsWith('.m4s') || resource.endsWith('.ts'), count = segment ? ++segmentCount : 0;
  if (segment && f.failEvery > 0 && count % f.failEvery === 0) return new Response('Injected source failure', { status: 502 });
  const audio = resource.startsWith('a_');
  const headers = new Headers({ 'Content-Type': original ? originalTypes[original.slice(original.lastIndexOf('.') + 1)]! : resource.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : resource.endsWith('.vtt') ? 'text/vtt' : resource.endsWith('.ts') ? 'video/mp2t' : resource.endsWith('.m4s') ? (audio ? 'audio/iso.segment' : 'video/iso.segment') : (audio ? 'audio/mp4' : 'video/mp4'), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
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

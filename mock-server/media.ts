import { serveAudioFixture } from './audio-fixtures';
import type { OriginalVideo, Track } from '../packages/protocol/types';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const fixtureDurationSeconds = 180;
/** VELA_MOCK_MEDIA_ROOT moves the generated fixture (when the scratch drive is away). */
export const mediaRoot = process.env.VELA_MOCK_MEDIA_ROOT ?? join(homedir(), '.scratch/tmp/vela/media');
/** Format-matrix fixtures (scripts/make-format-matrix.ts), served one at a time as sessions' original file. */
export const formatsRoot = process.env.VELA_MOCK_FORMATS_ROOT ?? join(homedir(), '.scratch/tmp/vela/formats');
export const originalFixture: { name: string | null; durationSeconds: number; video?: OriginalVideo; audio?: Track[]; subtitles?: Track[]; selectSubtitle?: boolean } = { name: null, durationSeconds: 30 };

/** What Ether's ffprobe reports for an original: the plan's originalVideo and the audio inventory. */
export async function probeOriginalFixture(name: string): Promise<Pick<typeof originalFixture, 'durationSeconds' | 'video' | 'audio' | 'subtitles'>> {
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
  const subtitles = data.streams.filter((stream) => stream.codec_type === 'subtitle').map((stream, n) => ({
    id: `original-subtitle-${n}`, kind: 'subtitle' as const, streamIndex: stream.index, language: stream.tags?.language ?? 'und',
    name: String(stream.codec_name), codec: stream.codec_name, forced: stream.disposition?.forced === 1, delivery: { kind: 'embedded' as const } }));
  return { durationSeconds: Number(data.format.duration) || 30, video, audio, subtitles };
}
const originalTypes: Record<string, string> = { mkv: 'video/x-matroska', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime' };
export const originalFixtureName = /^[\w.()-]+\.(mkv|webm|mp4|mov)$/;
export interface Faults {
  rangeFailSeconds: number; bandwidthBps: number; failEvery: number; truncateEvery: number; stallMs: number; fallbackUnavailable: boolean; capacityExhausted: boolean;
  /** Buffering observations at the same generations before the fixture completes an adaptive handoff. Zero disables it. */
  serverHandoffObservations: number;
  originalLost409: number;
  originalLostTruncate: number;
  downloadTruncate: number;
  originalLostVersionUnavailable: boolean;
  /** Session refresh (POST /auth/refresh) fails for this many seconds from when it is set (main.ts). */
  refreshFailSeconds: number;
  /** 500 answers like a server whose database is busy (no retry offered); 503 offers a retry after 2 s. */
  refreshFailStatus: number;
  /** Delay before any refresh answer, to stand in for a server that does not answer. */
  refreshStallMs: number;
  /**
   * The next refresh key stores its replay entry, stalls this long, then answers 409
   * `mutation_outcome_unknown`; that key answers the same 409 at once from then on (main.ts).
   */
  refreshAbandonMs: number;
  /**
   * The next this many audio (track, audiobook, part) and video (film, episode) playback starts are
   * answered 503 `preparation_pending` (retry allowed after a second), as Ether answers a start it is
   * still preparing; each refusal counts one down, so the retry plays (main.ts). Queued (gapless) starts
   * are not refused.
   */
  audioStartPending: number;
  videoStartPending: number;
  /**
   * The next this many video playback starts are answered 503 `preparing` (class `source`, retry
   * after a second, forty attempts) with a download-queue position counting down, as Ether answers a
   * title whose source it is still finding or downloading (W464); each refusal counts one down.
   */
  videoStartPreparing: number;
  /** The next this many bootstrap reads return row ids from the preceding feed snapshot. */
  bootstrapStaleReads: number;
  /**
   * The next this many playback starts are answered with the viewer's most recently stopped session,
   * its state shown as `ready`, as Ether rc.15's broker reused a stopped session (main.ts).
   */
  catchUpFixture: boolean; startStoppedSession: number;
}
export const faults: Faults = { rangeFailSeconds: 0, bandwidthBps: 0, failEvery: 0, truncateEvery: 0, stallMs: 0, fallbackUnavailable: false, capacityExhausted: false, serverHandoffObservations: 0, originalLost409: 0, originalLostTruncate: 0, downloadTruncate: 0, originalLostVersionUnavailable: false, refreshFailSeconds: 0, refreshFailStatus: 500, refreshStallMs: 0, refreshAbandonMs: 0, audioStartPending: 0, videoStartPending: 0, videoStartPreparing: 0, bootstrapStaleReads: 0, catchUpFixture: false, startStoppedSession: 0 };
let segmentCount = 0;
let rangeFailureUntil = 0;
let rangeFailureSetting = 0;
export async function serveMedia(req: Request, resource: string, truncateOriginal = false, etag?: string): Promise<Response> {
  if (faults.rangeFailSeconds !== rangeFailureSetting) {
    rangeFailureSetting = faults.rangeFailSeconds;
    rangeFailureUntil = Date.now() + rangeFailureSetting * 1000;
  }
  if (req.headers.has('range') && rangeFailureSetting > 0 && Date.now() < rangeFailureUntil)
    return new Response('Injected temporary range failure', { status: 503 });
  if (resource === 'subtitles/window.vtt') {
    const query = new URL(req.url).searchParams;
    const cursor = query.get('from_ms') ?? '';
    const from = Number(cursor);
    if (query.get('ether_window') !== '1' || !/^\d+$/.test(cursor) || !Number.isSafeInteger(from))
      return new Response('Invalid subtitle window', { status: 400 });
    const cues = [
      { start: 62_000, end: 65_000, vtt: '00:01:02.000 --> 00:01:05.000\nVela offset HLS subtitle.' },
      { start: 89_000, end: 96_000, vtt: '00:01:29.000 --> 00:01:36.000\nVela subtitle across a seek.' },
      { start: 194_000, end: 198_000, vtt: '00:03:14.000 --> 00:03:18.000\nVela subtitle in a later window.' },
    ];
    const selected = cues.filter(cue => cue.end > from && cue.start < from + 120_000);
    const body = `WEBVTT\n\n${selected.map(cue => cue.vtt).join('\n\n')}\n`;
    return new Response(req.method === 'HEAD' ? null : body, { headers: {
      'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Ether-Subtitle-Complete': from + 120_000 >= 198_000 ? '1' : '0',
    } });
  }
  if (resource === 'version-subtitles.vtt') {
    return new Response(req.method === 'HEAD' ? null : 'WEBVTT\n\n00:00:00.000 --> 00:03:00.000\nVela cached edition subtitle.\n', {
      headers: { 'Content-Type': 'text/vtt', 'Cache-Control': 'no-store' },
    });
  }
  if (resource.startsWith('audio/')) return serveAudioFixture(req, resource.slice(6));
  // One rung of the master as a playlist of its own (a fixed-rung path beside the adaptive one): its video and audio.
  const rung = /^fixed-(360|540|720)\.m3u8$/.exec(resource)?.[1];
  if (rung) {
    const master = Bun.file(join(mediaRoot, 'master.m3u8'));
    if (!await master.exists()) return Response.json({ error: 'media_not_generated', message: 'Run bun mock-server/scripts/make-media.ts' }, { status: 503 });
    const lines = (await master.text()).split('\n');
    const kept = lines.filter((line, i) => !line.startsWith('#EXT-X-STREAM-INF') && !/^v\d+\//.test(line) ? true
      : line.startsWith('#EXT-X-STREAM-INF') ? lines[i + 1] === `v${rung}/index.m3u8` : line === `v${rung}/index.m3u8`);
    return new Response(req.method === 'HEAD' ? null : kept.join('\n'), { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' } });
  }
  const original = /^original\/(.+)$/.exec(resource)?.[1];
  if (original !== undefined && !originalFixtureName.test(original)) return new Response('Not found', { status: 404 });
  if (original === undefined && !/^(master\.m3u8|mse-master\.m3u8|ts-master\.m3u8|direct\.mp4|download\.mp4|universal-avc\.mp4|subtitles\.vtt|(?:v(?:360|540|720)|video(?:360|540|720)|a_(?:en|es))\/(?:index\.m3u8|init\.mp4|seg-\d+\.m4s)|ts(?:360|540|720)\/(?:index\.m3u8|seg-\d+\.ts))$/.test(resource)) return new Response('Not found', { status: 404 });
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
  if (etag) headers.set('ETag', etag);
  const ifRange = req.headers.get('if-range');
  const ignoreRange = !!(etag && ifRange && ifRange !== etag);
  const range = ignoreRange ? null : req.headers.get('range');
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
  const truncate = truncateOriginal || (segment && f.truncateEvery > 0 && count % f.truncateEvery === 0);
  // Bun automatically applies Range to a file-backed response. Use the chunk reader below
  // when If-Range rejected the client's validator and the full original must be sent.
  if (!ignoreRange && !f.bandwidthBps && !f.stallMs && !truncate) return new Response(file.slice(start, end + 1), { status, headers });
  const stop = truncate ? start + Math.floor(length / 2) : end + 1;
  let pos = start, first = true, cancelled = false;
  const wait = (ms: number) => new Promise<void>(resolve => { const timer = setTimeout(done, ms); function done() { clearTimeout(timer); req.signal.removeEventListener('abort', done); resolve(); } req.signal.addEventListener('abort', done, { once: true }); if (req.signal.aborted) done(); });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (first) { first = false; if (f.stallMs) await wait(Math.min(f.stallMs, 60000)); }
      if (cancelled || req.signal.aborted) { if (!cancelled) controller.close(); return; }
      if (pos >= stop) {
        if (truncateOriginal) controller.close();
        else if (truncate) controller.error(new Error('Injected truncated segment'));
        else controller.close();
        return;
      }
      const size = f.bandwidthBps ? Math.max(1, Math.min(16384, Math.floor(f.bandwidthBps / 8 / 10))) : 16384;
      const next = Math.min(stop, pos + size), bytes = new Uint8Array(await file.slice(pos, next).arrayBuffer());
      if (f.bandwidthBps) await wait(bytes.length * 8000 / f.bandwidthBps);
      if (cancelled) return;
      pos = next; controller.enqueue(bytes);
    }, cancel() { cancelled = true; },
  });
  return new Response(body, { status, headers });
}

import type { PlaybackPlan, PlaybackRequest, PlayerObservation, SessionCommand, SessionEvent, SessionSnapshot } from '../protocol/v0/types';
import { faults, mediaRoot, fixtureDurationSeconds } from './media';
import { liveWindow } from './live';
import { mseFixture } from './mse';
interface PendingCodecs { neverVerify: boolean; values: Map<string, { videoCodec: string; audioCodec?: string }>; timers: Map<string, ReturnType<typeof setTimeout>> }
export interface Session { owner: string; mediaToken: string; plan: PlaybackPlan; history: SessionEvent[]; listeners: Map<ReadableStreamDefaultController<Uint8Array>, () => void>; sequence: number; expires: number; pendingCodecs?: PendingCodecs }
export const sessions = new Map<string, Session>();
export function snapshot(s: Session): SessionSnapshot {
  return { cursor: String(s.plan.revision), revision: s.plan.revision, plan: s.plan, publishedRanges: s.plan.live ? [{ startSeconds: liveWindow().windowStartSeconds, endSeconds: liveWindow().liveEdgeSeconds }] : s.plan.paths.length ? [{ startSeconds: 0, endSeconds: fixtureDurationSeconds }] : [], lastObservationSequence: s.sequence };
}
const encode = (event: SessionEvent) => new TextEncoder().encode(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
export function publish(s: Session) {
  s.plan.revision++;
  const base = { cursor: String(s.plan.revision), revision: s.plan.revision, sessionId: s.plan.sessionId };
  const event: SessionEvent = s.plan.state === 'ended' ? { ...base, type: 'ended', reason: 'stopped' } : { ...base, type: 'plan', plan: structuredClone(s.plan) };
  s.history.push(event); if (s.history.length > 128) s.history.shift();
  for (const [c, close] of s.listeners) { c.enqueue(encode(event)); if (event.type === 'ended') close(); }
  if (event.type === 'ended') {
    s.listeners.clear();
    for (const timer of s.pendingCodecs?.timers.values() ?? []) clearTimeout(timer);
    s.pendingCodecs?.timers.clear();
  }
}
export async function createSession(owner: string, request: PlaybackRequest, pending?: { neverVerify: boolean; pathId: string }): Promise<Session> {
  const id = crypto.randomUUID(), token = crypto.randomUUID(), base = `/sessions/media/${id}/${token}`;
  const available = await Bun.file(`${mediaRoot}/master.m3u8`).exists();
  const tracks = ['en', 'es'].map((language, n) => ({ id: `audio-${language}`, kind: 'audio' as const, language, name: n ? 'Spanish · test tone' : 'English · test tone', codec: 'aac', channels: 2, default: n === 0 }));
  const plan: PlaybackPlan = { sessionId: id, revision: 1, sourceGeneration: 1, seekGeneration: 1,
    titleId: request.titleId, channelId: request.channelId, extraId: request.extraId, state: 'ready', positionSeconds: request.positionSeconds ?? 0, durationSeconds: fixtureDurationSeconds,
    paths: available ? [
      { id: 'direct', kind: 'direct', transport: 'file', url: `${base}/direct.mp4`, mimeType: 'video/mp4', sourceId: 'synthetic-original', timelineId: `synthetic-${fixtureDurationSeconds}`, readiness: 'ready', qualities: [], boundaries: [] },
      { id: 'remux', kind: 'remux', transport: 'hls', url: `${base}/v720/index.m3u8`, mimeType: 'application/vnd.apple.mpegurl', sourceId: 'synthetic-original', timelineId: `synthetic-${fixtureDurationSeconds}`, readiness: 'ready', qualities: [{ id: '720p', width: 1280, height: 720, bitrate: 2200000, videoCodec: 'avc1.64001f', audioCodec: 'mp4a.40.2', url: `${base}/v720/index.m3u8` }], boundaries: [] },
      ...(request.allowTranscode === false || faults.fallbackUnavailable ? [] : [{ id: 'transcode', kind: 'transcode' as const, transport: 'hls' as const, url: `${base}/master.m3u8`, mimeType: 'application/vnd.apple.mpegurl', sourceId: 'synthetic-original', timelineId: `synthetic-${fixtureDurationSeconds}`, readiness: 'ready' as const,
        qualities: [[360, 640, 500000], [540, 960, 1100000], [720, 1280, 2200000]].map(([height, width, bitrate]) => ({ id: `${height}p`, width, height, bitrate, videoCodec: 'avc1.64001f', audioCodec: 'mp4a.40.2', url: `${base}/v${height}/index.m3u8` })),
        boundaries: Array.from({ length: fixtureDurationSeconds / 4 }, (_, n) => ({ atSeconds: n * 4, independent: true, timelineId: `synthetic-${fixtureDurationSeconds}`, compatibility: 'same-source' as const, audioTrackIds: ['audio-en'], subtitleTrackIds: ['sub-en'] })) }]),
    ] : [], selectedPathId: 'direct', audioTracks: tracks, subtitleTracks: [{ id: 'sub-en', kind: 'subtitle', language: 'en', name: 'English', codec: 'webvtt', url: `${base}/subtitles.vtt` }],
    selectedAudioTrackId: request.audioTrackId ?? 'audio-en', selectedSubtitleTrackId: request.subtitleTrackId ?? null, chapters: [0,60,120].map((startSeconds, i) => ({ id: `chapter-${i + 1}`, name: ['Signal', 'Crossing', 'Homeward'][i], startSeconds, endSeconds: startSeconds + 60 })),
    fallback: { state: faults.fallbackUnavailable ? 'unavailable' : 'unsupported', reason: 'Mock serves pre-generated alternatives; no proactive encoder scheduler.' },
  };
  if (!request.channelId && available && request.client.mse && request.allowTranscode !== false && !faults.fallbackUnavailable) {
    const mse = await mseFixture(base);
    if (mse) plan.paths.push({ id: 'transcode-mse', kind: 'transcode', transport: 'hls', mimeType: 'application/vnd.apple.mpegurl',
      sourceId: 'synthetic-original', timelineId: `synthetic-${fixtureDurationSeconds}`, readiness: 'ready', ...mse,
      boundaries: Array.from({ length: fixtureDurationSeconds / 4 }, (_, n) => ({ atSeconds: n * 4, independent: true,
        timelineId: `synthetic-${fixtureDurationSeconds}`, compatibility: 'same-source', audioTrackIds: ['audio-en', 'audio-es'], subtitleTrackIds: ['sub-en'] })) });
  }
  if (request.channelId) {
    plan.durationSeconds = undefined;
    plan.live = { ...liveWindow(), mode: request.liveMode ?? 'adaptive' };
    plan.positionSeconds = 0;
    plan.paths = [{ id: 'live', kind: 'remux', transport: 'hls', url: `${base}/live/master.m3u8`, mimeType: 'application/vnd.apple.mpegurl', sourceId: 'synthetic-live', timelineId: 'synthetic-live', readiness: 'ready', boundaries: [],
      qualities: [[360, 640, 700000], [540, 960, 1400000], [720, 1280, 2600000]].map(([height, width, bitrate]) => ({ id: `${height}p`, width, height, bitrate, videoCodec: 'avc1.64001f', audioCodec: 'mp4a.40.2', url: `${base}/live/v${height}/index.m3u8` })) }];
    plan.selectedPathId = 'live';
    plan.audioTracks = [tracks[0]]; plan.selectedAudioTrackId = tracks[0].id;
    plan.subtitleTracks = []; plan.selectedSubtitleTrackId = null; plan.chapters = [];
  }
  const s: Session = { owner, mediaToken: token, plan, history: [], listeners: new Map(), sequence: 0, expires: Date.now() + 86400000 };
  if (pending) {
    s.pendingCodecs = { neverVerify: pending.neverVerify, values: new Map(), timers: new Map() };
    for (const p of plan.paths.filter(p => p.kind === 'transcode')) for (const q of p.qualities) {
      s.pendingCodecs.values.set(`${p.id}:${q.id}`, { videoCodec: q.videoCodec, ...(q.audioCodec ? { audioCodec: q.audioCodec } : {}) });
      q.videoCodec = ''; delete q.audioCodec; q.codecStatus = 'pending';
    }
    plan.selectedPathId = pending.pathId;
  }
  sessions.set(id, s); return s;
}
export function requestedInit(s: Session, resource: string, authorized: () => boolean) {
  const pending = s.pendingCodecs;
  if (!pending || pending.neverVerify) return;
  for (const path of s.plan.paths.filter(p => p.kind === 'transcode')) for (const quality of path.qualities) {
    const prefix = `/sessions/media/${s.plan.sessionId}/${s.mediaToken}/`;
    const init = quality.url.startsWith(prefix) ? quality.url.slice(prefix.length).replace(/index\.m3u8$/, 'init.mp4') : undefined;
    const key = `${path.id}:${quality.id}`;
    if (resource !== init || quality.codecStatus !== 'pending' || pending.timers.has(key)) continue;
    const source = s.plan.sourceGeneration, seek = s.plan.seekGeneration;
    const timer = setTimeout(() => {
      pending.timers.delete(key);
      if (!authorized() || s.expires <= Date.now() || s.plan.state === 'ended' || source !== s.plan.sourceGeneration || seek !== s.plan.seekGeneration) return;
      const codecs = pending.values.get(key);
      if (!codecs) return;
      Object.assign(quality, codecs, { codecStatus: 'verified' });
      pending.values.delete(key);
      publish(s);
    }, 250);
    pending.timers.set(key, timer);
  }
}
export function applyCommand(s: Session, cmd: SessionCommand) {
  switch (cmd.kind) {
    case 'seek': s.plan.seekGeneration++; s.plan.positionSeconds = cmd.positionSeconds; break;
    case 'pause': s.plan.state = 'paused'; break;
    case 'resume': s.plan.state = 'playing'; break;
    case 'stop': s.plan.state = 'ended'; break;
    case 'tracks': if (cmd.audioTrackId !== undefined) s.plan.selectedAudioTrackId = cmd.audioTrackId; if (cmd.subtitleTrackId !== undefined) s.plan.selectedSubtitleTrackId = cmd.subtitleTrackId; break;
    case 'switch': s.plan.selectedPathId = cmd.pathId; s.plan.sourceGeneration++; s.plan.positionSeconds = cmd.atSeconds; break;
  }
  publish(s);
}
export function observe(s: Session, o: PlayerObservation) {
  if (o.sequence <= s.sequence) return;
  s.sequence = o.sequence; s.plan.positionSeconds = o.positionSeconds;
  if (o.audioTrackId !== undefined && s.plan.audioTracks.some(t => t.id === o.audioTrackId)) s.plan.selectedAudioTrackId = o.audioTrackId;
  if (o.subtitleTrackId === null || s.plan.subtitleTracks.some(t => t.id === o.subtitleTrackId)) s.plan.selectedSubtitleTrackId = o.subtitleTrackId ?? null;
  s.plan.state = o.state === 'buffering' ? 'recovering' : o.state;
  publish(s);
}
export function events(s: Session, req: Request, authorized: () => boolean): Response {
  for (const close of s.listeners.values()) close(); s.listeners.clear();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  function cleanup() { if (heartbeat) clearInterval(heartbeat); if (controller) s.listeners.delete(controller); req.signal.removeEventListener('abort', abort); }
  function abort() { cleanup(); try { controller?.close(); } catch {} }
  const stream = new ReadableStream<Uint8Array>({ start(c) {
    controller = c;
    const cursor = req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('cursor');
    const number = Number(cursor), oldest = Number(s.history[0]?.cursor ?? s.plan.revision);
    if (cursor && Number.isInteger(number) && number >= oldest - 1 && number <= s.plan.revision) {
      for (const event of s.history) if (Number(event.cursor) > number) c.enqueue(encode(event));
    } else c.enqueue(encode({ type: 'snapshot', cursor: String(s.plan.revision), revision: s.plan.revision, sessionId: s.plan.sessionId, snapshot: snapshot(s) }));
    if (s.plan.state === 'ended') { c.close(); return; }
    s.listeners.set(c, abort); heartbeat = setInterval(() => { if (!authorized()) { abort(); return; } c.enqueue(new TextEncoder().encode(': keepalive\n\n')); }, 15000);
    req.signal.addEventListener('abort', abort, { once: true }); if (req.signal.aborted) abort();
  }, cancel: cleanup });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

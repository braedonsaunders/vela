import type { PlaybackPlan, PlaybackRequest, PlayerObservation, SessionCommand, SessionEvent, SessionSnapshot } from '../protocol/v0/types';
import { faults, mediaRoot } from './media';
export interface Session { owner: string; mediaToken: string; plan: PlaybackPlan; history: SessionEvent[]; listeners: Map<ReadableStreamDefaultController<Uint8Array>, () => void>; sequence: number; expires: number }
export const sessions = new Map<string, Session>();
export function snapshot(s: Session): SessionSnapshot {
  return { cursor: String(s.plan.revision), revision: s.plan.revision, plan: s.plan, publishedRanges: s.plan.paths.length ? [{ startSeconds: 0, endSeconds: 60 }] : [], lastObservationSequence: s.sequence };
}
const encode = (event: SessionEvent) => new TextEncoder().encode(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
export function publish(s: Session) {
  s.plan.revision++;
  const base = { cursor: String(s.plan.revision), revision: s.plan.revision, sessionId: s.plan.sessionId };
  const event: SessionEvent = s.plan.state === 'ended' ? { ...base, type: 'ended', reason: 'stopped' } : { ...base, type: 'plan', plan: structuredClone(s.plan) };
  s.history.push(event); if (s.history.length > 128) s.history.shift();
  for (const [c, close] of s.listeners) { c.enqueue(encode(event)); if (event.type === 'ended') close(); }
  if (event.type === 'ended') s.listeners.clear();
}
export async function createSession(owner: string, request: PlaybackRequest): Promise<Session> {
  const id = crypto.randomUUID(), token = crypto.randomUUID(), base = `/sessions/media/${id}/${token}`;
  const available = await Bun.file(`${mediaRoot}/master.m3u8`).exists();
  const tracks = ['en', 'es'].map((language, n) => ({ id: `audio-${language}`, kind: 'audio' as const, language, name: n ? 'Spanish · test tone' : 'English · test tone', codec: 'aac', channels: 2, default: n === 0 }));
  const plan: PlaybackPlan = { sessionId: id, revision: 1, sourceGeneration: 1, seekGeneration: 1,
    titleId: request.titleId, channelId: request.channelId, extraId: request.extraId, state: 'ready', positionSeconds: request.positionSeconds ?? 0, durationSeconds: 60,
    paths: available ? [
      { id: 'direct', kind: 'direct', transport: 'file', url: `${base}/direct.mp4`, mimeType: 'video/mp4', sourceId: 'synthetic-original', timelineId: 'synthetic-60', readiness: 'ready', qualities: [], boundaries: [] },
      { id: 'remux', kind: 'remux', transport: 'hls', url: `${base}/v720/index.m3u8`, mimeType: 'application/vnd.apple.mpegurl', sourceId: 'synthetic-original', timelineId: 'synthetic-60', readiness: 'ready', qualities: [{ id: '720p', width: 1280, height: 720, bitrate: 2200000, videoCodec: 'avc1.64001f', audioCodec: 'mp4a.40.2', url: `${base}/v720/index.m3u8` }], boundaries: [] },
      ...(request.allowTranscode === false || faults.fallbackUnavailable ? [] : [{ id: 'transcode', kind: 'transcode' as const, transport: 'hls' as const, url: `${base}/master.m3u8`, mimeType: 'application/vnd.apple.mpegurl', sourceId: 'synthetic-original', timelineId: 'synthetic-60', readiness: 'ready' as const,
        qualities: [[360, 640, 500000], [540, 960, 1100000], [720, 1280, 2200000]].map(([height, width, bitrate]) => ({ id: `${height}p`, width, height, bitrate, videoCodec: 'avc1.64001f', audioCodec: 'mp4a.40.2', url: `${base}/v${height}/index.m3u8` })),
        boundaries: Array.from({ length: 15 }, (_, n) => ({ atSeconds: n * 4, independent: true, timelineId: 'synthetic-60', compatibility: 'same-source' as const, audioTrackIds: tracks.map(t => t.id), subtitleTrackIds: ['sub-en'] })) }]),
    ] : [], selectedPathId: 'direct', audioTracks: tracks, subtitleTracks: [{ id: 'sub-en', kind: 'subtitle', language: 'en', name: 'English', codec: 'webvtt', url: `${base}/subtitles.vtt` }],
    selectedAudioTrackId: request.audioTrackId ?? 'audio-en', selectedSubtitleTrackId: request.subtitleTrackId ?? null, chapters: [0,20,40].map((startSeconds, i) => ({ id: `chapter-${i + 1}`, name: ['Signal', 'Crossing', 'Homeward'][i], startSeconds, endSeconds: startSeconds + 20 })),
    fallback: { state: faults.fallbackUnavailable ? 'unavailable' : 'unsupported', reason: 'Mock serves pre-generated alternatives; no proactive encoder scheduler.' },
  };
  const s: Session = { owner, mediaToken: token, plan, history: [], listeners: new Map(), sequence: 0, expires: Date.now() + 86400000 };
  sessions.set(id, s); return s;
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

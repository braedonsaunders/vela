import { homedir } from 'node:os';
import { join } from 'node:path';
/** Only synthetic files, reached after the ordinary session/media-token check. */
export async function serveAudioFixture(req: Request, resource: string): Promise<Response> {
  if (!/^(?:(?:truehd-bed-7\.1|truehd-5\.1|dts-5\.1|eac3-5\.1|ac3-5\.1|flac-7\.1|alac-5\.1|pcm-7\.1)\.mkv|(?:alac|aac)-stereo\.m4a|(?:vorbis|opus)-stereo\.ogg|mp2-stereo\.mka|wma-stereo\.asf|pcm-f64-stereo\.wav)$/.test(resource))
    return new Response('Not found', { status: 404 });
  const file = Bun.file(join(homedir(), '.scratch/tmp/vela/media-audio', resource));
  if (!await file.exists()) return Response.json({ error: 'audio_media_not_generated',
    message: 'Run bun mock-server/scripts/make-audio-media.ts' }, { status: 503 });
  const headers = new Headers({ 'Content-Type': resource.endsWith('.m4a') ? 'audio/mp4' : resource.endsWith('.ogg') ? 'audio/ogg' : resource.endsWith('.asf') ? 'audio/x-ms-wma' : resource.endsWith('.wav') ? 'audio/wav' : 'audio/x-matroska', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  let start = 0, end = file.size - 1, status = 200;
  const range = req.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
    start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
    headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`); status = 206;
  }
  headers.set('Content-Length', String(end - start + 1));
  return new Response(req.method === 'HEAD' ? null : file.slice(start, end + 1), { status, headers });
}

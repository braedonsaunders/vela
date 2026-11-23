// Scrub thumbnails (protocol "Scrub thumbnails (trickplay)") for the synthetic fixture: generated
// once by scripts/make-trickplay.ts, offered on every on-demand plan of the fixture once present,
// and served per session with the protocol's private, revalidated caching.
import type { TrickplayMetadata } from '../packages/protocol/types';
import { fixtureDurationSeconds, mediaRoot } from './media';

export const TRICKPLAY_WIDTH = 320;
export const trickplayDir = `${mediaRoot}/trickplay/${TRICKPLAY_WIDTH}`;
const INTERVAL_MS = 1000;

/** The fixture's offer: complete sheets, so coverage is the whole fixture. Null until generated. */
export async function trickplayOffer(): Promise<TrickplayMetadata | null> {
  if (!await Bun.file(`${trickplayDir}/0.jpg`).exists()) return null;
  const count = Math.ceil((fixtureDurationSeconds * 1000) / INTERVAL_MS);
  return { width: TRICKPLAY_WIDTH, height: 180, intervalMs: INTERVAL_MS, count, cols: 10, rows: 10, coverageUntilMs: count * INTERVAL_MS, revision: 1 };
}

/** GET /sessions/:id/trickplay/:width/:sheet.jpg for a session the caller owns (checked by the caller). */
export async function trickplaySheet(plan: { trickplay?: TrickplayMetadata; sourceGeneration: number; state: string }, width: string, sheet: string, req: Request): Promise<Response> {
  const offer = plan.trickplay;
  const index = /^\d+$/.test(sheet) ? Number(sheet) : -1;
  const sheets = offer ? Math.ceil(offer.count / (offer.cols * offer.rows)) : 0;
  const file = Bun.file(`${trickplayDir}/${index}.jpg`);
  if (!offer || plan.state === 'ended' || width !== String(offer.width) || index < 0 || index >= sheets || !await file.exists())
    return Response.json({ error: { class: 'not-found', code: 'trickplay_unavailable', message: 'No such trickplay sheet', retry: { allowed: false } } }, { status: 404 });
  const etag = `"trickplay-${plan.sourceGeneration}-${offer.revision}-${offer.width}-${index}"`;
  const headers = { 'Cache-Control': 'private, no-cache', ETag: etag, 'X-Ether-Trickplay-Fallback': 'false' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(file, { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
}

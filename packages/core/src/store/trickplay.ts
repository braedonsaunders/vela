// The playing session's scrub thumbnails: its sprite sheets read on demand, as the viewer scrubs,
// and held as image URIs for the renderer. A few sheets are kept (each covers a hundred
// thumbnails); a new session or source generation drops them all, and a sheet the server has
// republished (a new offer revision) or that has aged is read again with its ETag while the copy
// held stays on screen. A sheet the server lacks or a failed read is asked again only later.
import type * as V from '../wire';
import type { TrickplaySheet } from '../adapter/capabilities';
import { sheetURI, trickplayCell, type TrickplayFrame } from '../protocol/trickplay';

/** Sheets held at once (a sheet is about 3200 by 1800 pixels). */
const KEEP = 4;
/** A missing sheet or failed read is asked again after this long. */
const RETRY_MS = 15_000;
/** A held sheet is revalidated when used after this long: frames can arrive under one revision. */
const STALE_MS = 60_000;

/** Reads sheet `index` of the offer; `etag` revalidates the copy held. */
export type SheetRead = (index: number, etag: string | undefined, signal: AbortSignal) => Promise<TrickplaySheet | null>;

interface Sheet {
  /** The offer revision this sheet was (or is being) read for. */
  revision: number;
  uri: string | null;
  etag?: string;
  loading: boolean;
  /** When the last read finished, successfully or not; null before the first. */
  readAt: number | null;
  usedAt: number;
}

export class TrickplayCache {
  private owner = '';
  private sheets = new Map<number, Sheet>();
  private abort = new AbortController();
  private listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Called whenever a sheet arrives, so a renderer asks for its frame again. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The thumbnail for title time `seconds` of a session's offer, or null until its sheet is held
   * (the read starts here; subscribers hear when it lands) or where the offer has no frame.
   */
  frame(sessionId: string, sourceGeneration: number, offer: V.TrickplayMetadata, seconds: number, read: SheetRead): TrickplayFrame | null {
    const owner = `${sessionId}\n${sourceGeneration}\n${offer.width}x${offer.height}/${offer.cols}x${offer.rows}/${offer.intervalMs}`;
    if (owner !== this.owner) this.reset(owner);
    const cell = trickplayCell(offer, seconds);
    if (!cell) return null;
    const now = this.now();
    let sheet = this.sheets.get(cell.sheet);
    if (!sheet) {
      sheet = { revision: offer.revision, uri: null, loading: false, readAt: null, usedAt: now };
      this.sheets.set(cell.sheet, sheet);
    }
    sheet.usedAt = now;
    const age = sheet.readAt === null ? Number.POSITIVE_INFINITY : now - sheet.readAt;
    const due = sheet.revision !== offer.revision || age >= (sheet.uri ? STALE_MS : RETRY_MS);
    if (due && !sheet.loading) this.load(cell.sheet, sheet, offer.revision, read);
    if (!sheet.uri) return null;
    return { ...cell, uri: sheet.uri, columns: offer.cols, rows: offer.rows, width: offer.width, height: offer.height };
  }

  /** Forget every sheet and stop reads in flight (the session ended or changed). */
  clear(): void {
    this.reset('');
  }

  private reset(owner: string): void {
    this.abort.abort();
    this.abort = new AbortController();
    this.owner = owner;
    this.sheets.clear();
  }

  private load(index: number, sheet: Sheet, revision: number, read: SheetRead): void {
    const owner = this.owner;
    const { signal } = this.abort;
    sheet.loading = true;
    sheet.revision = revision;
    const settle = (change: () => void) => {
      if (this.owner !== owner || signal.aborted || this.sheets.get(index) !== sheet) return;
      sheet.loading = false;
      sheet.readAt = this.now();
      change();
      this.trim();
      for (const listener of [...this.listeners]) listener();
    };
    read(index, sheet.uri ? sheet.etag : undefined, signal).then(
      result => settle(() => {
        if (result === 'unchanged' || result === null) return;
        const uri = sheetURI(result.bytes, result.mimeType);
        if (!uri) return;
        sheet.uri = uri;
        if (result.etag) sheet.etag = result.etag;
        else delete sheet.etag;
      }),
      () => settle(() => undefined),
    );
  }

  /** Keep the most recently used sheets. */
  private trim(): void {
    if (this.sheets.size <= KEEP) return;
    const oldest = [...this.sheets.entries()].filter(([, sheet]) => !sheet.loading).sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [index] of oldest.slice(0, this.sheets.size - KEEP)) this.sheets.delete(index);
  }
}

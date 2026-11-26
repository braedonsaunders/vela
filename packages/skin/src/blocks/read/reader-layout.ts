// The reader's page geometry and its small decisions, free of the DOM so they are tested under Bun:
// where a book opens, how its pages are laid out at a window size, which part of a page a tap
// lands in, and what the position line says (never "NaN").
import { msg, number, percent } from '@vela/core';
import type { ReaderFlow, ReaderLocation } from './reader-engine';

// ── Where a book opens ───────────────────────────────────────────────────────

export interface SectionInfo { id?: string; linear?: string }
export interface Landmark { type?: string[] | string; href?: string }

const types = (landmark: Landmark): string[] => (Array.isArray(landmark.type) ? landmark.type : (landmark.type ?? '').split(/\s+/)).map(type => type.toLowerCase());
const bare = (href: string | undefined) => (href ?? '').split('#')[0]!.replace(/^\.?\//, '');
const COVER_FILE = /(^|\/)[^/]*cover[^/]*\.x?html?$/i;

/** The spine index of the book's cover page, when it has one: what a landmark (or an EPUB 2
 * guide) calls the cover, else a first page named like one. -1 when there is none. */
export function coverSection(sections: SectionInfo[], landmarks: Landmark[] | undefined): number {
  const cover = landmarks?.find(landmark => types(landmark).includes('cover'));
  if (cover?.href) {
    const index = sections.findIndex(section => bare(section.id) === bare(cover.href) || bare(section.id).endsWith(`/${bare(cover.href)}`));
    if (index >= 0) return index;
  }
  return sections.length > 1 && COVER_FILE.test(sections[0]?.id ?? '') ? 0 : -1;
}

/**
 * Where a book with no saved place opens: its title page when the book names one, else the first
 * page in reading order after the cover (the cover itself is the opening motion). A book whose
 * every page is the cover opens on it. Returns a landmark href or a spine index.
 */
export function startTarget(sections: SectionInfo[], landmarks: Landmark[] | undefined): string | number {
  const title = landmarks?.find(landmark => types(landmark).some(type => type === 'titlepage' || type === 'title-page'));
  if (title?.href) return title.href;
  const cover = coverSection(sections, landmarks);
  const first = sections.findIndex((section, index) => index !== cover && section.linear !== 'no');
  return first >= 0 ? first : 0;
}

// ── Page geometry ────────────────────────────────────────────────────────────

export interface ReaderLayout {
  /** Two pages side by side (a spread) or one. */
  columns: 1 | 2;
  /** foliate's gap: the gutter between pages and half of it at each side, as a share of the page area. */
  gap: string;
  /** The widest a page's text runs, px: a comfortable measure at the reader's text size. */
  maxInlineSize: number;
  /** The space above and below the text block, px. The bars sit in it, so text never runs under them. */
  top: number;
  bottom: number;
}

/** The comfortable measure at 100% text: about 66 characters of the reader's serif at 18–19 px. */
const MEASURE = 620;

/**
 * The page layout for a window: one page on phones, portrait and narrow windows; a two-page spread
 * where two comfortable pages fit side by side (wider at larger text). Side margins grow with the
 * window, and the measure grows with the text size so a line keeps its length in characters.
 */
export function readerLayout(width: number, height: number, fontSize = 100): ReaderLayout {
  const w = Number.isFinite(width) && width > 0 ? width : 1024;
  const h = Number.isFinite(height) && height > 0 ? height : 768;
  const scale = Math.min(2.2, Math.max(0.7, (Number.isFinite(fontSize) ? fontSize : 100) / 100));
  const small = w < 600;
  const maxInlineSize = Math.round(Math.min(900, Math.max(460, MEASURE * Math.sqrt(scale))));
  const columns: 1 | 2 = w >= Math.max(1000, maxInlineSize * 1.62) && w > h * 1.15 ? 2 : 1;
  // The gutter in px, then as the share of the text area foliate expects (gap / (area + gap)).
  const gutter = small ? 44 : w < 1000 ? 72 : 88;
  const area = Math.min(w, maxInlineSize * columns + gutter);
  const gap = `${(Math.round(gutter / (area + gutter) * 1000) / 10).toFixed(1)}%`;
  return { columns, gap, maxInlineSize, top: small ? 56 : 72, bottom: small ? 50 : 60 };
}

/** Reflowable pages are columns. Keep a heading with the start of the following block. */
export function readerHeadingRules(flow: ReaderFlow): string {
  return flow === 'paginated' ? `
    h1, h2, h3, h4, h5, h6, [role="heading"] {
      -webkit-column-break-after: avoid !important;
      break-after: avoid !important;
      break-inside: avoid !important;
    }
  ` : '';
}

// ── Taps ─────────────────────────────────────────────────────────────────────

export type TapZone = 'previous' | 'next' | 'toggle-chrome';

/** A tap's place across the page (0 left … 1 right): the outer quarters turn the page, in the book's
 * direction, the middle shows or hides the controls. Unknown places toggle, never turn. */
export function tapZone(share: number, rtl = false): TapZone {
  if (!Number.isFinite(share)) return 'toggle-chrome';
  if (share < 0.25) return rtl ? 'next' : 'previous';
  if (share > 0.75) return rtl ? 'previous' : 'next';
  return 'toggle-chrome';
}

/** A press is a tap (not a swipe, drag, long press or selection) when it barely moved and was quick. */
export function isTap(down: { x: number; y: number; t: number }, up: { x: number; y: number; t: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) < 12 && up.t - down.t < 600;
}

/** A quick, mostly sideways swipe turns the page: towards the start for a swipe to the right, in the
 * book's direction; anything else (slow, short or mostly vertical) is no turn. foliate turns
 * reflowable pages on a swipe itself; fixed-layout pages (comics, PDFs) rely on this. */
export function swipeTurn(down: { x: number; y: number; t: number }, up: { x: number; y: number; t: number }, rtl = false): 'next' | 'previous' | null {
  const dx = up.x - down.x, dy = up.y - down.y;
  if (!(Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && up.t - down.t < 800)) return null;
  return (dx < 0) !== rtl ? 'next' : 'previous';
}

// ── The position line ────────────────────────────────────────────────────────

/** A share of the book, 0..1, or null when it is not known yet (never NaN). */
export function safeFraction(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

const whole = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** What the reader's position line says: the share read and, where known, the page (fixed layout:
 * comics, PDFs) or the pages left in the chapter. Parts that are not known are left out; an empty
 * line means nothing is known yet. */
export function readerPosition(location: ReaderLocation | null | undefined): { percent: string; detail: string; line: string } {
  const fraction = safeFraction(location?.fraction);
  const share = fraction === null ? '' : percent(fraction);
  const page = whole(location?.page), pages = whole(location?.pages);
  const left = whole(location?.pagesLeft);
  const detail = page !== null && pages !== null && page >= 1 && pages >= page
    ? msg('media.reader.pageOf', { page: number(page), pages: number(pages) })
    : left !== null ? (left === 0 ? msg('media.reader.lastPage') : msg(`media.reader.pagesLeft.${left === 1 ? 'one' : 'other'}`, { count: number(left) }))
      : '';
  return { percent: share, detail, line: [detail, share].filter(Boolean).join(' · ') };
}

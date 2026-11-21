// The reader's page decisions (widgets/media/reader-layout.ts): where a book opens, its layout at a
// window size, tap zones and the position line.
import { expect, test } from 'bun:test';
import { coverSection, isTap, readerLayout, readerPosition, safeFraction, startTarget, tapZone } from '../src/widgets/media/reader-layout';

// The Way of Kings as calibre packs it: the cover page first, named only by the EPUB 2 guide.
const calibre = [{ id: 'titlepage.xhtml' }, { id: 'The_Way_of_Kings_split_000.html' }, { id: 'The_Way_of_Kings_split_001.html' }];
const guide = [{ type: ['toc'], href: 'The_Way_of_Kings_split_115.html#filepos2953384' }, { type: ['cover'], href: 'titlepage.xhtml' }];

test('a first open skips the cover page the landmarks name and lands on the first page after it', () => {
  expect(coverSection(calibre, guide)).toBe(0);
  expect(startTarget(calibre, guide)).toBe(1);
});

test('a title page the book names is where it opens; a cover is recognised by its file without landmarks', () => {
  expect(startTarget(calibre, [...guide, { type: 'titlepage', href: 'The_Way_of_Kings_split_003.html' }])).toBe('The_Way_of_Kings_split_003.html');
  const epub3 = [{ id: 'OEBPS/cover.xhtml' }, { id: 'OEBPS/title.xhtml' }, { id: 'OEBPS/ch1.xhtml' }];
  expect(startTarget(epub3, undefined)).toBe(1);
  // EPUB 3 landmarks resolve to full paths; fragments are ignored.
  expect(coverSection(epub3, [{ type: ['cover'], href: 'OEBPS/cover.xhtml#top' }])).toBe(0);
});

test('a book without a cover page opens at its first page in reading order; non-linear pages are skipped', () => {
  expect(startTarget([{ id: 'ch1.xhtml' }, { id: 'ch2.xhtml' }], [])).toBe(0);
  expect(startTarget([{ id: 'notes.xhtml', linear: 'no' }, { id: 'ch1.xhtml' }], undefined)).toBe(1);
  // A one-page book that is only a cover still opens.
  expect(startTarget([{ id: 'cover.xhtml' }], undefined)).toBe(0);
  expect(startTarget([], undefined)).toBe(0);
});

test('one page on phones, portrait and mid-size windows; a spread on wide landscape windows', () => {
  expect(readerLayout(390, 844).columns).toBe(1);
  expect(readerLayout(820, 1180).columns).toBe(1);
  expect(readerLayout(960, 700).columns).toBe(1);
  expect(readerLayout(1440, 900).columns).toBe(2);
  expect(readerLayout(1920, 1080).columns).toBe(2);
  // Large text keeps one page until two comfortable pages fit.
  expect(readerLayout(1280, 800, 200).columns).toBe(1);
});

test('the measure grows with the text size within bounds, and odd sizes never produce NaN', () => {
  const normal = readerLayout(1440, 900, 100);
  expect(normal.maxInlineSize).toBe(620);
  expect(readerLayout(1440, 900, 150).maxInlineSize).toBeGreaterThan(normal.maxInlineSize);
  expect(readerLayout(1440, 900, 70).maxInlineSize).toBeGreaterThanOrEqual(460);
  for (const layout of [readerLayout(NaN, 0), readerLayout(0, 0, NaN), readerLayout(-5, 10, Infinity)]) {
    expect(Number.isFinite(layout.maxInlineSize)).toBe(true);
    expect(layout.gap).toMatch(/^\d+(\.\d)?%$/);
  }
});

test('side margins: wider on desktop than on a phone, and the bars sit in the top and bottom margins', () => {
  const phone = readerLayout(390, 844), desktop = readerLayout(1440, 900);
  expect(parseFloat(phone.gap)).toBeGreaterThan(5);
  expect(phone.top).toBeGreaterThanOrEqual(52);
  expect(desktop.top).toBeGreaterThanOrEqual(60);
  expect(desktop.bottom).toBeGreaterThanOrEqual(52);
});

test('taps: outer quarters turn the page in the book\'s direction, the middle toggles the controls', () => {
  expect(tapZone(0.1)).toBe('previous');
  expect(tapZone(0.9)).toBe('next');
  expect(tapZone(0.5)).toBe('toggle-chrome');
  expect(tapZone(0.3)).toBe('toggle-chrome');
  expect(tapZone(0.1, true)).toBe('next');
  expect(tapZone(0.9, true)).toBe('previous');
  expect(tapZone(NaN)).toBe('toggle-chrome');
});

test('a tap barely moves and is quick; a swipe or long press is not a tap', () => {
  expect(isTap({ x: 10, y: 10, t: 0 }, { x: 14, y: 12, t: 120 })).toBe(true);
  expect(isTap({ x: 10, y: 10, t: 0 }, { x: 80, y: 12, t: 120 })).toBe(false);
  expect(isTap({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 900 })).toBe(false);
});

test('the position line never shows NaN: unknown parts are left out', () => {
  expect(safeFraction(NaN)).toBeNull();
  expect(safeFraction(undefined)).toBeNull();
  expect(safeFraction(1.4)).toBe(1);
  expect(readerPosition(null)).toEqual({ percent: '', detail: '', line: '' });
  const unknown = readerPosition({ locator: 'x', fraction: NaN, chapter: '', page: NaN, pages: undefined });
  expect(unknown.line).toBe('');
  expect(readerPosition({ locator: 'x', fraction: 0.4234, chapter: '' }).line).toBe('42%');
  expect(readerPosition({ locator: 'x', fraction: 0.5, chapter: '', page: 3, pages: 40 }).line).toBe('Page 3 of 40 · 50%');
  // A page past the total (a stale total) is not shown.
  expect(readerPosition({ locator: 'x', fraction: 0.5, chapter: '', page: 41, pages: 40 }).line).toBe('50%');
  expect(readerPosition({ locator: 'x', fraction: 0.1, chapter: '', pagesLeft: 4 }).line).toBe('4 pages left in chapter · 10%');
  expect(readerPosition({ locator: 'x', fraction: 0.1, chapter: '', pagesLeft: 1 }).detail).toBe('1 page left in chapter');
  expect(readerPosition({ locator: 'x', fraction: 0.1, chapter: '', pagesLeft: 0 }).detail).toBe('Last page in chapter');
  for (const line of [readerPosition({ locator: 'x', fraction: Infinity, chapter: '', pagesLeft: NaN }).line]) expect(line).not.toContain('NaN');
});

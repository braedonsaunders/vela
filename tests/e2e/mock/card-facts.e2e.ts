import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';
import { signInMockViewer } from './sign-in';

describe('Phone card facts and ranked numerals release gate', () => {
  test('a phone card wraps its facts only after a separator and a Top 10 numeral stays on its artwork', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/vela/');
    // The rendered lines of the first narrow card's facts reading "Jan 2, 2025 · TV-14 · 3 min".
    const lines = () => browser.evaluate(() => {
      const plain = (text: string) => text.replace(/⁠/g, '').replace(/ /g, ' ');
      const facts = [...document.querySelectorAll('div')].find(element => !element.children.length && plain(element.textContent ?? '') === 'Jan 2, 2025 · TV-14 · 3 min'
        && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().width < 160);
      const text = facts?.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) return [];
      const rows = new Map<number, string>();
      for (let index = 0; index < (text as Text).length; index++) {
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        const top = Math.round(rect.top);
        rows.set(top, (rows.get(top) ?? '') + (text as Text).data[index]);
      }
      return [...rows.values()].map(row => plain(row).trim());
    });
    await expect.poll(async () => (await lines()).length, { timeout: 30_000 }).toBeGreaterThan(1);
    expect(await lines()).toEqual(['Jan 2, 2025 ·', 'TV-14 · 3 min']);

    // Every rank of "Top 10 this week", on a 390 and a 375 px phone: the numeral's drawn glyph
    // stays on the artwork beside it and inside the numeral's own box, which its mask and its
    // clipped line cut to, so no part of it is cut off and a two-line title and facts below the
    // poster never run into it. The glyph is measured, not the numeral's box: its baseline is a
    // zero-size probe placed on the rendered line and its ink is the font's own glyph bounds
    // there, in whichever font loaded. The box is measured after the probe is removed.
    const ranks = (end: boolean) => browser.evaluate(({ name, toEnd }: { name: string; toEnd: boolean }) => {
      const isNumeral = (element: Element) => !element.children.length && /^([1-9]|10)$/.test(element.textContent ?? '') && parseFloat(getComputedStyle(element).fontSize) > 60;
      const heading = [...document.querySelectorAll('h2, [role="heading"]')].find(element => element.textContent === name);
      let row = heading?.parentElement ?? null;
      while (row && ![...row.querySelectorAll('div')].some(isNumeral)) row = row.parentElement;
      if (!row) return [];
      const numerals = [...row.querySelectorAll('div')].filter(isNumeral);
      // The shelf scrolls sideways; its later ranks are measured after scrolling it to its end.
      let shelf = numerals[0]?.parentElement ?? null;
      while (shelf && shelf !== row && !/auto|scroll/.test(getComputedStyle(shelf).overflowX)) shelf = shelf.parentElement;
      if (shelf) shelf.scrollLeft = toEnd ? shelf.scrollWidth : 0;
      return numerals.map(element => {
        const style = getComputedStyle(element);
        const probe = document.createElement('span');
        probe.style.cssText = 'display: inline-block; width: 0px; height: 0px; vertical-align: baseline';
        element.appendChild(probe);
        const baseline = probe.getBoundingClientRect().bottom;
        probe.remove();
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = context.measureText(element.textContent ?? '');
        const art = [...element.parentElement!.querySelectorAll('img')].map(image => image.getBoundingClientRect()).find(image => image.width > 50);
        // The numeral's own box clips its glyph when it carries a mask or clips its overflow.
        const clips = style.maskImage !== 'none' || style.overflowX !== 'visible' || style.overflowY !== 'visible';
        const box = element.getBoundingClientRect();
        const rank = element.textContent ?? '';
        // A rank whose artwork or numeral is not laid out yet is pending, and the poll waits for it.
        if (!art || !box.height) return { rank, pending: true as const };
        // The sample must be JSON: a value that is not a finite number is sent as null and fails
        // the check below, and a side the numeral's box leaves open is null, no limit on that side.
        const finite = (value: number) => Number.isFinite(value) ? value : null;
        return {
          rank, pending: false as const, top: finite(baseline - metrics.actualBoundingBoxAscent), bottom: finite(baseline + metrics.actualBoundingBoxDescent),
          artTop: finite(art.top), artBottom: finite(art.bottom), clipTop: clips ? finite(box.top) : null, clipBottom: clips ? finite(box.bottom) : null,
          clips,
        };
      });
    }, { name: 'Top 10 this week', toEnd: end });
    for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
      await browser.setViewport(viewport);
      const heading = screen.getByText('Top 10 this week');
      await browser.mouse.move(viewport.width / 2, viewport.height / 2);
      await expect.poll(async () => {
        if (await heading.isVisible()) return true;
        await browser.mouse.wheel(0, 600);
        return false;
      }, { timeout: 30_000 }).toBe(true);
      await heading.scrollIntoView();
      const seen = new Map<string, Extract<Awaited<ReturnType<typeof ranks>>[number], { pending: false }>>();
      await expect.poll(async () => {
        for (const end of [false, true]) for (const rank of await ranks(end)) if (!rank.pending) seen.set(rank.rank, rank);
        return [...seen.keys()].map(Number).sort((a, b) => a - b);
      }, { timeout: 30_000 }).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const measured = [...seen.values()];
      // Every metric is a finite number, the clip box's open sides aside.
      const isFinite = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value);
      expect(measured.filter(rank => ![rank.top, rank.bottom, rank.artTop, rank.artBottom].every(isFinite)
        || (rank.clips && !(isFinite(rank.clipTop) && isFinite(rank.clipBottom))))).toEqual([]);
      // How far each glyph reaches past the art and the numeral's box where they overlap, 0 when it stays inside.
      const past = measured.map(rank => ({
        viewport: viewport.width, rank: rank.rank,
        past: Math.max(0, Math.max(rank.artTop!, rank.clipTop ?? -Infinity) - rank.top!, rank.bottom! - Math.min(rank.artBottom!, rank.clipBottom ?? Infinity)),
      }));
      expect(past.filter(rank => rank.past > 0)).toEqual([]);
      await ranks(false);
    }
    await browser.setViewport({ width: 1440, height: 900 });
  });
});

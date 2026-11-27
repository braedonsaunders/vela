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

    // Ranks 1 and 10 of "Top 10 this week": the numeral's glyphs end above the foot of the poster
    // beside it, so a two-line title and facts below the poster never run into it, and start
    // below the top of the row that clips it.
    const ranks = () => browser.evaluate(() => [...document.querySelectorAll('div')]
      .filter(element => !element.children.length && /^(1|10)$/.test(element.textContent ?? '') && parseFloat(getComputedStyle(element).fontSize) > 100)
      .map(element => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const metrics = context.measureText(element.textContent ?? '');
        const baseline = box.top + parseFloat(style.paddingTop) + (parseFloat(style.lineHeight) - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 + metrics.fontBoundingBoxAscent;
        let clip = element.parentElement;
        while (clip && getComputedStyle(clip).overflowX === 'visible' && getComputedStyle(clip).overflowY === 'visible') clip = clip.parentElement;
        const art = [...element.parentElement!.querySelectorAll('img')].map(image => image.getBoundingClientRect()).find(image => image.width > 50);
        return { rank: element.textContent, top: baseline - metrics.actualBoundingBoxAscent, bottom: baseline + metrics.actualBoundingBoxDescent, clip: clip?.getBoundingClientRect().top ?? 0, art: art?.bottom ?? 0 };
      }));
    const heading = screen.getByText('Top 10 this week');
    await browser.mouse.move(195, 600);
    await expect.poll(async () => {
      if (await heading.isVisible()) return true;
      await browser.mouse.wheel(0, 600);
      return false;
    }, { timeout: 30_000 }).toBe(true);
    await heading.scrollIntoView();
    await expect.poll(async () => (await ranks()).map(rank => rank.rank).sort(), { timeout: 30_000 }).toEqual(['1', '10']);
    for (const rank of await ranks()) {
      expect(rank.art).toBeGreaterThan(0);
      expect(rank.bottom).toBeLessThanOrEqual(rank.art);
      expect(rank.top).toBeGreaterThanOrEqual(rank.clip);
    }
    await browser.setViewport({ width: 1440, height: 900 });
  });
});

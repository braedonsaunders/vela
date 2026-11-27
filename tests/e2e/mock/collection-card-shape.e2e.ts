import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';
import { signInMockViewer } from './sign-in';

describe('Home collection card shape', () => {
  test('all three collection cards render square artwork on desktop and phone', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await browser.setViewport(viewport);
      const heading = screen.getByRole('heading', 'Square collections');
      await browser.mouse.move(viewport.width / 2, viewport.height / 2);
      await expect.poll(async () => {
        if (await heading.isVisible()) return true;
        await browser.mouse.wheel(0, 700);
        return false;
      }, { timeout: 30_000 }).toBe(true);
      await heading.scrollIntoView();
      const artwork = () => browser.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('img[src*="square-collection-"]')]
        .filter(image => image.complete && image.naturalWidth > 0)
        .map(image => {
          const { width, height } = image.getBoundingClientRect();
          return { width, height };
        }).filter(({ width, height }) => width > 0 && height > 0));
      await expect.poll(async () => (await artwork()).length, { timeout: 15_000 }).toBe(3);
      expect((await artwork()).map(({ width, height }) => width / height)).toEqual([1, 1, 1]);
    }
  });
});

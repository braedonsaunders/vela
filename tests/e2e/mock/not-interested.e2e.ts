import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { runningBrowserPage } from '../muted-browser';
import { signInMockViewer } from './sign-in';

test('Not interested hides a Home card and Undo restores it', async ({ app, browser, screen }) => {
  await signInMockViewer(app, screen);
  const title = '/vela/title/title-1-2';
  const page = runningBrowserPage(await browser.evaluate(() => location.origin));
  const cards = page.locator('a[href="/vela/title/title-1-2"]');
  const undo = screen.getByRole('button', 'Undo');
  const hidden = screen.getByRole('button', 'Clear not interested');
  const notInterested = screen.getByRole('button', 'Not interested');
  try {
    await cards.first().click({ button: 'right' });
    const action = screen.getByRole('menuitem', 'Not interested');
    await expect(action).toBeVisible();
    await expect(screen.getByRole('menuitem', 'Thumbs up')).toBeVisible();
    await app.screenshot('not-interested-menu');
    await action.tap();
    await expect(undo).toBeEnabled();
    await expect.poll(() => cards.count()).toBe(0);
    await app.screenshot('not-interested-undo');
    await undo.tap();
    await expect(undo).toHaveCount(0);
    await expect.poll(() => cards.count()).toBe(1);
    await cards.first().scrollIntoViewIfNeeded();
    await app.screenshot('not-interested-restored');
  } finally {
    await app.open(title);
    await expect(screen.getByRole('heading', 'A Map of Quiet Stars')).toBeVisible();
    await expect.poll(async () => await notInterested.isVisible() || await hidden.isVisible()).toBe(true);
    if (await hidden.isVisible()) await hidden.tap();
    await expect(notInterested).toBeEnabled();
  }
});

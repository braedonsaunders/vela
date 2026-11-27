import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { runningBrowserPage } from '../muted-browser';
import { signInMockViewer } from './sign-in';

test('a title enters and leaves the Home Watchlist without a restart', async ({ app, browser, screen }) => {
  await signInMockViewer(app, screen);
  const title = '/vela/title/title-1-2';
  const page = runningBrowserPage(await browser.evaluate(() => location.origin));
  const card = page.locator('a[href="/vela/title/title-1-2"]');
  const watchlistCard = page.getByRole('heading', { name: 'Watchlist', exact: true })
    .locator('xpath=ancestor::*[.//a[@href="/vela/title/title-1-2"]][1]')
    .locator('a[href="/vela/title/title-1-2"]');
  const add = screen.getByRole('button', 'Add to watchlist');
  const remove = screen.getByRole('button', 'Remove from watchlist');
  const watchlist = screen.getByRole('heading', 'Watchlist');
  await expect(watchlist).toHaveCount(0);
  try {
    await card.first().click();
    await expect(add).toBeVisible();
    await add.tap();
    await expect(remove).toBeEnabled();
    await screen.getByTestId('detail-close').tap();
    await expect(watchlist).toBeVisible();
    await expect.poll(() => watchlistCard.count()).toBe(1);
    await watchlistCard.scrollIntoViewIfNeeded();
    await app.screenshot('watchlist-added');

    await watchlistCard.click();
    await expect(remove).toBeVisible();
    await remove.tap();
    await expect(add).toBeEnabled();
    await screen.getByTestId('detail-close').tap();
    await expect(screen.getByTestId('nav-Home')).toBeVisible();
    await expect(watchlist).toHaveCount(0);
    await app.screenshot('watchlist-removed');
  } finally {
    await app.open(title);
    await expect(screen.getByRole('heading', 'A Map of Quiet Stars')).toBeVisible();
    if (await remove.isVisible()) await remove.tap();
    await expect(add).toBeEnabled();
  }
});

import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';

describe('Title ratings', () => {
  test('shows the available scores and announces the Rotten Tomatoes states', async ({ app, browser, screen }) => {
    await app.clearState();
    await screen.getByRole('textbox', 'Username').fill('demo');
    await screen.getByRole('textbox', 'Password').fill('vela');
    await screen.getByRole('button', 'Sign in').press('Enter');
    await expect(screen.getByRole('link', 'Home')).toBeVisible({ timeout: 30_000 });
    const ratings = screen.getByTestId('title-ratings');
    const labels = () => browser.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="title-ratings"] [aria-label]'), element => element.getAttribute('aria-label')));

    await app.open('/vela/title/title-1-1');
    await expect(ratings).toBeVisible({ timeout: 30_000 });
    await expect(ratings).toHaveText('92% · 87% · IMDb 7.8 · Metacritic 83 · TMDB 8.1 · Letterboxd 4.2');
    expect(await labels()).toEqual([
      'Rotten Tomatoes 92 percent, fresh',
      'Rotten Tomatoes audience 87 percent, upright',
      'IMDb 7.8', 'Metacritic 83', 'TMDB 8.1', 'Letterboxd 4.2',
    ]);

    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/vela/title/title-1-2');
    await expect(ratings).toHaveText('35% · TMDB 6.3');
    expect(await labels()).toEqual(['Rotten Tomatoes 35 percent, rotten', 'TMDB 6.3']);

    await app.open('/vela/title/title-1-3');
    await expect(ratings).toHaveText('96%');
    expect(await labels()).toEqual(['Rotten Tomatoes 96 percent, certified fresh']);

    await app.open('/vela/title/title-1-4');
    await expect(screen.getByRole('heading', 'The Long Orbit')).toBeVisible();
    await expect(ratings).toHaveCount(0);
  });
});

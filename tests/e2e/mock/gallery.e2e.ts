import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';

describe('Gallery deterministic release gate', { session: 'mock-gallery', serial: true }, () => {
  test('the viewer follows the timeline, album and person and restores focus', async ({ app, browser, screen }) => {
    await app.open('/vela/library/photos');
    const toolbar = screen.getByTestId('gallery-toolbar');
    const allPhotos = toolbar.getByRole('tab', 'All photos');
    const albums = toolbar.getByRole('tab', 'Albums');
    const people = toolbar.getByRole('tab', 'People');
    const harbour = screen.getByTestId('gallery-photo-photo-harbour-at-dawn');
    const caption = screen.getByTestId('gallery-photo-caption');
    const close = screen.getByTestId('detail-close');
    const next = screen.getByTestId('gallery-photo-next');
    const previous = screen.getByTestId('gallery-photo-previous');
    const info = screen.getByTestId('gallery-photo-info-panel');
    const focused = (id: string) => browser.evaluate(testId => document.activeElement?.getAttribute('data-testid') === testId, id);

    await expect(allPhotos).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByTestId('gallery-timeline').getByText('November 2026', { exact: true })).toBeVisible();
    await expect(harbour).toBeVisible();
    await harbour.press('Enter');
    await expect(caption.getByRole('heading', 'Harbour at dawn')).toBeVisible();
    await expect(previous).toBeHidden();
    await next.press('ArrowRight');
    await expect(caption.getByRole('heading', 'Orchard in fog')).toBeVisible();
    await previous.press('ArrowLeft');
    await expect(caption.getByRole('heading', 'Harbour at dawn')).toBeVisible();

    await screen.getByRole('button', 'Photo info').tap();
    await expect(info.getByText('North Quay', { exact: true })).toBeVisible();
    await expect(info.getByText('2026-11-23', { exact: true })).toBeHidden();
    await screen.getByRole('button', 'Full screen').tap();
    const fullscreen = screen.getByTestId('gallery-photo-fullscreen-stage');
    const surface = fullscreen.getByTestId('gallery-photo-stage');
    const exit = fullscreen.getByRole('button', 'Exit full screen');
    await expect(exit).toBeVisible();
    await surface.press('c');
    await expect(exit).toBeHidden();
    await surface.press('Enter');
    await expect(exit).toBeVisible();
    await surface.press('Escape');
    await expect(fullscreen).toBeHidden();
    await expect(info).toBeHidden();
    await close.tap();
    await expect(harbour).toBeVisible();
    await expect.poll(() => focused('gallery-photo-photo-harbour-at-dawn')).toBe(true);

    await albums.tap();
    const album = screen.getByRole('button', 'Along the coast, 4 photos');
    await album.tap();
    await expect(screen.getByRole('heading', 'Along the coast')).toBeVisible();
    await harbour.tap();
    await next.press('ArrowRight');
    await expect(caption.getByRole('heading', 'Saltmarsh, evening')).toBeVisible();
    await previous.press('ArrowLeft');
    await expect(caption.getByRole('heading', 'Harbour at dawn')).toBeVisible();
    await close.tap();
    await expect.poll(() => focused('gallery-photo-photo-harbour-at-dawn')).toBe(true);
    await toolbar.getByRole('button', 'Back to Albums').tap();
    await expect(album).toBeVisible();
    await expect.poll(() => focused('gallery-album-photo-album-1')).toBe(true);

    await people.tap();
    const subject = screen.getByRole('button', 'Elena Rivers, 4 photos');
    await subject.tap();
    await expect(screen.getByRole('heading', 'Elena Rivers')).toBeVisible();
    await harbour.tap();
    await next.press('ArrowRight');
    await expect(caption.getByRole('heading', 'The lighthouse path')).toBeVisible();
    await previous.press('ArrowLeft');
    await expect(caption.getByRole('heading', 'Harbour at dawn')).toBeVisible();
    await close.tap();
    await expect.poll(() => focused('gallery-photo-photo-harbour-at-dawn')).toBe(true);
    await toolbar.getByRole('button', 'Back to People').tap();
    await expect(subject).toBeVisible();
    await expect.poll(() => focused('gallery-person-person-elena-rivers')).toBe(true);
  });

  test('a standalone photo fits its caption and preserves the full facts', async ({ app, screen }) => {
    const harbour = 'Harbour at dawn';
    await app.open('/vela/title/photo-harbour-at-dawn?library=photos');
    const photo = screen.getByRole('dialog', harbour);
    await expect(photo.getByRole('image', harbour)).toBeVisible({ timeout: 30_000 });
    await expect(photo.getByRole('heading', harbour)).toBeVisible();
    await expect(photo.getByText('Photo', { exact: true })).toBeVisible();
    const takenDay = photo.getByText('Nov 23, 2026', { exact: true });
    await expect(takenDay).toBeVisible();
    const frame = photo.getByTestId('detail-frame');
    await expect.poll(async () => {
      const bounds = await frame.boundingBox();
      const caption = await takenDay.boundingBox();
      return !!bounds && !!caption && caption.y + caption.height <= bounds.y + bounds.height;
    }).toBe(true);
    await photo.getByText('North Quay', { exact: true }).scrollIntoView();
    await expect(photo.getByText('Place', { exact: true })).toBeVisible();
    await expect(photo.getByText('North Quay', { exact: true })).toBeVisible();
    await expect(photo.getByText('Taken', { exact: true })).toBeVisible();
    await expect(photo.getByText('2026-11-23', { exact: true })).toBeVisible();
  });

  test('title alerts clear the controls and arrive after fullscreen closes', async ({ app, browser, screen }) => {
    await app.open('/vela/library/photos');
    await screen.getByRole('button', 'Harbour at dawn').tap();
    const alerts = screen.getByTestId('live-alerts');
    const controls = screen.getByTestId('gallery-photo-controls');
    const edges = screen.getByTestId('gallery-photo-edges');
    const postAlert = (eventId: string) => browser.evaluate(async id => (await fetch('/__admin/sports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert: { kind: 'close', eventId: id } }),
    })).status, eventId);

    await expect(controls).toBeVisible({ timeout: 30_000 });
    expect(await postAlert('sports:sports:nhl-tor-mtl')).toBe(200);
    await expect(alerts).toBeVisible();
    await expect.poll(async () => {
      const toast = await alerts.boundingBox();
      const bar = await controls.boundingBox();
      const row = await edges.boundingBox();
      return !!toast && !!bar && !!row && toast.y >= Math.max(bar.y + bar.height, row.y + row.height) + 8;
    }).toBe(true);

    await screen.getByRole('button', 'Full screen').tap();
    const stage = screen.getByTestId('gallery-photo-stage');
    await expect(stage).toBeVisible();
    await expect(alerts).toBeHidden();
    expect(await postAlert('sports:sports:nfl-nyg-phi')).toBe(200);
    await expect(alerts).toBeHidden();
    await stage.press('Escape');
    await expect(alerts.getByText(/Giants.*Eagles/)).toBeVisible();
    await expect(screen.getByTestId('gallery-photo-info-panel')).toBeHidden();
  });
});

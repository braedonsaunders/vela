import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';

describe('Gallery deterministic release gate', { session: 'mock-gallery', serial: true }, () => {
  test('Photos opens the All photos grid and opens and closes a photo', async ({ app, screen }) => {
    await app.open('/vela/library/photos');
    const toolbar = screen.getByTestId('library-toolbar').first();
    const allPhotos = toolbar.getByRole('tab', 'All photos');
    await expect(allPhotos).toBeVisible({ timeout: 30_000 });
    await allPhotos.tap();

    const harbour = 'Harbour at dawn';
    const tile = screen.getByRole('button', 'Open Harbour at dawn, 2026');
    await expect(toolbar).toBeVisible();
    await expect(tile).toBeVisible();
    await tile.tap();

    const photo = screen.getByRole('dialog', harbour);
    await expect(photo.getByRole('image', harbour)).toBeVisible();
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

    await photo.getByTestId('detail-close').tap();
    await expect(photo).toBeHidden();
    await expect(allPhotos).toBeVisible();
    await expect(tile).toBeVisible();
  });
});

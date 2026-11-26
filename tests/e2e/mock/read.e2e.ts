import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';

describe('Read deterministic release gate', { session: 'mock-read', serial: true }, () => {
  test('the library, series and book open a working reader', async ({ app, screen }) => {
    await app.open('/vela/library/books');
    await expect(screen.getByRole('heading', 'Continue reading')).toBeVisible({ timeout: 30_000 });

    const harbour = 'A Harbour of Bells';
    await screen.getByRole('button', /^Open A Harbour of Bells,/).first().tap();
    const book = screen.getByRole('dialog', harbour);
    const title = book.getByRole('heading', harbour);
    const progress = book.getByTestId('media-reading-progress');
    const read = book.getByTestId('media-read');
    await expect(title).toBeVisible();
    await expect(progress).toHaveText('34% read · Chapter 3 · 34%');
    await expect(read).toHaveText('Continue reading');

    await screen.getByTestId('media-series').tap();
    const series = screen.getByRole('dialog', 'The Saltglass Chronicles');
    await expect(series.getByRole('heading', 'The Saltglass Chronicles')).toBeVisible();
    await expect(series.getByTestId('media-book-book-saltglass-gate')).toBeVisible();
    await expect(series.getByTestId('media-book-book-drowned-cartographer')).toBeVisible();
    await expect(series.getByTestId('media-book-book-harbour-of-bells')).toBeVisible();
    await series.getByTestId('detail-close').tap();
    await expect(series).toBeHidden();
    await expect(title).toBeVisible();
    await read.tap();

    const reader = screen.getByTestId('reader');
    const position = screen.getByTestId('reader-hint');
    await expect(reader).toBeVisible({ timeout: 30_000 });
    await expect(position).toHaveText(/\d+%$/, { timeout: 30_000 });
    const opened = (await position.textContent())!.trim();
    await reader.press('ArrowRight');
    await expect(position).toHaveText(/\d+%$/);
    await expect(position).not.toHaveText(opened);
    await reader.press('ArrowLeft');
    await expect(position).toHaveText(opened);

    await reader.press('ArrowUp');
    const panelClose = screen.getByTestId('reader-panel-close');
    await screen.getByTestId('reader-contents').tap();
    await expect(panelClose).toBeVisible();
    const chapter = screen.getByText('A Street That Was Not There', { exact: true }).last();
    await expect(chapter).toBeVisible();
    await panelClose.tap();
    await expect(panelClose).toBeHidden();
    await screen.getByTestId('reader-type').tap();
    await expect(screen.getByText('Text and layout', { exact: true })).toBeVisible();
    await panelClose.tap();
    await expect(panelClose).toBeHidden();
    await screen.getByTestId('reader-close').tap();
    await expect(title).toBeVisible();
    await expect(reader).toBeHidden();

    // The mock acknowledges reader writes while preserving the seeded progress for reopening.
    await app.open('/vela/title/book-harbour-of-bells?library=books');
    await expect(progress).toHaveText('34% read · Chapter 3 · 34%');

    await app.open('/vela/title/book-field-guide-imaginary-birds?library=books');
    const pdf = screen.getByRole('dialog', 'A Field Guide to Imaginary Birds');
    await expect(pdf.getByRole('heading', 'A Field Guide to Imaginary Birds')).toBeVisible();
    await pdf.getByTestId('media-read').tap();
    await expect(position).toHaveText('Page 1 of 6 · 0%', { timeout: 30_000 });
    await reader.press('Escape');
    await expect(reader).toBeHidden();
  });
});

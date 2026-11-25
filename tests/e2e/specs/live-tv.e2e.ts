import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';

describe('Live TV release gate', { session: 'lab-viewer' }, () => {
  test('one lab channel stays playing for two minutes', async ({ app, screen }) => {
    await app.open('/vela/live');
    await expect(screen.getByRole('heading', 'Live TV')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByTestId('guide-watch')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('guide-watch').tap();
    await expect(screen.getByRole('button', 'Close player')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByTestId('player-live-mark')).toBeVisible();

    await new Promise<void>(resolve => setTimeout(resolve, 120_000));
    await expect(screen.getByTestId('player-live-mark')).toBeVisible();
    await expect(screen.getByRole('button', 'Pause')).toBeVisible();
    await expect(screen.getByTestId('player-retrying')).toBeHidden();
    await expect(screen.getByTestId('player-status')).toBeHidden();
    await screen.getByTestId('player-stage-input').tap();
    await screen.getByRole('button', 'Close player').tap();
    await expect(screen.getByRole('heading', 'Live TV')).toBeVisible({ timeout: 30_000 });
  });
});

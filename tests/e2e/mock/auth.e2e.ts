import { expect } from 'e2e';
import { test } from '@e2e-dev/web';

for (const suite of ['catch-up', 'film', 'music', 'quality-cap', 'see-all', 'sports', 'sports-catch-up']) {
  const name = `mock-${suite}`;
  test.setup(`Mock release gate: sign in for ${suite}`, { sessions: [name] }, async ({ app, screen, session }) => {
    await app.clearState();
    await screen.getByRole('textbox', 'Username').fill('demo');
    await screen.getByRole('textbox', 'Password').fill('vela');
    await screen.getByRole('button', 'Sign in').tap();
    await expect(screen.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('link', 'Home')).toBeVisible();
    await session.save(name);
  });
}

import { expect, type App, type Screen } from 'e2e';

export async function signInMockViewer(app: App, screen: Screen) {
  await app.clearState();
  await screen.getByRole('textbox', 'Username').fill('demo');
  await screen.getByRole('textbox', 'Password').fill('vela');
  await screen.getByRole('button', 'Sign in').tap();
  await expect(screen.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole('link', 'Home')).toBeVisible();
}

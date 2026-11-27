import { expect, type App, type Screen } from 'e2e';

export async function signInMockViewer(app: App, screen: Screen) {
  await app.clearState();
  // The server offers Plex first; a username and password are the viewer's choice.
  await screen.getByRole('button', 'Sign in with a username instead').tap();
  await screen.getByRole('textbox', 'Username').fill('demo');
  await screen.getByRole('textbox', 'Password').fill('vela');
  await screen.getByRole('button', 'Sign in').tap();
  await expect(screen.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByRole('link', 'Home')).toBeVisible();
}

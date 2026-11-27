import { expect, secrets } from 'e2e';
import { afterAll, afterEach, beforeAll, test } from '@e2e-dev/mobile';

beforeAll(async ({ device }) => {
  await device.installApp(undefined, { reinstall: true });
});

afterAll(async ({ device }) => {
  await device.closeApp();
});

afterEach(async ({ screen }) => {
  const close = screen.getByTestId('detail-close');
  if (await close.isVisible()) await close.tap();
  const profile = screen.getByTestId('profile-menu');
  if (!await profile.isVisible()) return;
  await profile.tap();
  const signOut = screen.getByRole('button', 'Sign out');
  if (await signOut.isVisible()) await signOut.tap();
});

test('Home and detail are ready on the native release build', async ({ app, device, screen }) => {
  await app.clearState();
  if (device.unstable_raw.platform === 'ios') await device.clearKeychain();
  await app.open();
  // Android TV exposes only LEANBACK_LAUNCHER; agent-device's generic package
  // launch asks for LAUNCHER and lands back on the TV home screen.
  if (process.env.VELA_E2E_NATIVE_TARGET === 'android-tv') {
    await device.unstable_raw.client.apps.open({
      app: 'app.ether.vela',
      activity: 'app.ether.vela/.MainActivity',
      relaunch: true,
    });
  }
  // Xcode 27 only ships an iPhone Duo profile for this runtime. Keep the app on
  // its cover display so accessibility, screenshots, and taps all share one
  // surface; the unfolded simulator exposes a second, black display first.
  if (process.env.VELA_E2E_NATIVE_TARGET === 'ios') {
    await device.fold('closed');
    await app.restart();
  }

  // The lab offers Plex first; a username and password are the viewer's choice.
  await screen.getByTestId('connect-use-password').tap();
  if (process.env.VELA_E2E_NATIVE_TARGET === 'android-tv') {
    await screen.getByTestId('connect-username').tap();
    await device.unstable_raw.client.command.tvRemote({ button: 'select' });
    await screen.getByRole('textbox').first().fill(secrets.get('viewerUsername'));
    await device.back();
  } else {
    await screen.getByRole('textbox', 'Username').fill(secrets.get('viewerUsername'));
  }
  if (process.env.VELA_E2E_NATIVE_TARGET === 'tvos') {
    await device.unstable_raw.client.command.tvRemote({ button: 'menu' });
  }
  if (process.env.VELA_E2E_NATIVE_TARGET === 'android-tv') {
    await screen.getByTestId('connect-password').tap();
    await device.unstable_raw.client.command.tvRemote({ button: 'select' });
    await screen.getByRole('textbox').first().fill(secrets.get('viewerPassword'));
    await device.back();
  } else {
    await screen.getByRole('textbox', 'Password').fill(secrets.get('viewerPassword'));
  }
  if (process.env.VELA_E2E_NATIVE_TARGET === 'tvos') {
    await device.unstable_raw.client.command.tvRemote({ button: 'menu' });
  }
  await screen.getByRole('button', 'Sign in').tap();
  await expect(screen.getByTestId('section-home:home')).toBeVisible({ timeout: 45_000 });
  await expect(screen.getByTestId(/^title-/).first()).toBeVisible({ timeout: 45_000 });
  await screen.getByTestId(/^title-/).first().tap();
  await expect(screen.getByTestId('detail-frame')).toBeVisible({ timeout: 45_000 });
  await expect(screen.getByRole('button', /^(Resume|Play)/).first()).toBeVisible();
});

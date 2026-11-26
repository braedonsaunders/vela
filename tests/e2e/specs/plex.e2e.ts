import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';

const DUNE = '1000000000693134';
const TWO_GUNS = '1000000000136400';

describe('Plex-mode release gate', { session: 'lab-viewer' }, () => {
  test('two players share one identity and first play exposes burned-in captions', async ({ app, browser, screen }) => {
    const secretPath = '/__e2e/plex-token-22e6f332c6484e93a235';
    test.skip(!process.env.VELA_E2E_PLEX_TOKEN_FILE, 'Plex owner token is not configured');

    const plexClientIds = new Set<string>();
    const plexDirect = /^https:\/\/[^/]+\.plex\.direct(?::\d+)?\//;
    await browser.route(plexDirect, async route => {
      const url = new URL(route.request.url);
      if (url.pathname.startsWith('/vela/')) {
        await route.fulfill({ status: 404, body: 'not found' });
        return;
      }
      const id = route.request.headers['x-plex-client-identifier'];
      if (id) plexClientIds.add(id);
      if (url.pathname === '/:/timeline') {
        await route.fulfill({ status: 200, body: '' });
        return;
      }
      await route.fallback();
    });

    const pins = /^https:\/\/plex\.tv\/api\/v2\/pins\/\d+/;
    await browser.route(pins, async route => {
      const upstream = await route.fetch();
      const value = JSON.parse(await upstream.text()) as Record<string, unknown>;
      const token = await fetch(new URL(secretPath, 'http://127.0.0.1:43251')).then(async response => {
        if (!response.ok) throw new Error('Plex test secret was unavailable');
        return response.text();
      });
      await route.fulfill({ status: upstream.status, headers: upstream.headers,
        body: JSON.stringify({ ...value, authToken: token }) });
    });

    await app.open('/vela/connect');
    await expect(screen.getByRole('heading', 'Choose a server')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('auth-add').tap();
    await screen.getByTestId('connect-plex').tap();
    await expect(screen.getByTestId('plex-code')).toBeVisible({ timeout: 30_000 });
    const owner = screen.getByRole('button', /Braedon Saunders/);
    await expect(owner).toBeVisible({ timeout: 45_000 });
    await owner.tap();
    const lab = screen.getByRole('button', /Ether On Air Lab/);
    await expect(lab).toBeVisible({ timeout: 45_000 });
    await lab.tap();
    await expect(screen.getByRole('link', 'Home')).toBeVisible({ timeout: 45_000 });

    await app.open(`/vela/title/${DUNE}`);
    await expect(screen.getByRole('dialog', 'Dune: Part Two')).toBeVisible({ timeout: 45_000 });
    await screen.getByTestId('detail-play').tap();
    await expect(screen.getByRole('button', 'Pause')).toBeVisible({ timeout: 45_000 });

    await screen.getByTestId('player-cc-button').tap();
    const englishPgs = screen.getByRole('radio', /^(?:English, |en )PGS$/);
    await expect(englishPgs).toBeVisible({ timeout: 30_000 });
    await expect(englishPgs).toBeChecked();
    await expect(screen.getByRole('radio', 'Off')).toBeVisible();
    await screen.getByTestId('player-cc-button').tap();
    await browser.evaluate(() => {
      const visit = (root: Document | ShadowRoot): HTMLVideoElement | null => {
        const direct = root.querySelector('video');
        if (direct) return direct;
        for (const element of root.querySelectorAll<HTMLElement>('*')) {
          const found = element.shadowRoot ? visit(element.shadowRoot) : null;
          if (found) return found;
        }
        return null;
      };
      const video = visit(document);
      if (video) video.currentTime = 225;
      return null;
    });
    await new Promise<void>(resolve => setTimeout(resolve, 5_000));
    await expect(screen.getByRole('button', 'Pause')).toBeVisible();
    await app.screenshot('plex-burn-in-captions');

    const first = browser.tabs().find(tab => tab.isActive())!;
    const second = await browser.newTab();
    await browser.goto(`/vela/watch/${TWO_GUNS}`);
    await expect(screen.getByRole('button', 'Pause')).toBeVisible({ timeout: 45_000 });
    expect(plexClientIds.size).toBe(1);
    await screen.getByTestId('player-stage-input').tap();
    await screen.getByRole('button', 'Close player').tap();
    await second.close();

    await first.activate();
    await screen.getByTestId('player-stage-input').tap();
    await screen.getByRole('button', 'Close player').tap();
    await browser.unroute(pins);
    await browser.unroute(plexDirect);
  });
});

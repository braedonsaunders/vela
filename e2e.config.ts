import { codex } from '@e2e-dev/acp';
import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';

const server = process.env.VELA_E2E_SERVER;

if (!server) {
  throw new Error('VELA_E2E_SERVER must point at the dedicated Vela lab server');
}

const upstream = new URL(server);
if (upstream.protocol !== 'http:' || !upstream.hostname.startsWith('192.168.')) {
  throw new Error('VELA_E2E_SERVER must be the private-LAN HTTP Vela lab');
}

const appUrl = 'http://127.0.0.1:43251/vela/';
const app = {
  url: appUrl,
  readyUrl: appUrl,
  environment: 'staging' as const,
  identity: 'vela-lab',
  command: {
    executable: process.execPath,
    args: ['tests/e2e/lab-proxy.ts', '{port}'],
    env: { VELA_E2E_SERVER: server },
    log: '.e2e/logs/lab-proxy.log',
    shutdownTimeout: 5_000,
  },
};

function mutedBrowser(browser: 'chromium' | 'webkit') {
  return web({
    browser,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    headers: {
      'X-Vela-Language': 'en',
      'X-Vela-Screen-Renderer': '19',
    },
    initScripts: [() => {
      const media = HTMLMediaElement.prototype;
      const muted = Object.getOwnPropertyDescriptor(media, 'muted');
      const volume = Object.getOwnPropertyDescriptor(media, 'volume');
      Object.defineProperty(media, 'muted', {
        configurable: true,
        get() { return true; },
        set() { muted?.set?.call(this, true); },
      });
      Object.defineProperty(media, 'volume', {
        configurable: true,
        get() { return 0; },
        set() { volume?.set?.call(this, 0); },
      });
    }],
  });
}

export default {
  projectId: 'vela-release-gates',
  tests: 'tests/e2e/specs/**/*.e2e.ts',
  targets: [
    {
      name: 'chromium',
      engine: mutedBrowser('chromium'),
      app,
    },
    {
      name: 'webkit',
      engine: mutedBrowser('webkit'),
      app,
    },
  ],
  agents: {
    default: {
      executor: codex({
        env: {
          ...(process.env.VELA_E2E_CODEX_HOME ? { CODEX_HOME: process.env.VELA_E2E_CODEX_HOME } : {}),
          ...(process.env.VELA_E2E_CODEX_PATH ? { CODEX_PATH: process.env.VELA_E2E_CODEX_PATH } : {}),
        },
        system: 'Operate only the Vela UI. Never use external tools. Playback must stay muted.',
      }),
      context: 'Vela is a television and film client. Home rows are horizontal shelves. Release tests use a dedicated lab viewer.',
    },
  },
  secrets: {
    viewerUsername: () => process.env.VELA_E2E_USER ?? '',
    viewerPassword: () => process.env.VELA_E2E_PASSWORD ?? '',
  },
  cache: { mode: 'read-write', dir: '.e2e/cache' },
  workers: 1,
  retries: 0,
  timeout: 180_000,
  actionTimeout: 15_000,
  assertionTimeout: 15_000,
  trace: 'retain-on-failure',
} satisfies E2EConfig;

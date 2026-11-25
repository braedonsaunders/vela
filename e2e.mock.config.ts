import { codex } from '@e2e-dev/acp';
import type { E2EConfig } from 'e2e';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mutedBrowser } from './tests/e2e/muted-browser';

const server = process.env.VELA_E2E_SERVER;
const staticRoot = process.env.VELA_E2E_STATIC_ROOT;

if (!server && !staticRoot) {
  throw new Error('Set VELA_E2E_SERVER for the lab export or VELA_E2E_STATIC_ROOT for a local Expo export');
}

if (server) {
  const upstream = new URL(server);
  if (upstream.protocol !== 'http:' || !upstream.hostname.startsWith('192.168.')) {
    throw new Error('VELA_E2E_SERVER must be the private-LAN HTTP Vela lab');
  }
}

const appUrl = 'http://127.0.0.1:43253/vela/';
const app = {
  url: appUrl,
  readyUrl: appUrl,
  environment: 'staging' as const,
  identity: 'vela-mock',
  command: {
    executable: process.execPath,
    args: ['tests/e2e/mock-proxy.ts', '{port}'],
    env: {
      VELA_E2E_SERVER: server ?? '',
      VELA_E2E_STATIC_ROOT: staticRoot ?? '',
      VELA_E2E_BUN: process.env.VELA_E2E_BUN ?? 'bun',
      VELA_MOCK_MEDIA_ROOT: process.env.VELA_MOCK_MEDIA_ROOT ?? join(homedir(), '.scratch/tmp/vela/media'),
      VELA_MOCK_MUSIC_ROOT: process.env.VELA_MOCK_MUSIC_ROOT ?? join(homedir(), '.scratch/tmp/vela/media-music'),
      VELA_MOCK_FORMATS_ROOT: process.env.VELA_MOCK_FORMATS_ROOT ?? join(homedir(), '.scratch/tmp/vela/formats'),
    },
    log: '.e2e/logs/mock-proxy.log',
    shutdownTimeout: 8_000,
  },
};

export default {
  projectId: 'vela-release-gates-mock',
  tests: 'tests/e2e/mock/**/*.e2e.ts',
  targets: [
    { name: 'mock-chromium', engine: mutedBrowser('chromium', { allowSoftwareVisualizer: true }), app },
    { name: 'mock-webkit', engine: mutedBrowser('webkit', { allowSoftwareVisualizer: true }), app },
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
      context: 'Vela is a television and film client. This release suite runs against deterministic fictional mock media.',
    },
  },
  cache: { mode: 'read-write', dir: '.e2e/cache' },
  workers: 1,
  retries: 0,
  timeout: 240_000,
  actionTimeout: 15_000,
  assertionTimeout: 15_000,
  trace: 'retain-on-failure',
} satisfies E2EConfig;

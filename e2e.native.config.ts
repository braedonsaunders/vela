import type { E2EConfig } from 'e2e';
import { mobile } from '@e2e-dev/mobile';

const kind = process.env.VELA_E2E_NATIVE_TARGET;
const device = process.env.VELA_E2E_NATIVE_DEVICE;
const appPath = process.env.VELA_E2E_NATIVE_APP;

if (!kind || !['ios', 'tvos', 'android', 'android-tv'].includes(kind)) {
  throw new Error('VELA_E2E_NATIVE_TARGET must be ios, tvos, android, or android-tv');
}
if (!device || !appPath) {
  throw new Error('VELA_E2E_NATIVE_DEVICE and VELA_E2E_NATIVE_APP are required');
}
if ((kind === 'ios' || kind === 'tvos') && !/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i.test(device)) {
  throw new Error('Apple native release gates accept simulator UUIDs only');
}
if ((kind === 'android' || kind === 'android-tv') && !/^emulator-\d+$/.test(device)) {
  throw new Error('Android native release gates accept emulator serials only');
}

const platform = kind === 'ios' || kind === 'tvos' ? 'ios' : 'android';

export default {
  projectId: 'vela-release-gates-native',
  tests: 'tests/e2e/native/**/*.e2e.ts',
  targets: [{
    name: kind,
    engine: mobile({ platform, device, session: `vela-e2e-${kind}`, settle: 250, transition: 750 }),
    app: {
      bundleId: 'app.ether.vela',
      appPath,
      identity: `vela-lab-${kind}`,
      environment: 'staging',
    },
  }],
  secrets: {
    viewerUsername: () => process.env.VELA_E2E_USER ?? '',
    viewerPassword: () => process.env.VELA_E2E_PASSWORD ?? '',
  },
  cache: { mode: 'read-write', dir: '.e2e/cache' },
  workers: 1,
  retries: 0,
  timeout: 240_000,
  actionTimeout: 45_000,
  assertionTimeout: 20_000,
  cleanupTimeout: 30_000,
  trace: 'retain-on-failure',
} satisfies E2EConfig;

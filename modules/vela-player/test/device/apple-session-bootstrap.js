// Test-only bootstrap for an owner-approved Quick Connect session. Private config
// stays beside the probe and is ignored. Restore mode restores the previous device
// identity and credentials before entering the regular application.
import { secrets } from '../../../../apps/vela/src/data/secrets';
import { config } from '../../../../apps/vela/src/data/config';
import privateConfig from './probe-config.json';

const backupKey = 'vela.apple-proof-backup';
const keys = ['vela.device', 'vela.session'];
if (privateConfig.restore) {
  const backup = JSON.parse(secrets.get(backupKey) || '{}');
  for (const key of keys) if (key in backup) secrets.set(key, backup[key] || '');
  secrets.set(backupKey, '');
} else {
  if (!secrets.get(backupKey)) secrets.set(backupKey, JSON.stringify(Object.fromEntries(keys.map(key => [key, secrets.get(key)]))));
  if (secrets.get('vela.device') !== privateConfig.device.id) {
    secrets.set('vela.device', privateConfig.device.id);
    secrets.set('vela.session', JSON.stringify(privateConfig.tokens));
  }
  config.server = privateConfig.origin;
  config.user = '';
  config.password = '';
}
require('expo-router/entry');

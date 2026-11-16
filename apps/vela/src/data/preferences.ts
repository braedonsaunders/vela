// Plain preferences natively (the viewer's current channel, say). No plain key-value store is
// linked into the native app, so these few small values sit beside the secrets, under their
// own prefix.
import type { SecretStore } from '@vela/core';
import { secrets } from './secrets';

const PREFIX = 'vela.pref.';

/** Keychain keys allow letters, digits, '.', '-' and '_'; anything else is spelled out in hex. */
const stored = (key: string) => PREFIX + key.replace(/[^A-Za-z0-9.-]/g, c => `_${c.charCodeAt(0).toString(16)}_`);

export const preferences: SecretStore = {
  get: key => secrets.get(stored(key)),
  set: (key, value) => secrets.set(stored(key), value),
};

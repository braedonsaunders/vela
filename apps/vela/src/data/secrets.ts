// Secrets natively: the Keychain on iOS and tvOS, the Keystore on Android, through
// expo-secure-store's synchronous calls. Readable after the first unlock, so a session survives
// a reboot and background work, and never synced to other devices.
import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from '@vela/core';

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const secrets: SecretStore = {
  get: key => SecureStore.getItem(key, OPTIONS),
  set: (key, value) => SecureStore.setItem(key, value, OPTIONS),
};

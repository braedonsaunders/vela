// Plain native preferences use their own prefix in SecureStore. The Apple
// install marker lives in UserDefaults, which is tied to the app container.
import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { SecretStore } from '@vela/core';
import { INSTALL_MARKER } from './install-state';
import { secureStorage } from './secure-storage';

interface AppleInstallStorage {
  isInitialized(): boolean;
  markInitialized(): void;
  containerCreatedAt(): number | null;
  secretUpdatedAt(key: string): number | null;
  removeSecret(key: string): void;
}

export const appleInstallStorage = () => requireNativeModule<AppleInstallStorage>('VelaInstallStorage');

const PREFIX = 'vela.pref.';

/** Keychain keys allow letters, digits, '.', '-' and '_'; anything else is spelled out in hex. */
const stored = (key: string) => PREFIX + key.replace(/[^A-Za-z0-9.-]/g, c => `_${c.charCodeAt(0).toString(16)}_`);

export const preferences: SecretStore = {
  get: key => key === INSTALL_MARKER && Platform.OS === 'ios'
    ? appleInstallStorage().isInitialized() ? '1' : null
    : secureStorage.get(stored(key)),
  set: (key, value) => {
    if (key === INSTALL_MARKER && Platform.OS === 'ios') appleInstallStorage().markInitialized();
    else secureStorage.set(stored(key), value);
  },
};

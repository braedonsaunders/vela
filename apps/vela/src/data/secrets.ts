import { Platform } from 'react-native';
import { appleInstallStorage, preferences } from './preferences';
import { initializeAppleInstall } from './install-state';
import { secureStorage } from './secure-storage';

// React Native reports iOS for both iPhone/iPad and tvOS. Android's Keystore
// keys and the app's SecureStore preferences are cleared by uninstall.
if (Platform.OS === 'ios') initializeAppleInstall(preferences, appleInstallStorage());

export const secrets = secureStorage;

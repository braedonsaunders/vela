// The store's platform natively (iOS, iPadOS, tvOS, Android): the configured Ether server, the
// Keychain/Keystore, this device, and what the native player (libmpv) says it plays.
import { getRandomValues } from 'expo-crypto';
import { Dimensions, PixelRatio, Platform } from 'react-native';
import type { VelaPlatform } from '@vela/core';
import { VelaPlayer } from '@vela/player';
import { config, DEVELOPMENT_SERVER } from './config';
import { secrets } from './secrets';

// Hermes has no Web Crypto; core's IDs and idempotency keys need getRandomValues.
if (!globalThis.crypto?.getRandomValues) {
  const crypto = { ...globalThis.crypto, getRandomValues } as Crypto;
  Object.defineProperty(globalThis, 'crypto', { value: crypto, configurable: true });
}

function device(): VelaPlatform['device'] {
  if (Platform.OS === 'ios') {
    if (Platform.isTV) return { name: 'Apple TV', platform: 'tvos' };
    return Platform.isPad ? { name: 'iPad', platform: 'ipados' } : { name: 'iPhone', platform: 'ios' };
  }
  if (Platform.isTV) return { name: 'Android TV', platform: 'androidtv' };
  return { name: 'Android', platform: 'android' };
}

/** The longer side of the screen in pixels, at most twice its points. */
export function screenArtWidth(): number {
  const { width, height } = Dimensions.get('screen');
  return Math.ceil(Math.max(width, height, 960) * Math.min(2, PixelRatio.get()));
}

export function platform(): VelaPlatform {
  return {
    etherOrigin: config.server || DEVELOPMENT_SERVER,
    secrets,
    device: device(),
    appVersion: config.appVersion,
    media: VelaPlayer.capabilities(),
    mock: config.mock,
    artWidth: screenArtWidth(),
  };
}

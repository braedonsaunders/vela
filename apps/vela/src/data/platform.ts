// The store's platform natively (iOS, iPadOS, tvOS, Android): no implied server in a release (a lab
// build may pin its Ether server), the Keychain/Keystore, this device, and what the native player
// (libmpv) says it plays.
import { getRandomValues } from 'expo-crypto';
import Constants from 'expo-constants';
import { Dimensions, PixelRatio, Platform } from 'react-native';
import type { VelaPlatform } from '@vela/core';
import { VelaPlayer, velaDownloads } from '@vela/player';
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

const PLATFORM_NAMES: Record<VelaPlatform['device']['platform'], string> = {
  ios: 'iOS', ipados: 'iPadOS', tvos: 'Apple TV', android: 'Android', androidtv: 'Android TV',
};

/** The About line's app facts: the version, Android's versionCode (the build a viewer sees in
 * Settings → Apps) and where it runs. */
export function aboutApp(): { version: string; build: string; platform: string } {
  const code = Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode : undefined;
  return { version: config.appVersion, build: code ? String(code) : '', platform: PLATFORM_NAMES[device().platform] ?? '' };
}

/** The longer side of the screen in pixels, at most twice its points and never above 4K. */
export function screenArtWidth(): number {
  const { width, height } = Dimensions.get('screen');
  return Math.min(3840, Math.ceil(Math.max(width, height, 960) * Math.min(2, PixelRatio.get())));
}

export function platform(): VelaPlatform {
  return {
    // A release build is standalone: the viewer adds Ether, Jellyfin, Emby or Plex on Connect. A
    // lab build may still pin its Ether server; a development build defaults to mock-server.
    etherOrigin: config.server || (__DEV__ ? DEVELOPMENT_SERVER : undefined),
    secrets,
    device: device(),
    appVersion: config.appVersion,
    media: VelaPlayer.capabilities(),
    audio: VelaPlayer.audioCapabilities(),
    downloads: velaDownloads,
    mock: config.mock,
    artWidth: screenArtWidth(),
  };
}

/** Native applications do not consume web console handoffs. */
export function listenWebHandoff(_receive: (value: { code?: string; consoleUrl?: string }) => void): () => void {
  return () => {};
}

import { expect, test } from 'bun:test';
import { ANDROID_TV_MINIMUM_FREE_TO_OFFER, nativeDownloadsSupported, nativeDownloadsTraits } from '../src/downloads-traits';

test('tvOS never stores downloads; iPhone, iPad and every Android device do', () => {
  expect(nativeDownloadsSupported('ios', true)).toBe(false);
  expect(nativeDownloadsSupported('ios', false)).toBe(true);
  expect(nativeDownloadsSupported('android', false)).toBe(true);
  expect(nativeDownloadsSupported('android', true)).toBe(true);
  expect(nativeDownloadsSupported('web', false)).toBe(false);
});

test('Android uses its download service, and Android TV offers Download only with room for a film', () => {
  expect(nativeDownloadsTraits('ios', false)).toMatchObject({ engine: 'background', reserveBytes: 2_000_000_000, minimumFreeToOffer: null });
  expect(nativeDownloadsTraits('android', false)).toMatchObject({ engine: 'service', metered: true, minimumFreeToOffer: null });
  expect(nativeDownloadsTraits('android', true).minimumFreeToOffer).toBe(ANDROID_TV_MINIMUM_FREE_TO_OFFER);
  expect(ANDROID_TV_MINIMUM_FREE_TO_OFFER).toBe(6_000_000_000);
});

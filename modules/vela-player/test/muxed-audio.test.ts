import { expect, test } from 'bun:test';
import { muxedAudioTrack } from '../web/engine/muxed-audio';

test('a muxed stream carries the plan\'s selected audio track', () => {
  expect(muxedAudioTrack([{ id: 'en' }, { id: 'fr' }], 'fr')).toBe('fr');
});

test('without a selection, its only track or its one default', () => {
  // Ether's live plan: one AAC stereo track, none named as selected.
  expect(muxedAudioTrack([{ id: '1', default: true }], undefined)).toBe('1');
  expect(muxedAudioTrack([{ id: '1' }], null)).toBe('1');
  expect(muxedAudioTrack([{ id: 'en', default: true }, { id: 'fr' }], null)).toBe('en');
});

test('nothing is reported when the plan cannot say which track it is', () => {
  expect(muxedAudioTrack([], undefined)).toBeNull();
  expect(muxedAudioTrack([{ id: 'en' }, { id: 'fr' }], null)).toBeNull();
  expect(muxedAudioTrack([{ id: 'en', default: true }, { id: 'fr', default: true }], null)).toBeNull();
  // A selection the plan does not list is not trusted either.
  expect(muxedAudioTrack([{ id: 'en' }, { id: 'fr' }], 'de')).toBeNull();
});

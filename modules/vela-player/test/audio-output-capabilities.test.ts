import { expect, test } from 'bun:test';
import { audioOutputCapabilities } from '../web/audio-output';

test('a browser declares decoded PCM only, up to the output device and the engine layouts', () => {
  expect(audioOutputCapabilities(2)).toEqual({ passthrough: [], immersive: [], maxChannels: 2, maxSampleRate: 48000, lossless: true });
  expect(audioOutputCapabilities(6).maxChannels).toBe(6);
  // A 7.1 receiver over HDMI exposes eight channels; wider devices still get 7.1, the widest engine layout.
  expect(audioOutputCapabilities(8).maxChannels).toBe(8);
  expect(audioOutputCapabilities(16).maxChannels).toBe(8);
  expect(audioOutputCapabilities(null).maxChannels).toBe(2);
  expect(audioOutputCapabilities(1).maxChannels).toBe(2);
});

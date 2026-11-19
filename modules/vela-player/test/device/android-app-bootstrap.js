import 'expo/src/Expo.fx';
// Device-only app CPU sampling. Private config is ignored and never distributed.
import { requireNativeModule } from 'expo-modules-core';
import config from './probe-config.json';

if (config.traceLive) {
  const request = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    try {
      const path = new URL(typeof input === 'string' ? input : input.url).pathname;
      if (path.endsWith('/playback') && init?.method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        console.log('[android-live-start]', body.channelId || 'on-demand', body.purpose || 'playback');
      }
    } catch {}
    return request(input, init);
  };
}
if (config.profileCPU) {
  const player = requireNativeModule('VelaPlayer');
  try {
    console.log('[android-capabilities]', JSON.stringify(player.capabilities()));
    console.log('[android-decoders]', JSON.stringify(player.decoderCapabilities()));
  } catch { console.log('[android-capabilities]', 'diagnostics-unavailable'); }
  setTimeout(() => {
    try { player.setCPUProfiling(true); console.log('[android-cpu]', 'started'); }
    catch { console.log('[android-cpu]', 'unavailable'); }
  }, config.profileStartMs || 5000);
  setTimeout(() => {
    try { console.log('[android-cpu-file]', player.setCPUProfiling(false)); }
    catch { console.log('[android-cpu]', 'dump-unavailable'); }
  }, (config.profileStartMs || 5000) + (config.profileDurationMs || 25000));
}
// An owner device keeps its existing account and registry during UI profiling.
if (config.preserveSession) require('expo-router/entry');
else require('./apple-session-bootstrap');

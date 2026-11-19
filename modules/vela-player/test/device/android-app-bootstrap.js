import 'expo/src/Expo.fx';
// Device-only app CPU sampling. Private config is ignored and never distributed.
import { requireNativeModule } from 'expo-modules-core';
import config from './probe-config.json';

if (config.profileCPU) {
  const player = requireNativeModule('VelaPlayer');
  setTimeout(() => {
    try { player.setCPUProfiling(true); console.log('[android-cpu]', 'started'); }
    catch { console.log('[android-cpu]', 'unavailable'); }
  }, config.profileStartMs || 5000);
  setTimeout(() => {
    try { console.log('[android-cpu-file]', player.setCPUProfiling(false)); }
    catch { console.log('[android-cpu]', 'dump-unavailable'); }
  }, (config.profileStartMs || 5000) + (config.profileDurationMs || 25000));
}
require('./apple-session-bootstrap');

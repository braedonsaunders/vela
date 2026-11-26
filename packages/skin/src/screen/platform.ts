// The platform a document's `platforms` variants and `env.platform` read (renderer 20): every device
// is exactly one. A desktop app hosting the web bundle declares itself before the page runs
// (globalThis.__VELA_DESKTOP__, as apps/vela/src/data/platform.web.ts reads it).
import { Platform as RN } from 'react-native';
import type { Platform } from '../../../protocol/skin';
import { platformOf } from './platform-of';

export { foldOpen, platformOf } from './platform-of';

/** This device's platform. */
export function devicePlatform(): Platform {
  const shell = (globalThis as { __VELA_DESKTOP__?: { version?: number } }).__VELA_DESKTOP__;
  return platformOf(RN.OS, RN.isTV === true, shell?.version === 1);
}

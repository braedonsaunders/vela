// This device's render tier (packages/skin device-tier.ts), read once: what the device is does not change
// while the app runs. `lite` is a lighter render of the same look for TV hardware that cannot keep up.
import { Dimensions, PixelRatio, Platform } from 'react-native';
import { deviceProfile } from '@vela/player';
import { deviceFacts, renderTier, type RenderTier } from '@vela/skin/src/device-tier';

let tier: RenderTier | undefined;

export function appRenderTier(): RenderTier {
  if (tier) return tier;
  const screen = Dimensions.get('screen');
  const scale = PixelRatio.get();
  let profile: Record<string, unknown> | null = null;
  try { profile = deviceProfile(); } catch { profile = null; }
  tier = renderTier(deviceFacts(Platform.isTV, profile, { width: Math.round(screen.width * scale), height: Math.round(screen.height * scale) }));
  return tier;
}

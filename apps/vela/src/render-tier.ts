// This device's render tier (packages/skin device-tier.ts), read once: what the device is does not change
// while the app runs. `lite` is a lighter render of the same look for TV hardware that cannot keep up.
import { Dimensions, PixelRatio, Platform } from 'react-native';
import { deviceProfile } from '@vela/player';
import { deviceFacts, renderTier, setLiteRender, type RenderTier } from '@vela/skin/src/device-tier';

let tier: RenderTier | undefined;
/** Measurement builds may force a tier (tools/perf); release builds never set it. */
const FORCED = process.env.EXPO_PUBLIC_VELA_RENDER_TIER;

export function appRenderTier(): RenderTier {
  if (tier) return tier;
  const screen = Dimensions.get('screen');
  const scale = PixelRatio.get();
  let profile: Record<string, unknown> | null = null;
  try { profile = deviceProfile(); } catch { profile = null; }
  const chosen: RenderTier = FORCED === 'lite' || FORCED === 'full' ? FORCED
    : renderTier(deviceFacts(Platform.isTV, profile, { width: Math.round(screen.width * scale), height: Math.round(screen.height * scale) }));
  // The renderer reads it as a process constant (no blurred shadows, transitions, fades or image blurs).
  setLiteRender(chosen === 'lite');
  tier = chosen;
  return chosen;
}

// Temporary memory diagnostics for the Apple TV (Jetsam kills on Cinematic's home, where
// Instruments cannot attach): EXPO_PUBLIC_VELA_SKIN_DISABLE=shadow,motion,mask,image-blur,images
// turns those drawing features off in a build so A/B runs can isolate the cost. Remove once the
// cause is fixed.
const disabled = new Set(
  (process.env.EXPO_PUBLIC_VELA_SKIN_DISABLE ?? '')
    .split(',')
    .map((name: string) => name.trim())
    .filter(Boolean),
);

export type Feature = 'shadow' | 'motion' | 'mask' | 'image-blur' | 'images';

export function drawing(feature: Feature): boolean {
  return !disabled.has(feature);
}

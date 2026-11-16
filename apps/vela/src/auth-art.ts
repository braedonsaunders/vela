// The stage art the signed-out page stands on: the backdrop and wordmark of the server's pack for
// the requested skin. The requested skin is the viewer's own pick, unless they picked nothing or
// the owner forces the default; then it is the server's default skin.
import type { AppearanceModel } from '@vela/core';

export function authArt(appearance: AppearanceModel | undefined, homeDefault: string, picked: string) {
  const fallback = appearance?.defaultSkinId || homeDefault;
  const requested = !picked || appearance?.force ? fallback : picked;
  const pack = appearance?.packs.find(p => p.id === requested);
  return { backdrop: pack?.backdrop ?? '', wordmark: pack?.wordmark ?? '' };
}

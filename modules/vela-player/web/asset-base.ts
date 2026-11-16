// Where the web player's static payload lives: `<base URL>/player/<digest>/` on the app's origin
// (docs/distribution.md, "Player assets and skins"). The digest is fixed at export time from the
// payload export-assets.ts built; Expo inlines both variables into the bundle.
const digest = process.env.EXPO_PUBLIC_VELA_PLAYER_ASSETS ?? '';
const baseURL = (process.env.EXPO_BASE_URL ?? '').replace(/\/+$/, '');

/** The same-origin payload directory, or null when this build was exported without one. */
export function playerAssetBase(): string | null {
  if (!/^[a-f0-9]{64}$/.test(digest)) return null;
  return new URL(`${baseURL}/player/${digest}/`, location.origin).href;
}

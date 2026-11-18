// A skin document's `ui` look where it leaves a key out: Cinematic's values, so a document that
// sets nothing reads like Cinematic. The resolver fills each missing key from here, and the Vela
// base (base.ts) styles itself with these keys as $ui.<name>.
export const uiDefaults = {
  page: '#090b0e',
  raised: '#15191e',
  ink: '#f5f1e9',
  inkSecondary: '#b6b8bb',
  inkQuiet: '#858d98',
  inkInverse: '#111419',
  // An ink-filled control (a primary button) under the pointer; a document that sets ink alone gets its ink.
  inkHover: '#ffffff',
  accent: '#dcb998',
  onAccent: '#111419',
  control: '#ffffff16',
  controlHover: '#ffffff26',
  glass: '#12151bb3',
  glassEdge: '#ffffff1a',
  glassEdgeStrong: '#ffffff33',
  popover: '#111419f5',
  scrim: '#000000bf',
  track: '#ffffff25',
  trackStrong: '#ffffff47',
  focusHalo: '#dcb99833',
  shadow: '#00000099',
  skeleton: '#ffffff0d',
  skeletonLight: '#ffffff12',
  alert: '#c0703f1f',
  live: '#e8513f',
  font: 'system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif',
  fontDisplay: '"Instrument Serif", "Iowan Old Style", Georgia, serif',
  controlHeight: 40,
  controlFontSize: 14,
  radiusControl: 999,
  radiusCard: 14,
  radiusPanel: 28,
} as const;

export type UiTokens = { -readonly [K in keyof typeof uiDefaults]: (typeof uiDefaults)[K] extends number ? number : string };

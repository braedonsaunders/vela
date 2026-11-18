// Cinematic as a skin document. The Vela base (packages/skin/src/resolve/base.ts) is Cinematic's surfaces
// drawn on the ui tokens, and the ui defaults are Cinematic's values, so this document draws
// nothing of its own: it names Cinematic and keeps the bar mask over its home.
import type { SkinDocument } from '../../skin';

export const cinematicDoc: SkinDocument = {
  schema: 1,
  renderer: 15,
  id: 'cinematic-doc',
  name: 'Cinematic',
  version: '1.0.2',
  tagline: 'Vela\'s own look: full-bleed art, serif titles and a ranked Top 10.',
  preview: '/vela/v0/appearance/skins/cinematic-doc/1.0.2/preview.jpg',
  swatches: ['#090b0e', '#f5f1e9', '#dcb998', '#c0703f', '#1f5a6b'],
  // The Vela base's own look: Cinematic's values (packages/skin/src/resolve/ui-defaults.ts).
  ui: {
    page: '#090b0e', raised: '#15191e', ink: '#f5f1e9', inkSecondary: '#b6b8bb', inkQuiet: '#858d98',
    inkInverse: '#111419', inkHover: '#ffffff', accent: '#dcb998', onAccent: '#111419', control: '#ffffff16',
    controlHover: '#ffffff26', glass: '#12151bb3', glassEdge: '#ffffff1a', glassEdgeStrong: '#ffffff33',
    popover: '#111419f5', scrim: '#000000bf', track: '#ffffff25', trackStrong: '#ffffff47',
    focusHalo: '#dcb99833', shadow: '#00000099', skeleton: '#ffffff0d', skeletonLight: '#ffffff12',
    alert: '#c0703f1f', live: '#e8513f',
    font: 'system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif',
    fontDisplay: '"Instrument Serif", "Iowan Old Style", Georgia, serif', radiusControl: 999, radiusCard: 14,
    radiusPanel: 28,
  },
  routes: { live: { type: 'widget', widget: 'guide', style: { flex: '1' }, params: { layout: 'cinematic' } } },
  traits: { barMask: true },
};

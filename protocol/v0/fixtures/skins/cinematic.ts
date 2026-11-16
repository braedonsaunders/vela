// Cinematic as a skin document. The Vela base (client/src/skin/base.ts) is Cinematic's surfaces
// drawn on the ui tokens, and the ui defaults are Cinematic's values, so this document draws
// nothing of its own: it names Cinematic and keeps the bar mask over its home.
import type { SkinDocument } from '../../skin';

export const cinematicDoc: SkinDocument = {
  schema: 1,
  renderer: 15,
  id: 'cinematic-doc',
  name: 'Cinematic (data)',
  version: '1.0.0',
  tagline: 'The official skin, drawn from a skin document.',
  preview: '/vela/v0/appearance/skins/cinematic-doc/1.0.0/preview.jpg',
  swatches: ['#090b0e', '#f5f1e9', '#dcb998', '#c0703f', '#1f5a6b'],
  traits: { barMask: true },
};

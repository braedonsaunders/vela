// The built-in skin documents (the Vela base as Cinematic, and Mochi), the app's own faces the
// Vela base names, and where a document's image paths come from: the app's bundled assets, an
// absolute URL, or a path on the selected server.
import { Platform } from 'react-native';
import type { SkinDocument } from '../../../protocol/v0/skin';
import mochi from '../../../protocol/v0/fixtures/skins/mochi/document';
import { velaBase } from '../../../client/src/skin/base';
import { ASSETS } from './assets.generated';
import { config } from './data/config';

export const DOCUMENTS: SkinDocument[] = [velaBase, mochi as SkinDocument];

/** The app's own faces, which the Vela base's display type names. */
export const APP_FONTS = {
  instrument: {
    family: 'Instrument Serif',
    files: [
      { url: 'assets/fonts/InstrumentSerif-Regular.ttf', weight: 400, style: 'normal' as const },
      { url: 'assets/fonts/InstrumentSerif-Italic.ttf', weight: 400, style: 'italic' as const },
    ],
  },
};

/** The document to start with: `?skin=<id>` on the web, EXPO_PUBLIC_VELA_SKIN in a native build. */
export function initialDocument(): number {
  const web = Platform.OS === 'web' && typeof location !== 'undefined';
  const wanted = web ? new URLSearchParams(location.search).get('skin') : config.skin;
  return Math.max(0, DOCUMENTS.findIndex(doc => doc.id === wanted));
}

/** A document path as an image or font source: a bundled asset, an absolute URL, or the server's path. */
export function assetSource(path: string, serverOrigin: string): string | number | undefined {
  if (!path) return undefined;
  if (ASSETS[path] !== undefined) return ASSETS[path];
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/')) return `${serverOrigin}${path}`;
  return undefined;
}

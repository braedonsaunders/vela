// A document's fonts, loaded at run time, and the face a text node draws with. On the web a
// font stack is handed to the browser as written, after @font-face rules for the document's
// files. Natively a stack resolves to one loaded face (each weight is its own registered name)
// or a system family; iOS and tvOS cannot load WOFF2, so those files are skipped there.
import { Asset } from 'expo-asset';
import * as Font from 'expo-font';
import { Platform, type TextStyle } from 'react-native';
import { splitTop, withTokens } from './css';
import { faceStyle, faceWeight, fontFaceRule } from './font-face';

interface Face { name: string; weight: number | [number, number]; italic: boolean }

const faces = new Map<string, Face[]>();
const web = Platform.OS === 'web';

/** System families the Apple platforms ship, usable by name in a stack. */
const APPLE_FAMILIES = new Set(['georgia', 'iowan old style', 'avenir next', 'avenir', 'helvetica neue', 'menlo', 'courier new', 'palatino', 'times new roman', 'baskerville', 'didot', 'futura', 'gill sans', 'optima', 'american typewriter']);

function weightOf(raw: string): number {
  if (raw === 'bold') return 700;
  if (raw === 'normal' || !raw) return 400;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 400;
}

function unquote(family: string): string {
  return family.trim().replace(/^["']|["']$/g, '');
}

export interface DocumentFont { family: string; files: { url: string; weight: number | string; style: 'normal' | 'italic' }[] }

/** Load every font of a document. `source` turns a document's file path into a URL or a bundled asset. */
export async function loadFonts(fonts: Record<string, DocumentFont> | undefined, source: (path: string) => string | number | undefined): Promise<void> {
  const css: string[] = [];
  const pending: Promise<void>[] = [];
  for (const font of Object.values(fonts ?? {})) {
    const key = font.family.toLowerCase();
    const list = faces.get(key) ?? [];
    for (const file of font.files) {
      // A face whose weight or style is not CSS's own value is not loaded (font-face.ts).
      if (faceWeight(file.weight) === undefined || faceStyle(file.style) === undefined) continue;
      const found = source(file.url);
      if (found === undefined) continue;
      const href = typeof found === 'number' ? Asset.fromModule(found).uri : found;
      const range = String(file.weight).split(/\s+/).map(Number);
      const weight: Face['weight'] = range.length === 2 ? [range[0], range[1]] : range[0] || 400;
      const italic = file.style === 'italic';
      if (web) {
        const rule = fontFaceRule(font.family, href, file.weight, file.style);
        if (rule) css.push(rule);
        continue;
      }
      if (/\.woff2?(\?|$)/i.test(file.url)) continue;
      const name = `${font.family}-${String(file.weight).replace(/\s+/g, '_')}${italic ? '-italic' : ''}`;
      if (list.some(face => face.name === name)) continue;
      list.push({ name, weight, italic });
      pending.push(Font.loadAsync({ [name]: typeof found === 'number' ? found : { uri: href } }).catch(() => {
        list.splice(list.findIndex(face => face.name === name), 1);
      }));
    }
    faces.set(key, list);
  }
  if (web && css.length && typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = css.join('\n');
    document.head.appendChild(style);
  }
  await Promise.all(pending);
}

function nearest(list: Face[], weight: number, italic: boolean): Face | undefined {
  const fits = (face: Face) => (Array.isArray(face.weight) ? weight >= face.weight[0] && weight <= face.weight[1] : face.weight === weight);
  const distance = (face: Face) => (Array.isArray(face.weight) ? 0 : Math.abs(face.weight - weight));
  const styled = list.filter(face => face.italic === italic);
  const pool = styled.length ? styled : list;
  return pool.find(fits) ?? [...pool].sort((a, b) => distance(a) - distance(b))[0];
}

/** The font rows a Text takes for a stack, weight and style. */
export function fontFace(stack: string, weightRaw: string, italic: boolean): TextStyle {
  const weight = weightOf(weightRaw.trim());
  // The web takes any weight; native text takes the nine named steps.
  const fontWeight = String(web ? weight : Math.min(900, Math.max(100, Math.round(weight / 100) * 100))) as TextStyle['fontWeight'];
  const families = splitTop(withTokens(stack), 'comma').map(unquote).filter(Boolean);
  if (web) return families.length ? { fontFamily: families.map(f => (/\s/.test(f) ? JSON.stringify(f) : f)).join(', '), fontWeight } : { fontWeight };
  for (const family of families) {
    const lower = family.toLowerCase();
    const loaded = faces.get(lower);
    if (loaded?.length) {
      const face = nearest(loaded, weight, italic);
      if (face) return { fontFamily: face.name };
    }
    if (Platform.OS === 'ios' && APPLE_FAMILIES.has(lower)) return { fontFamily: family, fontWeight };
    if (lower === 'serif' || lower === 'ui-serif') return { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontWeight };
    if (lower === 'monospace' || lower === 'ui-monospace') return { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight };
    if (/^(system-ui|-apple-system|sans-serif|ui-sans-serif|blinkmacsystemfont)$/.test(lower)) return { fontWeight };
  }
  return { fontWeight };
}

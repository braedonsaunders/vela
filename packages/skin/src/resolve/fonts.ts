// A skin document's fonts (docs/skin-schema.md, "Fonts"): same-origin font files the vela-theme
// view registers under their family names. A document over a limit or with an invalid entry is
// refused, never trimmed.
import type { SkinDocument } from '../../../protocol/skin';

export const MAX_FAMILIES = 8;
export const MAX_FILES_PER_FAMILY = 4;

export interface FontFace {
  family: string;
  url: string;
  weight: string;
  style: 'normal' | 'italic';
  sizeAdjust: number;
}

const FAMILY = /^[A-Za-z0-9 ]{1,48}$/;
const FILE_TYPE = /\.(woff2|woff|ttf|otf)$/;

/** A weight (1 to 1000), or a variable face's range "300 700". */
function validWeight(text: string): boolean {
  const values = text.split(' ');
  if (values.length > 2) return false;
  return values.every(v => /^\d{1,4}$/.test(v) && Number(v) >= 1 && Number(v) <= 1000);
}

function sameOrigin(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const underAssets = url.startsWith('/vela/v0/appearance/') || url.startsWith('/vela/skins/');
  return underAssets && FILE_TYPE.test(url) && !/[?#\\]/.test(url);
}

/** Every face of every family, each checked; `origin` prefixes the same-origin paths. */
export function resolveFonts(doc: SkinDocument, origin: string): FontFace[] {
  const families = Object.entries(doc.fonts ?? {});
  if (families.length > MAX_FAMILIES) {
    throw new Error(`The document has ${families.length} font families; the limit is ${MAX_FAMILIES}`);
  }
  return families.flatMap(([name, font]) => {
    if (!FAMILY.test(font?.family ?? '')) throw new Error(`Font ${name}: family is 1-48 letters, digits or spaces`);
    const files = font.files ?? [];
    if (files.length > MAX_FILES_PER_FAMILY) {
      throw new Error(`Font ${name} has ${files.length} files; the limit is ${MAX_FILES_PER_FAMILY}`);
    }
    const sizeAdjust = font.sizeAdjust === undefined ? 100 : Number(font.sizeAdjust);
    if (!Number.isFinite(sizeAdjust) || sizeAdjust <= 0 || sizeAdjust > 400) {
      throw new Error(`Font ${name}: sizeAdjust is a percentage above 0, at most 400`);
    }
    return files.map((file, i) => {
      if (!sameOrigin(file?.url)) {
        throw new Error(`Font ${name}, file ${i + 1}: a woff2, woff, ttf or otf under /vela/v0/appearance/`);
      }
      const weight = String(file.weight ?? 400).trim();
      if (!validWeight(weight)) throw new Error(`Font ${name}, file ${i + 1}: weight is 1 to 1000, or a range "300 700"`);
      const style = file.style ?? 'normal';
      if (style !== 'normal' && style !== 'italic') throw new Error(`Font ${name}, file ${i + 1}: style is normal or italic`);
      return { family: font.family, url: `${origin}${file.url}`, weight, style, sizeAdjust };
    });
  });
}

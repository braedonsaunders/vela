// The @font-face rule for one of a document's font files (fonts.ts, on the web). The face's weight
// and style must be CSS's own values; the family and source are written as escaped CSS strings,
// so nothing a document writes can end the rule or add another.

/** A weight (1-1000) or a variable range of two, or a keyword. */
const WEIGHT = /^(?:normal|bold|(?:[1-9]\d{0,2}|1000)(?: (?:[1-9]\d{0,2}|1000))?)$/;
const STYLES = new Set(['normal', 'italic', 'oblique']);

/** A font file's weight as CSS writes it, or undefined. */
export function faceWeight(weight: unknown): string | undefined {
  if (typeof weight !== 'number' && typeof weight !== 'string') return undefined;
  const text = String(weight);
  return WEIGHT.test(text) ? text : undefined;
}

/** A font file's style as CSS writes it, or undefined. */
export function faceStyle(style: unknown): 'normal' | 'italic' | 'oblique' | undefined {
  return typeof style === 'string' && STYLES.has(style) ? style as 'normal' | 'italic' | 'oblique' : undefined;
}

/** A CSS string: quotes, backslashes, braces, angle brackets and control characters are escaped. */
export function cssString(text: string): string {
  return `"${text.replace(/["\\{}<>\u0000-\u001f\u007f]/g, ch => `\\${ch.charCodeAt(0).toString(16)} `)}"`;
}

/** The rule for a face, or undefined when its weight or style is not a CSS value. */
export function fontFaceRule(family: string, href: string, weight: unknown, style: unknown): string | undefined {
  const w = faceWeight(weight);
  const s = faceStyle(style);
  if (w === undefined || s === undefined) return undefined;
  return `@font-face{font-family:${cssString(family)};src:url(${cssString(href)});font-weight:${w};font-style:${s};font-display:swap}`;
}

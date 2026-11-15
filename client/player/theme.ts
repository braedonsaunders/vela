// vela-theme: applies one validated runtime skin pack to the page. The build keeps
// every engine colour, family and radius token as a CSS property in the
// `pack=installed` tuple (app.tamber's pack axis); this view redeclares those
// properties in a stylesheet of its own, so the root's `-exact-mode` pin switches
// between the house look and the pack instantly. It writes only values it derives
// from colours, pixel lengths and same-origin font files: never pack-supplied text.

export interface ThemeHandle { theme: true; sheet: HTMLStyleElement; fonts: FontFace[]; json: string; docFonts: FontFace[]; docFontsJson: string }

/** A skin document's font file (src/skin validated it: same-origin, appearance tree, font type). */
interface DocFont { family: string; url: string; weight: string; style: string; sizeAdjust: number }

/** Each engine's palette roles, by the Tamber token whose house value anchors the role. */
const ENGINES: Record<string, { roles: Record<string, string>; prefixes: string[] }> = {
  cinematic: {
    roles: { page: 'surface.page', raised: 'surface.raised', ink: 'ink.primary', inkSecondary: 'ink.secondary', inkQuiet: 'ink.quiet', inkInverse: 'ink.inverse',
      accent: 'brand.warm', ember: 'cinematic.ember', tide: 'cinematic.tide', dusk: 'cinematic.dusk', live: 'cinematic.guide-now' },
    prefixes: ['--x-cinematic-', '--x-surface-', '--x-ink-', '--x-brand-', '--x-media-'],
  },
};
const SELECTOR = '[data-x-modes*="pack=installed"][data-x-modes*="pack=installed"]';
const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
/** How far (RGB distance) a token may sit from a role and still move with it. */
const NEAR = 48;

interface Pack { id: string; origin: string; engine: string; palette: Record<string, string>; tokens: Record<string, string>;
  fonts: { display?: { family: string; sizeAdjust?: number; files: { url: string; weight: number; style: string }[] } }; radius: { card?: number; panel?: number; pill?: number } }

const property = (token: string) => `--x-${token.replace(/[^A-Za-z0-9_-]/g, '-')}`;
const rgb = (hex: string) => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[], alpha = '') => `#${c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}${alpha}`;

/** The engine's house values: the build's own `pack=installed` rules, before any pack. */
function houseValues(own: HTMLStyleElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.ownerNode === own) continue;
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes('pack=installed')) continue;
      for (const name of Array.from(rule.style)) if (name.startsWith('--x-')) out.set(name, rule.style.getPropertyValue(name).trim());
    }
  }
  return out;
}

function declarations(pack: Pack, house: Map<string, string>, fontName: string): string[] {
  const engine = ENGINES[pack.engine];
  if (!engine) return [];
  // Each role's house colour and the pack's replacement for it.
  const roles: { from: number[]; to: number[] }[] = [];
  for (const [role, token] of Object.entries(engine.roles)) {
    const from = HEX.exec(house.get(property(token)) ?? ''), to = HEX.exec(pack.palette[role] ?? '');
    if (from && to) roles.push({ from: rgb(from[1]), to: rgb(to[1]) });
  }
  const out: string[] = [];
  for (const [name, value] of house) {
    if (!engine.prefixes.some(p => name.startsWith(p))) continue;
    const m = HEX.exec(value);
    if (!m) continue;
    const c = rgb(m[1]);
    let best: { from: number[]; to: number[] } | undefined, distance = Infinity;
    for (const r of roles) { const d = Math.hypot(c[0] - r.from[0], c[1] - r.from[1], c[2] - r.from[2]); if (d < distance) { distance = d; best = r; } }
    // A token near a role keeps its offset from it (a raised glass over the page, a hover tint).
    if (best && distance <= NEAR) out.push(`${name}:${toHex(c.map((v, i) => best!.to[i] + v - best!.from[i]), m[2] ?? '')}`);
  }
  for (const [token, colour] of Object.entries(pack.tokens)) {
    const name = property(token);
    if (HEX.test(colour) && house.has(name) && engine.prefixes.some(p => name.startsWith(p))) out.push(`${name}:${colour}`);
  }
  const display = house.get('--x-cinematic-display');
  if (fontName && display) out.push(`--x-cinematic-display:"${fontName}", ${display}`);
  const px = (token: string, v: number | undefined, max: number) => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max && house.has(property(token))) out.push(`${property(token)}:${Math.round(v)}px`);
  };
  px('cinematic.radius-card', pack.radius.card, 48);
  px('cinematic.radius-panel', pack.radius.panel, 48);
  px('cinematic.radius-pill', pack.radius.pill, 999);
  return out;
}

function fontFaces(pack: Pack, name: string): FontFace[] {
  const font = pack.fonts.display;
  if (!font || typeof FontFace !== 'function') return [];
  return font.files.flatMap(f => {
    let url: URL;
    try { url = new URL(f.url, location.href); } catch { return []; }
    // The server's origin, which the data module pinned (the page's own in a release).
    if (url.origin !== pack.origin || !url.pathname.startsWith('/vela/v0/appearance/') || !/\.(woff2|woff|ttf|otf)$/.test(url.pathname)) return [];
    const face = new FontFace(name, `url("${url.href.replace(/["\\]/g, '')}")`, { weight: String(f.weight), style: f.style === 'italic' ? 'italic' : 'normal', display: 'swap', sizeAdjust: `${Math.min(150, Math.max(50, font.sizeAdjust ?? 100))}%` } as FontFaceDescriptors & { sizeAdjust: string });
    document.fonts.add(face);
    void face.load().catch(() => document.fonts.delete(face));
    return [face];
  });
}

/** A skin document's fonts, registered under the families its styles name. */
function documentFonts(handle: ThemeHandle, json: string) {
  if (json === handle.docFontsJson) return;
  handle.docFontsJson = json;
  for (const face of handle.docFonts) document.fonts.delete(face);
  handle.docFonts = [];
  if (!json || typeof FontFace !== 'function') return;
  for (const f of JSON.parse(json) as DocFont[]) {
    let url: URL;
    try { url = new URL(f.url, location.href); } catch { continue; }
    if (!/^[A-Za-z0-9 ]{1,48}$/.test(f.family) || !(url.pathname.startsWith('/vela/v0/appearance/') || url.pathname.startsWith('/vela/skins/')) || !/\.(woff2|woff|ttf|otf)$/.test(url.pathname)) continue;
    const face = new FontFace(f.family, `url("${url.href.replace(/["\\]/g, '')}")`, { weight: String(f.weight), style: f.style === 'italic' ? 'italic' : 'normal', display: 'swap', sizeAdjust: `${Math.min(150, Math.max(50, f.sizeAdjust || 100))}%` });
    document.fonts.add(face);
    void face.load().catch(() => document.fonts.delete(face));
    handle.docFonts.push(face);
  }
}

function apply(handle: ThemeHandle, json: string) {
  const props = JSON.parse(json) as { pack?: string; fonts?: string; keyframes?: string };
  if (props.fonts !== undefined) { documentFonts(handle, props.fonts); return; }
  // A skin document's keyframes: CSS the data module built from validated numbers and lengths.
  if (props.keyframes !== undefined) { handle.sheet.textContent = /^[@a-zA-Z0-9{}:;.%\s,()-]*$/.test(props.keyframes) ? props.keyframes : ''; return; }
  const packJson = props.pack ?? '';
  if (packJson === handle.json) return;
  handle.json = packJson;
  for (const face of handle.fonts) document.fonts.delete(face);
  handle.fonts = [];
  if (!packJson) { handle.sheet.textContent = ''; return; }
  const pack = JSON.parse(packJson) as Pack;
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(pack.id)) { handle.sheet.textContent = ''; return; }
  const fontName = pack.fonts?.display ? `vela-pack-${pack.id}-display` : '';
  handle.fonts = fontName ? fontFaces(pack, fontName) : [];
  const lines = declarations({ ...pack, tokens: pack.tokens ?? {}, radius: pack.radius ?? {}, fonts: pack.fonts ?? {} }, houseValues(handle.sheet), handle.fonts.length ? fontName : '');
  handle.sheet.textContent = lines.length ? `${SELECTOR}{${lines.join(';')}}` : '';
}

export function createTheme(json: string): ThemeHandle {
  const sheet = document.createElement('style');
  sheet.setAttribute('data-vela-pack', '');
  document.head.append(sheet);
  const handle: ThemeHandle = { theme: true, sheet, fonts: [], json: '', docFonts: [], docFontsJson: '' };
  apply(handle, json);
  return handle;
}
export const setTheme = apply;
export function destroyTheme(handle: ThemeHandle) {
  for (const face of [...handle.fonts, ...handle.docFonts]) document.fonts.delete(face);
  handle.sheet.remove();
}

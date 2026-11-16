// A skin document's `ui` block (docs/skin-schema.md, renderer 15): the look of the Vela base,
// the built-in routes every document inherits. Styles name a value as `$ui.<name>`; a key the
// document leaves out takes Cinematic's value (ui-defaults.ts).
import { uiDefaults, type UiTokens } from './ui-defaults';

type UiName = keyof UiTokens;

const COLOUR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([\d\s.,%/a-z-]*\)|[a-z]+)$/;
const FONT = /^[A-Za-z0-9 ,"'-]{1,200}$/;

function isUiName(name: string): name is UiName {
  return Object.prototype.hasOwnProperty.call(uiDefaults, name);
}

function checked(name: UiName, raw: unknown): string | number {
  const fallback = uiDefaults[name];
  if (typeof fallback === 'number') {
    const radius = Number(raw);
    if (!Number.isFinite(radius) || radius < 0 || radius > 9999) {
      throw new Error(`ui.${name} is a radius in px (0 to 9999)`);
    }
    return radius;
  }
  const text = String(raw).trim();
  const ok = name === 'font' || name === 'fontDisplay' ? FONT.test(text) : COLOUR.test(text);
  if (!ok) throw new Error(`ui.${name}: ${text} is not a ${name.startsWith('font') ? 'font stack' : 'colour'}`);
  return text;
}

/** The document's ui block with every key filled, each value checked. */
export function resolveUi(block: Record<string, unknown> | undefined): UiTokens {
  const tokens = { ...uiDefaults } as UiTokens;
  for (const [name, raw] of Object.entries(block ?? {})) {
    if (!isUiName(name)) throw new Error(`Unknown ui key ${name}`);
    (tokens as Record<UiName, string | number>)[name] = checked(name, raw);
  }
  return tokens;
}

/** `$ui.<name>` as a style value: a colour or font as written, a radius in px. */
export function uiValue(tokens: UiTokens, name: string): string {
  if (!isUiName(name)) throw new Error(`Unknown token $ui.${name}`);
  const v = tokens[name];
  return typeof v === 'number' ? `${v}px` : v;
}

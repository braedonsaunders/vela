// A skin document's `ui` block (docs/skin-schema.md, renderer 15): the look of the Vela base,
// the built-in routes every document inherits. Styles name a value as `$ui.<name>`; a key the
// document leaves out takes Cinematic's value (ui-defaults.ts).
import { hexColour, parseColour } from '../screen/colour';
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
    const size = Number(raw);
    const dimension = name === 'controlHeight' || name === 'controlFontSize';
    if (!Number.isFinite(size) || size < (dimension ? 1 : 0) || size > (dimension ? 160 : 9999)) {
      throw new Error(`ui.${name} is a size in px (${dimension ? '1 to 160' : '0 to 9999'})`);
    }
    return size;
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
  // A document that sets its ink but not its hover keeps the ink under the pointer.
  if (block?.ink !== undefined && block.inkHover === undefined) tokens.inkHover = tokens.ink;
  return tokens;
}

/** The card menu covers catalogue content with the skin's popover hue at full opacity. */
export function cardMenuBackground(ui: Pick<UiTokens, 'popover' | 'raised'>): string {
  const popover = parseColour(ui.popover);
  const surface = popover && popover.a > 0 ? popover : parseColour(ui.raised);
  return surface && surface.a > 0 ? hexColour({ ...surface, a: 1 }) : uiDefaults.raised;
}

/** `$ui.<name>` as a style value: a colour or font as written, a radius in px. */
export function uiValue(tokens: UiTokens, name: string): string {
  if (!isUiName(name)) throw new Error(`Unknown token $ui.${name}`);
  const v = tokens[name];
  return typeof v === 'number' ? `${v}px` : v;
}

/** A style value with every `$ui.<name>` filled. */
export function withUi(text: string, tokens: UiTokens): string {
  return text.replace(/\$ui\.([A-Za-z]+)/g, (_, name: string) => uiValue(tokens, name));
}

// The guide's palette, type and geometry, derived from the document's `ui` block so every
// document gets a coherent guide through the Vela base. With Cinematic's values (the defaults)
// it reproduces the compiled Cinematic guide's tokens (cinematic.guide-*).
import { useContext, useMemo } from 'react';
import type { TextStyle } from 'react-native';
import { resolveUi } from '../../resolve/ui';
import type { UiTokens } from '../../resolve/ui-defaults';
import { fontFace } from '../../fonts';
import { HostContext } from '../../host';

/** Genre cues: the data module's tone slots (news, sport, film, kids, factual, drama, comedy,
 * music, lifestyle, other). Fixed hues, so a genre reads the same in every document. */
const TONES = [
  '#5b8def',
  '#3fbf7f',
  '#e0904f',
  '#f2c94c',
  '#45b5b0',
  '#b06ad9',
  '#f07f9c',
  '#d95fd0',
  '#9fbf5a',
  '#8d96a3',
];

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parse(colour: string): Rgba | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(colour.trim());
  if (hex) {
    const h = hex[1]!;
    const full =
      h.length <= 4
        ? h
            .split('')
            .map(x => x + x)
            .join('')
        : h;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(colour.trim());
  if (fn) {
    const [r = 0, g = 0, b = 0, a = 1] = fn[1]!
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r, g, b, a };
  }
  return null;
}

const text = (c: Rgba) =>
  `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 1000) / 1000})`;

/** The colour at an opacity (multiplied with its own). A colour it cannot read stays as written. */
export function alpha(colour: string, amount: number): string {
  const c = parse(colour);
  return c ? text({ ...c, a: c.a * amount }) : colour;
}

/** Part way from one colour to another. */
function mix(from: string, to: string, amount: number): string {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return from;
  const at = (x: number, y: number) => x + (y - x) * amount;
  return text({ r: at(a.r, b.r), g: at(a.g, b.g), b: at(a.b, b.b), a: at(a.a, b.a) });
}

export interface GuideLook {
  ui: UiTokens;
  page: string;
  ink: string;
  inkSecondary: string;
  inkQuiet: string;
  inkInverse: string;
  accent: string;
  onAccent: string;
  /** The broadcast-red now line, live badges and the tile's bug. */
  now: string;
  nowGlow: string;
  aura: string;
  panel: string;
  rail: string;
  railOn: string;
  ruler: string;
  logoTile: string;
  cell: string;
  cellHover: string;
  live: string;
  liveFill: string;
  liveEdge: string;
  past: string;
  hour: string;
  half: string;
  hairline: string;
  edge: string;
  edgeStrong: string;
  control: string;
  controlHover: string;
  glass: string;
  track: string;
  trackStrong: string;
  shadow: string;
  scrimClear: string;
  scrimSoft: string;
  scrimMid: string;
  scrimDeep: string;
  media: string;
  radiusControl: number;
  radiusCell: number;
  radiusPanel: number;
  radiusTile: number;
  /** Body and display faces at a weight. */
  font(weight: number): TextStyle;
  display(): TextStyle;
  tone(slot: number): string;
}

export function guideLook(ui: UiTokens): GuideLook {
  const page = ui.page;
  return {
    ui,
    page,
    ink: ui.ink,
    inkSecondary: ui.inkSecondary,
    inkQuiet: ui.inkQuiet,
    inkInverse: ui.inkInverse,
    accent: ui.accent,
    onAccent: ui.onAccent,
    now: ui.live,
    nowGlow: alpha(ui.live, 0.5),
    aura: alpha(ui.accent, 0.12),
    panel: alpha(mix(page, ui.raised, 0.15), 0.8),
    rail: page,
    railOn: mix(ui.raised, ui.ink, 0.03),
    ruler: alpha(mix(page, ui.raised, 0.35), 0.94),
    logoTile: mix(page, ui.ink, 0.065),
    cell: alpha(ui.ink, 0.065),
    cellHover: alpha(ui.ink, 0.09),
    live: alpha(ui.accent, 0.1),
    liveFill: alpha(ui.accent, 0.055),
    liveEdge: alpha(ui.accent, 0.35),
    past: alpha(page, 0.4),
    hour: alpha(ui.ink, 0.08),
    half: alpha(ui.ink, 0.03),
    hairline: alpha(ui.ink, 0.06),
    edge: ui.glassEdge,
    edgeStrong: ui.glassEdgeStrong,
    control: ui.control,
    controlHover: ui.controlHover,
    glass: alpha(page, 0.9),
    track: ui.track,
    trackStrong: ui.trackStrong,
    shadow: ui.shadow,
    scrimClear: alpha(page, 0),
    scrimSoft: alpha(page, 0.19),
    scrimMid: alpha(page, 0.44),
    scrimDeep: alpha(page, 0.94),
    media: '#000000',
    radiusControl: ui.radiusControl,
    radiusCell: Math.max(8, Math.round(ui.radiusCard * 0.85)),
    radiusPanel: Math.round(ui.radiusPanel * 0.72),
    radiusTile: ui.radiusCard,
    font: weight => fontFace(ui.font, String(weight), false),
    display: () => fontFace(ui.fontDisplay, '400', false),
    tone: slot => (slot >= 0 ? TONES[Math.min(slot, TONES.length - 1)]! : 'transparent'),
  };
}

/** The guide look for the document being drawn (Cinematic's outside a document, e.g. over the player). */
export function useGuideLook(): GuideLook {
  const host = useContext(HostContext);
  const block = host?.doc.document.ui;
  return useMemo(() => guideLook(resolveUi(block)), [block]);
}

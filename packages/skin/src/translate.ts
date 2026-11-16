// Style rows (CSS by name, as documents write them) translated to React Native styles, per the
// style matrix in docs/architecture.md. Box rows become a ViewStyle plus effects the renderer
// draws with extra components (blur, mask, background image, scrolling, grid). Text rows are
// translated where text is drawn, with the inherited rows of every ancestor merged in.
import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import {
  colour,
  length,
  linearGradient,
  points,
  pxText,
  radialGradient,
  splitTop,
  withTokens,
  type LinearGradient,
  type Measure,
  type RadialGradient,
} from './css';
import { fontFace } from './fonts';
import { easing } from './motion';

export type Css = Record<string, string>;

const web = Platform.OS === 'web';

/** Rows a child inherits when it does not set them (CSS inheritance, drawn at text nodes). */
export const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-transform', 'text-align', 'white-space', 'font-variant-numeric', 'text-shadow', 'cursor']);

export interface Effects {
  hidden?: boolean;
  scrollX?: boolean;
  scrollY?: boolean;
  /** A direct child of a vertical scroll box, pinned at its top. */
  sticky?: boolean;
  /** Grid columns, drawn as wrapped rows: a fixed count, or as many as fit at a minimum width. */
  grid?: { count?: number; min?: number; gap: number };
  /** Native backdrop blur radius in points (web uses CSS backdrop-filter directly). */
  backdropBlur?: number;
  /** A masked box that only paints a colour: the mask and colour as one gradient fill (no mask needed). */
  maskedFill?: string;
  /** Native gradient masks (web uses CSS mask-image directly). */
  mask?: LinearGradient;
  radialMask?: RadialGradient;
  /** A url() background image, drawn as a filled image under the content. */
  backgroundUrl?: string;
  /** Image rows: fit and a blur filter, which expo-image draws itself. */
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  imageBlur?: number;
  /** Rows the matrix refuses, for the renderer's one warning per document. */
  unsupported?: string[];
}

export interface Transitions {
  transitionProperty?: string[];
  transitionDuration?: number[];
  transitionDelay?: number[];
  transitionTimingFunction?: ReturnType<typeof easing>[];
}

/** Box rows: the element's own layout and paint. */
export function boxStyle(css: Css, m: Measure): { style: ViewStyle & Transitions; fx: Effects } {
  // CSS flex items shrink by default; React Native's do not. (A route's content never has a fixed
  // height, so its children are not squeezed: CSS would keep them at their content size.)
  const s: Record<string, unknown> = { flexShrink: 1 };
  const fx: Effects = {};
  const transform: Record<string, unknown>[] = [];
  const len = (v: string, axis: 'x' | 'y' = 'x') => length(v, { ...m, axis });
  const refuse = (row: string) => (fx.unsupported ??= []).push(row);

  for (const [row, raw] of Object.entries(css)) {
    const v = raw.trim();
    if (v === '' || INHERITED.has(row)) continue;
    switch (row) {
      case 'display':
        if (v === 'none') fx.hidden = true;
        else if (v === 'grid') fx.grid = { gap: 0, ...fx.grid };
        else if (v === 'block' || v === 'inline' || v === 'contents') refuse(`display: ${v}`);
        break;
      case 'position':
        if (v === 'absolute' || v === 'relative') s.position = v;
        else if (v === 'sticky') { s.position = 'relative'; fx.sticky = true; }
        else refuse(`position: ${v}`);
        break;
      case 'inset': {
        const [t, r = t, b = t, l = r] = splitTop(v, 'space');
        s.top = len(t, 'y'); s.right = len(r); s.bottom = len(b, 'y'); s.left = len(l);
        break;
      }
      case 'top': case 'bottom': s[row] = len(v, 'y'); break;
      case 'left': case 'right': s[row] = len(v); break;
      case 'z-index': s.zIndex = Number(v) || 0; break;
      case 'width': case 'min-width': case 'max-width':
        s[camel(row)] = v === 'auto' ? undefined : len(v);
        break;
      case 'height': case 'min-height': case 'max-height':
        s[camel(row)] = v === 'auto' ? undefined : len(v, 'y');
        break;
      case 'aspect-ratio': {
        const [a, b] = v.split('/').map(Number);
        s.aspectRatio = b ? a / b : a;
        break;
      }
      case 'box-sizing': if (v === 'content-box') refuse('box-sizing: content-box'); break;
      case 'flex': Object.assign(s, flexShorthand(v, m)); break;
      case 'flex-grow': s.flexGrow = Number(v) || 0; break;
      case 'flex-shrink': s.flexShrink = Number(v); break;
      case 'flex-basis': s.flexBasis = v === 'auto' ? undefined : len(v); break;
      case 'flex-direction': s.flexDirection = v; break;
      case 'flex-wrap': s.flexWrap = v; break;
      case 'align-items': case 'align-self': case 'align-content': s[camel(row)] = flexAlign(v); break;
      case 'justify-content': s.justifyContent = flexAlign(v); break;
      case 'gap': {
        const [rg, cg = rg] = splitTop(v, 'space');
        s.rowGap = len(rg, 'y'); s.columnGap = len(cg);
        break;
      }
      case 'row-gap': s.rowGap = len(v, 'y'); break;
      case 'column-gap': s.columnGap = len(v); break;
      case 'grid-template-columns': fx.grid = { gap: 0, ...fx.grid, ...gridColumns(v, m) }; break;
      case 'grid-template-rows': case 'grid-row': case 'grid-column': refuse(row); break;
      case 'margin': case 'padding': {
        const [t, r = t, b = t, l = r] = splitTop(v, 'space');
        const at = (side: string, value: string, axis: 'x' | 'y') => { s[`${row}${side}`] = value === 'auto' ? 'auto' : len(value, axis); };
        at('Top', t, 'y'); at('Right', r, 'x'); at('Bottom', b, 'y'); at('Left', l, 'x');
        break;
      }
      case 'margin-top': case 'margin-bottom': case 'padding-top': case 'padding-bottom':
        s[camel(row)] = v === 'auto' ? 'auto' : len(v, 'y');
        break;
      case 'margin-left': case 'margin-right': case 'padding-left': case 'padding-right':
        s[camel(row)] = v === 'auto' ? 'auto' : len(v);
        break;
      case 'overflow': if (v === 'hidden' || v === 'clip') s.overflow = 'hidden'; else if (v === 'auto' || v === 'scroll') fx.scrollY = true; break;
      case 'overflow-x': if (v === 'auto' || v === 'scroll') fx.scrollX = true; else if (v === 'hidden' || v === 'clip') s.overflow = 'hidden'; break;
      case 'overflow-y': if (v === 'auto' || v === 'scroll') fx.scrollY = true; else if (v === 'hidden' || v === 'clip') s.overflow = 'hidden'; break;
      case 'background-color': s.backgroundColor = colour(v); break;
      case 'background-image': background(v, m, s, fx); break;
      case 'opacity': s.opacity = clampUnit(Number(v)); break;
      case 'border': {
        if (v === 'none' || v === '0') { s.borderWidth = 0; break; }
        const parts = splitTop(v, 'space');
        for (const p of parts) {
          if (/^(solid|dashed|dotted)$/.test(p)) s.borderStyle = p;
          else if (/^(none|hidden|double|groove|ridge|inset|outset)$/.test(p)) continue;
          else if (len(p) !== undefined && !/^[a-z#]/i.test(p)) s.borderWidth = len(p);
          else s.borderColor = colour(p);
        }
        break;
      }
      case 'border-width': s.borderWidth = len(v); break;
      case 'border-style': if (/^(solid|dashed|dotted)$/.test(v)) s.borderStyle = v; break;
      case 'border-color': s.borderColor = colour(v); break;
      case 'border-top-width': case 'border-bottom-width': case 'border-left-width': case 'border-right-width':
        s[camel(row)] = len(v);
        break;
      case 'border-top-color': case 'border-bottom-color': case 'border-left-color': case 'border-right-color':
        s[camel(row)] = colour(v);
        break;
      case 'border-radius': {
        const corners = splitTop(v, 'space').map(c => points(c, { ...m, axis: 'x' }) ?? 0);
        if (corners.length === 1) s.borderRadius = corners[0];
        else {
          const [tl, tr = tl, br = tl, bl = tr] = corners;
          Object.assign(s, { borderTopLeftRadius: tl, borderTopRightRadius: tr, borderBottomRightRadius: br, borderBottomLeftRadius: bl });
        }
        break;
      }
      case 'corner-shape': if (v === 'squircle' && Platform.OS === 'ios') s.borderCurve = 'continuous'; break;
      case 'outline': {
        if (v === 'none' || v === '0') { s.outlineWidth = 0; break; }
        // The platform's own focus ring: the web draws it on this box; native focus has no ring to keep.
        if (v === 'auto') { if (web) s.outlineStyle = 'auto'; break; }
        for (const p of splitTop(v, 'space')) {
          if (/^(solid|dashed|dotted)$/.test(p)) s.outlineStyle = p;
          else if (/^\d/.test(p)) s.outlineWidth = len(p);
          else s.outlineColor = colour(p);
        }
        break;
      }
      case 'outline-style': if (v === 'none') s.outlineWidth = 0; break;
      case 'box-shadow': s.boxShadow = v === 'none' ? undefined : pxText(withTokens(v), m); break;
      case 'filter': {
        if (v === 'none') break;
        const blur = /blur\(([^)]+)\)/.exec(v);
        if (blur) fx.imageBlur = points(blur[1], { ...m, axis: 'x' });
        if (web) {
          s.filter = pxText(v, m);
          break;
        }
        // Natively only brightness and opacity are cheap: other functions render the whole box
        // offscreen, which on a full-screen stage costs hundreds of megabytes on a TV.
        const cheap = splitTop(v, 'space').filter(f => /^(brightness|opacity)\(/.test(f));
        if (cheap.length) s.filter = cheap.join(' ');
        break;
      }
      case 'backdrop-filter': {
        if (v === 'none') break;
        if (web) { s.backdropFilter = pxText(v, m); break; }
        const blur = /blur\(([^)]+)\)/.exec(v);
        if (blur) fx.backdropBlur = points(blur[1], { ...m, axis: 'x' });
        break;
      }
      case 'mask-image': {
        if (v === 'none') break;
        if (web) { s.maskImage = withTokens(v); s.WebkitMaskImage = withTokens(v); break; }
        const linear = linearGradient(v);
        const radial = linear ? undefined : radialGradient(v);
        if (linear) fx.mask = linear;
        else if (radial) fx.radialMask = radial;
        else refuse('mask-image');
        break;
      }
      case 'object-fit': fx.contentFit = v as Effects['contentFit']; break;
      case 'transform-origin': s.transformOrigin = v; break;
      case 'translate': {
        const [x, y = '0px'] = splitTop(v, 'space');
        const tx = len(x), ty = len(y, 'y');
        if (tx !== undefined && tx !== 0) transform.push({ translateX: tx });
        if (ty !== undefined && ty !== 0) transform.push({ translateY: ty });
        break;
      }
      case 'scale': {
        const [x, y = x] = splitTop(v, 'space').map(Number);
        if (x === y) transform.push({ scale: x }); else transform.push({ scaleX: x }, { scaleY: y });
        break;
      }
      case 'rotate': transform.push({ rotate: /deg|turn|rad/.test(v) ? v : `${Number(v)}deg` }); break;
      case 'perspective': transform.unshift({ perspective: points(v, { ...m, axis: 'x' }) ?? 0 }); break;
      case 'transition': Object.assign(s, transitions(v)); break;
      case 'pointer-events': s.pointerEvents = v === 'none' ? 'none' : 'auto'; break;
      case 'animation': break; // Motion presets are applied by the renderer (motion.ts).
      case 'scroll-snap-type': case 'scroll-snap-align': case 'scrollbar-width': case 'scroll-behavior':
      case 'scroll-padding-left': case 'color-scheme': case 'text-overflow': case 'line-clamp':
        break; // Web only, or drawn at text nodes.
      case 'order': break; // Children are reordered by the renderer.
      case '-webkit-text-stroke': refuse(row); break;
      default: break;
    }
  }
  if (transform.length) s.transform = transform;
  // A gradient mask over a plain colour is that colour as a gradient: drawn as a fill, it costs
  // nothing, where a mask renders the box offscreen.
  if ((fx.mask || fx.radialMask) && typeof s.backgroundColor === 'string' && !s.backgroundImage && !fx.backgroundUrl) {
    fx.maskedFill = withTokens(css['mask-image']).replace(/\b(black|#000000|#000)\b/g, s.backgroundColor);
  }
  // A sticky node is pinned at its scroll view's top (the style matrix ignores a non-zero `top`):
  // its offsets are not a relative shift, which would draw it below its own place in flow.
  if (fx.sticky) { delete s.top; delete s.bottom; }
  if (fx.grid && s.columnGap !== undefined) fx.grid.gap = typeof s.columnGap === 'number' ? s.columnGap : 0;
  for (const key of Object.keys(s)) if (s[key] === undefined) delete s[key];
  return { style: s as ViewStyle & Transitions, fx };
}

/** Text rows: the inherited rows of every ancestor with the node's own over them. */
export function textStyle(css: Css, m: Measure): { style: TextStyle; numberOfLines?: number; ellipsize: boolean } {
  const s: Record<string, unknown> = {};
  const fontSize = m.fontSize;
  let numberOfLines: number | undefined;
  let nowrap = false;
  let ellipsize = false;
  for (const [row, raw] of Object.entries(css)) {
    const v = raw.trim();
    if (!v) continue;
    switch (row) {
      case 'color': s.color = colour(v); break;
      case 'font-size': s.fontSize = fontSize; break;
      case 'font-style': s.fontStyle = v === 'italic' ? 'italic' : 'normal'; break;
      case 'line-height': {
        if (v === 'normal') break;
        const unitless = /^\d*\.?\d+$/.test(v);
        s.lineHeight = unitless ? Number(v) * fontSize : points(v, { ...m, axis: 'y' }, fontSize);
        break;
      }
      case 'letter-spacing': if (v !== 'normal') s.letterSpacing = points(v, { ...m, axis: 'x' }, fontSize); break;
      case 'text-transform': if (/^(none|uppercase|lowercase|capitalize)$/.test(v)) s.textTransform = v; break;
      case 'text-align': s.textAlign = v === 'start' ? 'left' : v === 'end' ? 'right' : v; break;
      case 'white-space': nowrap = v === 'nowrap' || v === 'pre'; break;
      case 'text-overflow': ellipsize = v === 'ellipsis'; break;
      case 'line-clamp': numberOfLines = Number(v) || undefined; break;
      case 'font-variant-numeric': if (v.includes('tabular-nums')) s.fontVariant = ['tabular-nums']; break;
      case 'text-shadow': Object.assign(s, textShadow(v, m)); break;
      case 'cursor': if (web) s.cursor = v; break;
      default: break;
    }
  }
  Object.assign(s, fontFace(css['font-family'] ?? '', css['font-weight'] ?? '400', css['font-style'] === 'italic'));
  if (numberOfLines === undefined && nowrap) numberOfLines = 1;
  for (const key of Object.keys(s)) if (s[key] === undefined) delete s[key];
  return { style: s as TextStyle, numberOfLines, ellipsize: ellipsize || numberOfLines !== undefined };
}

/** The computed font size in points for a font-size row, against the parent's. */
export function fontSizeOf(raw: string | undefined, parent: number, m: Measure): number {
  if (!raw) return parent;
  const v = raw.trim();
  if (v.endsWith('%')) return (parseFloat(v) / 100) * parent;
  return points(v, { ...m, fontSize: parent, axis: 'x' }) ?? parent;
}

function camel(row: string): string {
  return row.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function clampUnit(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function flexAlign(v: string): string {
  if (v === 'start' || v === 'flex-start') return 'flex-start';
  if (v === 'end' || v === 'flex-end') return 'flex-end';
  if (v === 'normal') return 'stretch';
  return v;
}

function flexShorthand(v: string, m: Measure): ViewStyle {
  if (v === 'none') return { flexGrow: 0, flexShrink: 0 };
  if (v === 'auto') return { flexGrow: 1, flexShrink: 1 };
  const [grow, shrink, basis] = splitTop(v, 'space');
  const g = Number(grow);
  if (!Number.isFinite(g)) return {};
  const style: { flexGrow: number; flexShrink: number; flexBasis?: ViewStyle['flexBasis'] } = { flexGrow: g, flexShrink: shrink !== undefined && Number.isFinite(Number(shrink)) ? Number(shrink) : 1 };
  const b = basis ?? (shrink !== undefined && !Number.isFinite(Number(shrink)) ? shrink : '0%');
  if (b !== 'auto') style.flexBasis = length(b, { ...m, axis: 'x' }) as ViewStyle['flexBasis'];
  return style;
}

function gridColumns(v: string, m: Measure): { count?: number; min?: number } {
  const fill = /^repeat\(\s*(auto-fill|auto-fit)\s*,\s*minmax\(\s*([^,]+),/.exec(v);
  if (fill) return { min: points(fill[2], { ...m, axis: 'x' }) ?? 160 };
  const fixed = /^repeat\(\s*(\d+)\s*,/.exec(v);
  if (fixed) return { count: Number(fixed[1]) };
  return { count: splitTop(v, 'space').length };
}

function background(v: string, m: Measure, s: Record<string, unknown>, fx: Effects): void {
  if (v === 'none') return;
  const layers = splitTop(v, 'comma');
  const gradients: string[] = [];
  for (const layer of layers) {
    const url = /^url\((['"]?)(.*)\1\)$/.exec(layer);
    if (url) fx.backgroundUrl = url[2];
    else if (/gradient\(/.test(layer)) gradients.push(pxText(withTokens(layer), m));
  }
  if (gradients.length) s.backgroundImage = gradients.join(', ');
}

function textShadow(v: string, m: Measure): TextStyle {
  if (v === 'none') return {};
  const first = splitTop(v, 'comma')[0];
  const parts = splitTop(first, 'space');
  const lengths = parts.filter(p => /^-?\d/.test(p)).map(p => points(p, { ...m, axis: 'x' }) ?? 0);
  const color = parts.find(p => !/^-?\d/.test(p));
  return {
    textShadowOffset: { width: lengths[0] ?? 0, height: lengths[1] ?? 0 },
    textShadowRadius: lengths[2] ?? 0,
    textShadowColor: color ? colour(color) : 'rgba(0,0,0,0.5)',
  };
}

/** `opacity 420ms cubic-bezier(...), scale 360ms ease` as Reanimated CSS transition arrays. */
function transitions(v: string): Transitions {
  if (v === 'none') return {};
  const property: string[] = [], duration: number[] = [], delay: number[] = [], timing: ReturnType<typeof easing>[] = [];
  for (const item of splitTop(v, 'comma')) {
    const parts = splitTop(item, 'space');
    const times = parts.filter(p => /^-?\d*\.?\d+m?s$/.test(p)).map(p => (p.endsWith('ms') ? parseFloat(p) : parseFloat(p) * 1000));
    const name = parts.find(p => /^[a-z-]+$/.test(p) && !/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/.test(p)) ?? 'all';
    const curve = parts.find(p => /^(ease|ease-in|ease-out|ease-in-out|linear)$/.test(p) || p.startsWith('cubic-bezier('));
    property.push(transitionProperty(name));
    duration.push(times[0] ?? 0);
    delay.push(times[1] ?? 0);
    timing.push(easing(curve));
  }
  return { transitionProperty: property, transitionDuration: duration, transitionDelay: delay, transitionTimingFunction: timing };
}

function transitionProperty(name: string): string {
  if (name === 'scale' || name === 'translate' || name === 'rotate' || name === 'transform') return 'transform';
  if (name === 'all') return 'all';
  return camel(name);
}

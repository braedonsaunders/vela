// Mochi, as a skin document (protocol/v0/skin.ts, docs/skin-schema.md): the anime skin.
// Pastel pink paper with a dot pattern, sticker cards with hard pastel shadows that hop
// in and tilt toward the viewer, pixel-art icons and type, and Mochi, a round rice-cake
// friend who floats over the search box and hops while things load. Every value is the
// compiled skin's (client/skins/mochi until it is deleted), so both draw the same pixels.
// Fonts: Pixelify Sans and Fredoka, SIL Open Font License 1.1 (licences/).
import type { Action, Condition, Node, SkinDocument, Style } from '../../../skin';

const id = 'mochi', version = '1.0.0';
const asset = (file: string) => `/vela/v0/appearance/skins/${id}/${version}/${file}`;

// ---------------------------------------------------------------- look

const fredoka = 'Fredoka, ui-rounded, system-ui, sans-serif';
const pixelFace = '"Pixelify Sans", ui-monospace, monospace';
const boing = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const settle = 'cubic-bezier(0.22, 1, 0.36, 1)';
// Hover and focus lift on cards and controls; under reduced motion only the shadow moves.
const lift = `translate 380ms ${boing}, rotate 380ms ${boing}, scale 380ms ${boing}, box-shadow 260ms ${settle}`;
const liftStill = 'box-shadow 160ms linear';
const ring = '0px 0px 0px 3px $card, 0px 0px 0px 6px $focus';

const Pixel: Style = { 'font-family': pixelFace, 'font-weight': '600', 'letter-spacing': '0.02em' };
const Title: Style = { 'font-family': 'Fredoka, ui-rounded, "SF Pro Rounded", system-ui, sans-serif', 'font-weight': '650', 'letter-spacing': '-0.01em', 'line-height': '1.02' };
const Label: Style = { 'font-family': pixelFace, 'font-size': '12px', 'font-weight': '600', 'letter-spacing': '0.08em', 'text-transform': 'uppercase' };
// Surfaces (look.contract): a candy (pink) and a puffy (white) pill, a round bubble.
// Exact boxes are content-box unless they say otherwise: a 54px candy with its 3px edge is 60px.
const Candy: Style = { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'content-box', border: '3px solid $ink', 'border-radius': '999px', 'background-color': '$pink', color: '$ink', 'font-family': fredoka, 'font-weight': '650', 'box-shadow': '0px 4px 0px $ink', cursor: 'pointer' };
const Puffy: Style = { ...Candy, 'background-color': '$card', 'font-weight': '600' };
const Bubble: Style = { position: 'relative', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', border: '2.5px solid $ink', 'border-radius': '999px', 'background-color': '$card', color: '$ink', cursor: 'pointer', 'flex-shrink': '0' };
// Renderer 11 fields (pressed overlay, aria-controls/busy, replay on press) arrive as spreads
// until protocol/v0/skin.ts types them.
const press94 = { scale: '0.94' };
const pending = (fields: Record<string, unknown>) => fields as object;
const active = (style: Style) => pending({ active: style });
const candy = { hover: { 'background-color': '$pink-hover' }, focus: { 'box-shadow': ring }, active: press94 };
const puffy = { hover: { 'background-color': '$lavender-soft' }, focus: { 'box-shadow': ring }, active: press94 };
const bubble = { hover: { 'background-color': '$pink-wash' }, focus: { 'box-shadow': ring }, active: { scale: '0.9' } };

const inset0: Style = { position: 'absolute', top: '0px', right: '0px', bottom: '0px', left: '0px' };
const fill: Style = { ...inset0, width: '100%', height: '100%', 'object-fit': 'cover' };
const fadeIn: Style = { ...fill, transition: `opacity 360ms ${settle}` };
const gutter: Style = { 'padding-left': 'max(24px, 3.6vw)', 'padding-right': 'max(24px, 3.6vw)' };
const gutterSmall: Style = { 'padding-left': '16px', 'padding-right': '16px' };
const sz = (w: number, h = w): Style => ({ width: `${w}px`, height: `${h}px`, 'flex-shrink': '0' });
const row: Style = { display: 'flex', 'flex-direction': 'row' };
const col: Style = { display: 'flex', 'flex-direction': 'column' };
// The shell recomposes under 720 px (compiled `compact`), routes under 640 (`small`).
const COMPACT = '720';

const is = (test: string, value: string): Condition => ({ test, is: 'eq', value });
const not = (test: string): Condition => ({ test, not: true });
const set = (test: string): Condition => ({ test });
const stillC: Condition = set('env.still');
const moving: Condition = not('env.still');

// Accents come from the name, so neighbours differ without reordering (compiled `accent`:
// name length % 3 is pink, lavender or mint; `tilt`: % 2 leans left or right).
const ACCENTS = ['pink', 'lavender', 'mint'] as const;
type Accent = typeof ACCENTS[number];
const mod = (ctx: string, n: number, r: number): Condition => ({ test: `${ctx}.nameLength`, is: 'mod', value: `${n}:${r}` });
const byAccent = (ctx: string, make: (a: Accent) => Node): Node[] =>
  ACCENTS.map((a, i) => { const n = make(a); return { ...n, when: [...(n.when ?? []), mod(ctx, 3, i)] } as Node; });
// Our own copy's accent (section headings): the English label's length, as compiled.
const accentOf = (text: string): Accent => ACCENTS[text.length % 3];

type Extra = Partial<Node> & { style?: Style };
// The pixel-art icons (nine by nine), as path data painted in the current colour.
const PIXEL: Record<string, string> = {
  alert: 'M4 0h1v1h-1zM3 1h3v1h-3zM3 2h1v1h-1zM5 2h1v1h-1zM2 3h2v1h-2zM5 3h2v1h-2zM2 4h2v1h-2zM5 4h2v1h-2zM1 5h7v1h-7zM1 6h3v1h-3zM5 6h3v1h-3zM0 7h9v1h-9z',
  back: 'M5 0h2v1h-2zM4 1h3v1h-3zM3 2h3v1h-3zM2 3h3v1h-3zM1 4h3v1h-3zM2 5h3v1h-3zM3 6h3v1h-3zM4 7h3v1h-3zM5 8h2v1h-2z',
  check: 'M8 0h1v1h-1zM7 1h2v1h-2zM6 2h2v1h-2zM0 3h1v1h-1zM5 3h2v1h-2zM0 4h2v1h-2zM4 4h2v1h-2zM1 5h4v1h-4zM2 6h2v1h-2z',
  close: 'M0 0h2v1h-2zM7 0h2v1h-2zM0 1h3v1h-3zM6 1h3v1h-3zM1 2h3v1h-3zM5 2h3v1h-3zM2 3h5v1h-5zM3 4h3v1h-3zM2 5h5v1h-5zM1 6h3v1h-3zM5 6h3v1h-3zM0 7h3v1h-3zM6 7h3v1h-3zM0 8h2v1h-2zM7 8h2v1h-2z',
  ffwd: 'M0 1h1v1h-1zM4 1h1v1h-1zM0 2h2v1h-2zM4 2h2v1h-2zM0 3h3v1h-3zM4 3h3v1h-3zM0 4h8v1h-8zM0 5h3v1h-3zM4 5h3v1h-3zM0 6h2v1h-2zM4 6h2v1h-2zM0 7h1v1h-1zM4 7h1v1h-1z',
  forward: 'M2 0h2v1h-2zM2 1h3v1h-3zM3 2h3v1h-3zM4 3h3v1h-3zM5 4h3v1h-3zM4 5h3v1h-3zM3 6h3v1h-3zM2 7h3v1h-3zM2 8h2v1h-2z',
  full: 'M0 0h3v1h-3zM6 0h3v1h-3zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM8 2h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h1v1h-1zM8 7h1v1h-1zM0 8h3v1h-3zM6 8h3v1h-3z',
  grid: 'M1 0h3v1h-3zM5 0h3v1h-3zM1 1h3v1h-3zM5 1h3v1h-3zM1 2h3v1h-3zM5 2h3v1h-3zM1 4h3v1h-3zM5 4h3v1h-3zM1 5h3v1h-3zM5 5h3v1h-3zM1 6h3v1h-3zM5 6h3v1h-3z',
  heart: 'M1 1h2v1h-2zM6 1h2v1h-2zM0 2h4v1h-4zM5 2h4v1h-4zM0 3h9v1h-9zM0 4h9v1h-9zM1 5h7v1h-7zM2 6h5v1h-5zM3 7h3v1h-3zM4 8h1v1h-1z',
  home: 'M4 0h1v1h-1zM3 1h3v1h-3zM2 2h5v1h-5zM1 3h7v1h-7zM0 4h9v1h-9zM1 5h7v1h-7zM1 6h3v1h-3zM5 6h3v1h-3zM1 7h3v1h-3zM5 7h3v1h-3zM1 8h3v1h-3zM5 8h3v1h-3z',
  layers: 'M4 0h1v1h-1zM2 1h2v1h-2zM5 1h2v1h-2zM0 2h2v1h-2zM7 2h2v1h-2zM2 3h2v1h-2zM5 3h2v1h-2zM0 4h1v1h-1zM4 4h1v1h-1zM8 4h1v1h-1zM1 5h2v1h-2zM6 5h2v1h-2zM3 6h3v1h-3z',
  lock: 'M2 0h5v1h-5zM1 1h2v1h-2zM6 1h2v1h-2zM1 2h2v1h-2zM6 2h2v1h-2zM0 3h9v1h-9zM0 4h9v1h-9zM0 5h4v1h-4zM5 5h4v1h-4zM0 6h4v1h-4zM5 6h4v1h-4zM0 7h9v1h-9z',
  mute: 'M4 0h1v1h-1zM3 1h2v1h-2zM0 2h5v1h-5zM6 2h1v1h-1zM8 2h1v1h-1zM0 3h5v1h-5zM7 3h1v1h-1zM0 4h5v1h-5zM6 4h1v1h-1zM8 4h1v1h-1zM0 5h5v1h-5zM3 6h2v1h-2zM4 7h1v1h-1z',
  out: 'M0 0h4v1h-4zM0 1h1v1h-1zM0 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM2 3h7v1h-7zM0 4h1v1h-1zM5 4h1v1h-1zM0 5h1v1h-1zM0 6h4v1h-4z',
  pause: 'M2 1h2v1h-2zM6 1h2v1h-2zM2 2h2v1h-2zM6 2h2v1h-2zM2 3h2v1h-2zM6 3h2v1h-2zM2 4h2v1h-2zM6 4h2v1h-2zM2 5h2v1h-2zM6 5h2v1h-2zM2 6h2v1h-2zM6 6h2v1h-2zM2 7h2v1h-2zM6 7h2v1h-2z',
  phone: 'M2 0h5v1h-5zM2 1h1v1h-1zM6 1h1v1h-1zM2 2h1v1h-1zM6 2h1v1h-1zM2 3h1v1h-1zM6 3h1v1h-1zM2 4h1v1h-1zM6 4h1v1h-1zM2 5h1v1h-1zM6 5h1v1h-1zM2 6h2v1h-2zM5 6h2v1h-2zM2 7h5v1h-5z',
  pip: 'M0 0h9v1h-9zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM4 3h3v1h-3zM8 3h1v1h-1zM0 4h1v1h-1zM4 4h3v1h-3zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h9v1h-9z',
  play: 'M1 1h2v1h-2zM1 2h4v1h-4zM1 3h6v1h-6zM1 4h7v1h-7zM1 5h6v1h-6zM1 6h4v1h-4zM1 7h2v1h-2z',
  rewind: 'M4 1h1v1h-1zM8 1h1v1h-1zM3 2h2v1h-2zM7 2h2v1h-2zM2 3h3v1h-3zM6 3h3v1h-3zM1 4h8v1h-8zM2 5h3v1h-3zM6 5h3v1h-3zM3 6h2v1h-2zM7 6h2v1h-2zM4 7h1v1h-1zM8 7h1v1h-1z',
  search: 'M1 0h4v1h-4zM0 1h1v1h-1zM5 1h1v1h-1zM0 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM5 3h1v1h-1zM0 4h1v1h-1zM5 4h1v1h-1zM1 5h4v1h-4zM5 6h2v1h-2zM6 7h2v1h-2zM7 8h2v1h-2z',
  sliders: 'M1 0h2v1h-2zM0 1h9v1h-9zM1 2h2v1h-2zM6 4h2v1h-2zM0 5h9v1h-9zM6 6h2v1h-2z',
  sort: 'M2 0h1v1h-1zM1 1h3v1h-3zM0 2h5v1h-5zM2 3h1v1h-1zM5 3h1v1h-1zM2 4h1v1h-1zM5 4h1v1h-1zM2 5h1v1h-1zM5 5h1v1h-1zM4 6h5v1h-5zM5 7h3v1h-3zM6 8h1v1h-1z',
  sparkle: 'M4 0h1v1h-1zM4 1h1v1h-1zM4 2h1v1h-1zM3 3h3v1h-3zM0 4h9v1h-9zM3 5h3v1h-3zM4 6h1v1h-1zM4 7h1v1h-1zM4 8h1v1h-1z',
  speaker: 'M4 0h1v1h-1zM3 1h2v1h-2zM7 1h1v1h-1zM0 2h5v1h-5zM8 2h1v1h-1zM0 3h5v1h-5zM6 3h1v1h-1zM8 3h1v1h-1zM0 4h5v1h-5zM6 4h1v1h-1zM8 4h1v1h-1zM0 5h5v1h-5zM8 5h1v1h-1zM3 6h2v1h-2zM7 6h1v1h-1zM4 7h1v1h-1z',
  star: 'M4 0h1v1h-1zM4 1h1v1h-1zM3 2h3v1h-3zM0 3h9v1h-9zM1 4h7v1h-7zM2 5h5v1h-5zM2 6h2v1h-2zM5 6h2v1h-2zM1 7h2v1h-2zM6 7h2v1h-2zM1 8h1v1h-1zM7 8h1v1h-1z',
  tv: 'M1 0h1v1h-1zM7 0h1v1h-1zM2 1h1v1h-1zM6 1h1v1h-1zM3 2h1v1h-1zM5 2h1v1h-1zM0 3h9v1h-9zM0 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h9v1h-9zM1 8h1v1h-1zM7 8h1v1h-1z',
};
const icon = (name: string, size: number, colour?: string, extra: Extra = {}): Node =>
  ({ type: 'icon', paths: [PIXEL[name]], viewBox: '0 0 9 9', ...extra, style: { ...sz(size), ...(colour ? { color: `$${colour}` } : {}), ...(extra.style ?? {}) } } as Node);
// Mochi: happy, wow, sleepy (nothing here yet) and sad (something went wrong).
const mascot = (mood: string, size: number, extra: Extra = {}): Node =>
  ({ type: 'image', src: asset(`mascot-${mood}.svg`), alt: '', ...extra, style: { ...sz(size, size * 0.9), ...(extra.style ?? {}) } } as Node);
// A pixel sparkle that twinkles in place (look.contract Twinkle).
const twinkle = (colour: string, size: number, extra: Extra = {}): Node => icon('sparkle', size, colour, { motion: 'twinkle', ...extra });

// Mochi hopping with a squash over a shadow that breathes with it (look.contract Hopper).
const hopper = (size: number, mood = 'happy'): Node => ({ type: 'box', style: { ...col, position: 'relative', width: `${size}px`, height: `${size * 1.32}px`, 'justify-content': 'flex-end', 'align-items': 'center', 'flex-shrink': '0' }, children: [
  { type: 'box', motion: 'hopShadow', style: { position: 'absolute', bottom: '0px', width: `${size * 0.7}px`, height: `${size * 0.12}px`, 'border-radius': '50%', 'background-color': '$shadow-soft' } },
  mascot(mood, size, { motion: 'hopBounce', style: { position: 'relative', 'margin-bottom': `${size * 0.06}px`, 'transform-origin': '50% 100%' } }),
] });
// Sparkles flying out from a point when something is chosen (look.contract Burst): drawn
// afresh on every press, never before the first; nothing under reduced motion.
const burst: Node = { type: 'box', replayOnPress: true, when: [moving], style: { ...col, position: 'absolute', left: '50%', top: '40%', width: '0px', height: '0px', 'pointer-events': 'none', 'z-index': '4' },
  children: [0, 50, 105, 160, 215, 265, 315].map((a, i) => ({ type: 'box', style: { position: 'absolute', left: '-6px', top: '-6px', rotate: `${a}` }, children: [
    icon(i % 2 === 0 ? 'sparkle' : 'star', 12, ['pink', 'butter', 'mint'][i % 3], { motion: 'burst' }),
  ] } as Node)) } as Node;
// The loading line: Mochi hopping above a caption with a blinking pixel cursor.
const loader = (message: string, size: number): Node => ({ type: 'box', role: 'status', label: message, style: { ...col, 'align-items': 'center', gap: '14px' }, children: [
  hopper(size),
  { type: 'box', style: { ...row, gap: '4px', 'align-items': 'center' }, children: [
    { type: 'text', text: message, style: { ...Pixel, 'font-size': '15px', color: '$ink-soft' } },
    { type: 'box', motion: 'blink', style: { ...sz(8, 14), 'background-color': '$pink' } },
  ] },
] });

// A designed moment for empty results and failures: Mochi under a speech bubble.
const emptyState = (mood: string, title: string, message: string): Node => ({ type: 'box', role: 'status', motion: 'pop60', style: { ...col, 'align-items': 'center', 'text-align': 'center', gap: '12px', padding: '44px 24px 64px' }, children: [
  { type: 'box', style: { ...col, position: 'relative', 'align-items': 'center' }, children: [
    { type: 'box', style: { padding: '12px 22px', 'border-radius': '24px', border: '3px solid $ink', 'background-color': '$card', 'box-shadow': '5px 5px 0px $shadow-pink' }, children: [
      { type: 'text', text: title, style: { ...Title, 'font-size': '26px' } },
    ] },
    { type: 'image', src: asset('tail-down.svg'), alt: '', style: { ...sz(24, 14), 'margin-top': '-3px' } },
  ] },
  mascot(mood, 86, { motion: 'float32' }),
  ...(message ? [{ type: 'text', text: message, style: { 'font-size': '15px', color: '$ink-soft', 'line-height': '1.55', 'max-width': '26rem' } } as Node] : []),
] });

// ---------------------------------------------------------------- shell

// The Vela mark redrawn in outlined pixels, beside the name in pixel type.
const wordmark = (size: number): Node[] => [
  { type: 'image', src: asset('vela-mark.svg'), alt: '', style: sz(size * 1.05) },
  { type: 'text', text: '{s:vela}', style: { 'font-family': pixelFace, 'font-weight': '700', 'font-size': `${size}px`, 'line-height': '1', 'letter-spacing': '0.04em', color: '$ink', 'text-shadow': '3px 3px 0px $pink-soft' } },
];

// A destination pill (slots.contract NavItem): the current one is a pink candy whose
// pixel icon wiggles in; on phones every pill is a white sticker.
const pillBase: Style = { ...row, position: 'relative', gap: '8px', 'align-items': 'center', 'flex-shrink': '0', height: '42px', 'box-sizing': 'content-box', padding: '0px 16px',
  border: '2.5px solid $page-clear', 'border-radius': '999px', 'background-color': '$page-clear', 'box-shadow': 'none', color: '$ink', 'font-family': fredoka, cursor: 'pointer', transition: 'background-color 160ms linear, box-shadow 160ms linear' };
const pillOn: Style = { ...pillBase, 'border-color': '$ink', 'background-color': '$pink', 'box-shadow': '0px 3px 0px $ink' };
// Compact pills all wear the ink edge and shadow; only the current one is pink.
const pillCompact: Style = { height: '38px', 'border-color': '$ink', 'box-shadow': '0px 3px 0px $ink' };
const compactC: Condition = { test: 'env.width', is: 'lt', value: COMPACT };
const navItem = (label: string, iconName: (on: Condition[]) => Node[], on: Condition[], press: { action: 'home' | 'live' | 'library'; arg?: string }, extra: Extra = {}): Node => ({ type: 'box', press, label, testId: `nav-${label}`, ...extra,
  style: pillBase, below: { [COMPACT]: pillCompact }, states: [{ when: on, style: pillOn }, { when: [compactC], style: { ...pillBase, 'background-color': '$card' } }], a11y: { current: on }, hover: { 'border-color': '$ink' }, focus: { 'box-shadow': ring }, ...active(press94), children: [
    ...iconName(on),
    { type: 'text', text: label, style: { 'font-size': '15px', 'font-weight': '550', 'white-space': 'nowrap' }, states: [{ when: on, style: { 'font-size': '15px', 'font-weight': '650', 'white-space': 'nowrap' } }] },
  ] } as Node);
// The icon is drawn fresh when its pill comes on, so it wiggles in.
const navIcon = (name: string, when: Condition[] = []) => (on: Condition[]): Node[] => [
  icon(name, 13, 'ink', { when: [...when, ...on], motion: 'wiggle' }),
  ...on.map(c => icon(name, 13, 'ink-soft', { when: [...when, { ...c, not: !c.not }] })),
];
// Library icons by kind, exactly as the compiled skin chooses them.
const libIcon = (on: Condition[]): Node[] => [
  ...navIcon('layers', [is('dest.kind', 'show')])(on),
  ...navIcon('star', [is('dest.kind', 'movie')])(on),
  ...navIcon('grid', [{ test: 'dest.kind', is: 'ne', value: 'show' }, { test: 'dest.kind', is: 'ne', value: 'movie' }])(on),
];
// Home, the server's libraries in order (a live library opens the guide), and Live when
// the server offers it without a live library.
// Hidden on a compact bar (a repeat's own fields do not reach its item, so its item is hidden).
const hideCompact = (n: Node): Node => n.type === 'repeat' ? { ...n, item: hideCompact(n.item) }
  : { ...n, below: { ...(n.below ?? {}), [COMPACT]: { ...(n.below?.[COMPACT] ?? {}), display: 'none' } } } as Node;
const destinations = (): Node[] => [
  navItem('{s:home}', navIcon('home'), [is('env.section', 'home')], { action: 'home' }),
  // One entry per library in server order: a live library opens Live TV.
  { type: 'repeat', over: 'nav.destinations', item: { type: 'box', style: { display: 'contents' }, children: [
    navItem('{dest.name}', navIcon('tv'), [is('env.section', 'live')], { action: 'live' }, { when: [is('dest.kind', 'live'), set('env.canLive')] }),
    navItem('{dest.name}', libIcon, [set('dest.on')], { action: 'library', arg: '{dest.id}' }, { when: [{ test: 'dest.kind', is: 'ne', value: 'live' }] }),
  ] } },
  navItem('{s:live}', navIcon('tv'), [is('env.section', 'live')], { action: 'live' }, { when: [set('env.canLive'), not('env.hasLiveLibrary')] }),
];

// The speech bubble under the search button (look.contract SpeechBubble, side "below"):
// shown on hover or focus, never over the open menu or on a compact bar.
const searchTip: Node = { type: 'box', when: [not('flag:menu'), { test: 'env.width', is: 'gt', value: '719' }],
  style: { ...col, position: 'absolute', top: 'calc(100% + 12px)', left: '50%', translate: '-50% 0px', 'z-index': '40', 'pointer-events': 'none', display: 'none', 'align-items': 'center' },
  groupHover: { display: 'flex' }, groupFocus: { display: 'flex' }, children: [
    { type: 'box', motion: 'bubble', style: { ...col, 'align-items': 'center', 'transform-origin': '50% 0%' }, children: [
      { type: 'image', src: asset('tail-small-up.svg'), alt: '', style: { ...sz(16, 9), 'margin-bottom': '-2.5px', position: 'relative', 'z-index': '1' } },
      { type: 'text', text: '{s:search}', style: { 'white-space': 'nowrap', padding: '6px 12px', 'border-radius': '14px', border: '2.5px solid $ink', 'background-color': '$card', color: '$ink', 'font-family': fredoka, 'font-size': '13px', 'font-weight': '600', 'box-shadow': '0px 3px 0px $ink' } },
    ] },
  ] };

const profileButton: Style = { ...Bubble, ...row, height: '44px', 'padding-left': '4px', 'padding-right': '16px', 'justify-content': 'flex-start', gap: '8px', 'background-color': '$card' };
const nav: Node = { type: 'box', role: 'navigation', label: '{s:mainNavigation}', when: [set('env.viewer')], motion: 'navIn',
  style: { ...col, position: 'relative', 'z-index': '20', 'flex-shrink': '0', 'padding-top': '14px', ...gutter, 'padding-bottom': '8px' }, below: { [COMPACT]: { 'padding-top': '10px', ...gutterSmall, 'padding-bottom': '4px' } }, children: [
    { type: 'box', style: { ...row, height: '66px', 'box-sizing': 'border-box', 'padding-left': '22px', 'padding-right': '10px', 'align-items': 'center', gap: '10px', border: '3px solid $ink', 'border-radius': '999px', 'background-color': '$card', 'box-shadow': '0px 5px 0px $ink' },
      below: { [COMPACT]: { height: '56px', 'padding-left': '14px', 'padding-right': '8px', gap: '6px' } }, children: [
        { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', ...pending({ controlStates: false }), style: { ...row, position: 'relative', 'align-items': 'center', gap: `${26 * 0.24}px`, 'margin-right': '18px', 'flex-shrink': '0', color: '$ink' },
          below: { [COMPACT]: { gap: `${22 * 0.24}px`, 'margin-right': '0px' } }, children: [
            { type: 'box', style: { ...row, 'align-items': 'center', gap: `${26 * 0.24}px` }, below: { [COMPACT]: { display: 'none' } }, children: wordmark(26) },
            { type: 'box', style: { display: 'none' }, below: { [COMPACT]: { ...row, 'align-items': 'center', gap: `${22 * 0.24}px` } }, children: wordmark(22) },
          ] },
        // The destinations scroll inside the bar; compact bars move them to a strip below.
        { type: 'box', style: { ...row, flex: '1', 'min-width': '0px', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', gap: '4px', 'align-items': 'center' }, below: { [COMPACT]: { 'overflow-x': 'hidden' } }, children: [
          ...destinations().map(hideCompact),
        ] },
        { type: 'box', group: true, style: { ...row, position: 'relative', 'flex-shrink': '0' }, children: [
          { type: 'box', press: { action: 'search', focus: 'vela-search' }, label: '{s:search}', style: { ...Bubble, ...sz(44), 'background-color': '$butter-soft' }, ...bubble, children: [icon('search', 18)] },
          searchTip,
        ] },
        // The profile button, washed pink while its menu is open.
        { type: 'box', id: 'profile-menu-trigger', press: { action: 'toggle', arg: 'menu' }, label: '{s:profileAndAppearance}', testId: 'profile-menu', a11y: { expanded: [set('flag:menu')], ...pending({ controls: 'viewer-settings' }) },
          style: profileButton, states: [{ when: [set('flag:menu')], style: { ...profileButton, 'background-color': '$pink-wash' } }], below: { [COMPACT]: { 'padding-right': '4px' } }, ...bubble, children: [
            { type: 'text', text: '{env.viewerInitial}', style: { ...sz(32), 'border-radius': '16px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-family': pixelFace, 'font-size': '16px', 'font-weight': '700', color: '$ink', 'background-color': '$pink-soft', border: '2px solid $ink', 'box-sizing': 'border-box' } },
            { type: 'text', text: '{env.viewer}', style: { 'font-size': '15px', 'font-weight': '600', 'max-width': '140px', 'white-space': 'nowrap', 'overflow-x': 'hidden', 'text-overflow': 'ellipsis' }, below: { [COMPACT]: { display: 'none' } } },
          ] },
      ] },
    // Compact: the destinations as a strip under the bar.
    { type: 'box', style: { display: 'none' }, below: { [COMPACT]: { ...row, gap: '8px', 'align-items': 'center', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', 'margin-left': '-16px', 'margin-right': '-16px', padding: '12px 16px 6px' } }, children: destinations() },
  ] };

const swatch = (colour: string): Node => ({ type: 'box', style: { ...sz(12), 'border-radius': '6px', 'background-color': colour, border: '2px solid $ink', 'box-sizing': 'border-box' } });
const menu: Node = { type: 'box', id: 'viewer-settings', role: 'dialog', label: '{s:profileAndAppearance}', when: [set('env.viewer'), set('flag:menu')], motion: 'menuPop', exit: 'menuOut', escape: 'menu', returnFocus: 'profile-menu-trigger',
  style: { ...col, position: 'absolute', top: '92px', right: 'max(24px, 3.6vw)', 'z-index': '30', width: '272px', 'box-sizing': 'border-box', padding: '20px', gap: '16px', border: '3px solid $ink', 'border-radius': '24px', 'background-color': '$card', color: '$ink', 'box-shadow': '6px 6px 0px $lavender', 'transform-origin': 'top right' },
  below: { [COMPACT]: { top: '74px', right: '12px' } }, children: [
    { type: 'image', src: asset('tail-up.svg'), alt: '', style: { position: 'absolute', top: '-14px', right: '34px', ...sz(24, 14) } },
    { type: 'box', style: { ...row, gap: '12px', 'align-items': 'center' }, children: [
      mascot('happy', 44),
      { type: 'box', style: { ...col, gap: '2px', flex: '1', 'min-width': '0px' }, children: [
        { type: 'text', text: '{s:hello}', style: { ...Label, 'font-size': '10px', color: '$ink-soft' } },
        { type: 'text', text: '{env.viewer}', style: { 'font-size': '18px', 'font-weight': '650', 'white-space': 'nowrap', 'overflow-x': 'hidden', 'text-overflow': 'ellipsis' } },
      ] },
    ] },
    { type: 'box', style: { height: '0px', 'border-style': 'dashed', 'border-width': '0px', 'border-top-width': '2.5px', 'border-top-color': '$line-strong' } },
    { type: 'box', press: { action: 'openPicker' }, label: '{s:appearance}', testId: 'skin-picker', when: [{ test: 'env.skinCount', is: 'gt', value: '1' }],
      style: { ...row, position: 'relative', gap: '12px', 'align-items': 'center', 'box-sizing': 'border-box', width: '100%', padding: '10px 12px', border: '2.5px solid $ink', 'border-radius': '16px', 'background-color': '$page', color: '$ink', cursor: 'pointer' },
      hover: { 'background-color': '$lavender-soft' }, focus: { 'box-shadow': ring }, ...active({ scale: '0.97' }), children: [
        { type: 'box', style: { ...col, gap: '2px', flex: '1', 'min-width': '0px', 'text-align': 'left' }, children: [
          { type: 'text', text: '{s:appearance}', style: { ...Label, 'font-size': '10px', color: '$ink-soft' } },
          { type: 'text', text: '{s:name}', style: { 'font-size': '16px', 'font-weight': '600', color: '$ink' } },
        ] },
        { type: 'box', style: { ...row, gap: '4px' }, children: ['#fff0f6', '#3b1f4a', '#ff7eb6', '#b9a0ff'].map(swatch) },
      ] },
    { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
    { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
    { type: 'box', press: { action: 'signOut' }, label: '{s:signOut}', style: { ...Puffy, height: '42px', padding: '0px 16px', 'box-shadow': '0px 3px 0px $ink', gap: '10px' }, ...puffy, children: [
      icon('out', 14),
      { type: 'text', text: '{s:signOut}', style: { 'font-size': '15px' } },
    ] },
  ] };

const shell: Node = { type: 'box', style: { ...col, position: 'relative', height: '100%', 'min-height': '0px', 'background-color': '$page', color: '$ink', 'color-scheme': 'light', 'font-family': fredoka }, children: [
  // The dotted paper, or on Live TV the night's ground, behind everything (the route sits at z 1).
  { type: 'image', when: [{ test: 'env.section', is: 'ne', value: 'live' }], src: asset('dots.svg'), alt: '', style: { ...inset0, width: '100%', height: '100%', 'object-fit': 'fill', 'pointer-events': 'none', 'z-index': '0' } },
  { type: 'box', when: [is('env.section', 'live')], style: { ...inset0, 'background-color': '$night', 'pointer-events': 'none', 'z-index': '0' } },
  nav,
  menu,
  { type: 'slot', slot: 'children', style: { ...col, flex: '1', 'min-height': '0px', position: 'relative', 'z-index': '1' } as Style,
    inner: { ...col, 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' } },
] };

// ---------------------------------------------------------------- cards and rows

// A poster sticker (slots.contract TitleCard): white-edged with a hard pastel shadow; on
// hover or focus it bounces up, tilts toward the viewer and a sparkle pops in.
const SHADOW: Record<Accent, string> = { pink: '$shadow-pink', lavender: '$shadow', mint: '$mint' };
const sticker = (accent: Accent, tilt: number): Node => {
  const base: Style = { ...col, position: 'relative', width: '100%', 'aspect-ratio': '2 / 3', 'box-sizing': 'content-box', border: '3px solid $ink', 'border-radius': '20px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': `$${accent}`, color: '$ink', 'text-align': 'left',
    translate: '0px 0px', rotate: '0', scale: '1', 'box-shadow': `4px 5px 0px ${SHADOW[accent]}`, transition: lift };
  const up: Style = { translate: '0px -8px', rotate: `${tilt}`, scale: '1.03', 'box-shadow': `7px 10px 0px ${SHADOW[accent]}` };
  return { type: 'box', style: base, small: { 'border-radius': '16px' }, states: [{ when: [stillC], style: { ...base, transition: liftStill } }],
    groupHover: up, groupFocus: { ...up, 'box-shadow': '0px 0px 0px 3px $card, 0px 0px 0px 7px $focus' }, children: [
      { type: 'image', when: [set('card.poster')], src: '{card.poster}', alt: '', fade: true, style: fadeIn },
      // No poster: the name on a soft wash under a pixel star.
      { type: 'box', when: [not('card.poster')], style: { ...col, ...inset0, padding: '14px', gap: '10px', 'justify-content': 'flex-end', 'background-image': 'linear-gradient(160deg, $card 0%, $page-clear 70%)' }, children: [
        icon('star', 18, 'ink'),
        { type: 'text', text: '{card.name}', style: { ...Title, 'font-size': '21px', 'line-clamp': '4' }, small: { 'font-size': '18px' } },
      ] },
      { type: 'box', style: { ...inset0, 'pointer-events': 'none', 'border-radius': '17px', 'box-shadow': 'inset 0px 0px 0px 3px $edge' }, small: { 'border-radius': '13px' } },
      { type: 'box', when: [set('card.played')], style: { ...row, position: 'absolute', top: '8px', right: '8px', ...sz(26), 'border-radius': '13px', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$mint', border: '2px solid $ink', 'box-sizing': 'border-box', color: '$ink' }, children: [icon('check', 12)] },
      { type: 'box', when: [set('card.hasProgress'), not('card.played')], style: { ...col, position: 'absolute', left: '10px', right: '10px', bottom: '10px', height: '10px', 'border-radius': '5px', 'background-color': '$card', border: '2px solid $ink', 'box-sizing': 'border-box', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
        { type: 'box', style: { height: '100%', width: '{card.progressPct}%', 'background-color': '$pink', 'background-image': 'repeating-linear-gradient(135deg, $pink 0px, $pink 4px, $pink-hover 4px, $pink-hover 8px)' } },
      ] },
      // Shown (and so popping in) only while lifted.
      { type: 'box', when: [moving], motion: 'sparklePop', style: { position: 'absolute', top: '10px', left: '10px', color: '$card', display: 'none' }, groupHover: { display: 'flex' }, groupFocus: { display: 'flex' }, children: [twinkle('card', 14)] },
    ] } as Node;
};

// The card is a group only so its burst hears the press; the sticker answers to the nearer
// group, the wiggle wrapper, so only the sticker itself lifts it (as compiled).
const card: Node = { type: 'box', group: true, motion: 'hop0', stagger: { step: 45, cap: 8 }, style: { ...col, position: 'relative', width: 'clamp(146px, 11.6vw, 208px)', 'flex-shrink': '0', gap: '10px' }, small: { width: '132px' }, children: [
  { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
  // The wiggle wraps the sticker, which carries the lift (as compiled: two elements).
  { type: 'box', group: true, press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
    style: { ...col, position: 'relative' }, hover: { animation: 'doc:wiggle 520ms ease-in-out both' }, focus: { animation: 'doc:wiggle 520ms ease-in-out both' }, children: [
      ...byAccent('card', a => ({ ...sticker(a, -2.2), when: [mod('card', 2, 0)] } as Node)),
      ...byAccent('card', a => ({ ...sticker(a, 2.2), when: [mod('card', 2, 1)] } as Node)),
    ] },
  burst,
  { type: 'box', style: { ...col, gap: '3px', padding: '0px 4px' }, children: [
    { type: 'text', text: '{card.name}', style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '1', color: '$ink' }, small: { 'font-size': '14px' } },
    { type: 'text', text: '{card.facts}', style: { 'font-size': '12.5px', color: '$ink-soft', 'line-clamp': '1', 'font-variant-numeric': 'tabular-nums' } },
  ] },
] };

// A named shelf in server order (slots.contract Shelf): a pixel star in the row's
// colour, pixel type, a squiggle, then the cards sliding horizontally.
const shelf = (paged: boolean): Node => ({ type: 'box', style: { ...col, position: 'relative', gap: '0px', 'padding-bottom': '18px' }, small: { 'padding-bottom': '10px' }, children: [
  { type: 'box', style: { ...row, gap: '10px', 'align-items': 'center', ...gutter }, small: gutterSmall, children: [
    ...byAccent('row', a => ({ type: 'box', style: { ...col, 'flex-shrink': '0', color: `$${a}`, filter: 'drop-shadow(1.5px 1.5px 0px $ink)' }, children: [icon('star', 18, undefined, { small: sz(16) })] })),
    { type: 'box', style: { ...col, gap: '2px', 'min-width': '0px' }, children: [
      { type: 'text', text: '{row.name}', role: 'heading', level: 2, style: { ...Pixel, 'font-size': '23px', color: '$ink', 'white-space': 'nowrap', 'overflow-x': 'hidden', 'text-overflow': 'ellipsis' }, small: { 'font-size': '19px' } },
      ...byAccent('row', a => ({ type: 'image', src: asset(`squiggle-${a}.svg`), alt: '', style: sz(72, 7) })),
    ] },
  ] },
  // The scroller is the track (a flex scroll box keeps its end padding).
  { type: 'box', style: { ...row, 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', gap: '20px', 'align-items': 'flex-start', 'padding-top': '22px', 'padding-bottom': '24px', ...gutter },
    small: { gap: '14px', 'padding-top': '18px', 'padding-bottom': '18px', ...gutterSmall }, children: [
      { type: 'repeat', over: 'row.items', item: { type: 'use', template: 'card' } },
      // A home row's end: a sentinel that asks for more, with Mochi hopping while it loads.
      ...(paged ? [{ type: 'box', when: [set('row.hasMore')], style: { ...col, position: 'relative', width: '104px', 'align-self': 'stretch', 'flex-shrink': '0', 'align-items': 'center', 'justify-content': 'center' }, small: { width: '72px' }, children: [
        { type: 'widget', widget: 'sentinel', params: { on: 'row' } },
        { ...hopper(36), when: [set('row.loadingMore')] } as Node,
      ] } as Node] : []),
    ] },
] });

// ---------------------------------------------------------------- status

// A loading placeholder: a candy block swept by a soft highlight (look.contract Skeleton).
const skeleton = (width: string, height: string, radius: number, extra: Extra = {}): Node => ({ type: 'box', ...extra,
  style: { ...col, width, height, 'flex-shrink': '0', 'border-radius': `${radius}px`, 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$skeleton', ...(extra.style ?? {}) }, children: [
    { type: 'box', when: [moving], motion: 'shimmer', style: { width: '100%', height: '100%', 'background-image': 'linear-gradient(90deg, $page-clear 0%, $skeleton-light 50%, $page-clear 100%)' } },
  ] } as Node);
// A row-shaped placeholder while titles load (slots.contract RowSkeleton).
const rowSkeleton: Node = { type: 'box', style: { ...col, gap: '18px', 'padding-bottom': '24px' }, children: [
  { type: 'box', style: { ...col, ...gutter }, small: gutterSmall, children: [skeleton('190px', '22px', 8)] },
  { type: 'box', style: { ...row, gap: '20px', ...gutter, 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, small: { gap: '14px', ...gutterSmall }, children: [0, 1, 2, 3, 4, 5, 6, 7].map(() => ({ type: 'box', style: { ...col, gap: '10px', 'flex-shrink': '0' }, children: [
    skeleton('clamp(146px, 11.6vw, 208px)', 'clamp(219px, 17.4vw, 312px)', 20, { small: { width: '132px', height: '198px' } }),
    skeleton('70%', '12px', 6),
  ] } as Node)) },
] };
// Home while it loads: Mochi hopping inside a banner-shaped frame, the field and rows as
// skeletons; when it fails, a sad Mochi and, when the foundation can ask again, Try again
// (slots.contract Status).
const homeLoading: Node = { type: 'box', when: [is('env.load', 'loading')], role: 'status', label: '{s:findingYourEvening}', motion: 'statusIn', style: { ...col, 'padding-top': '10px', gap: '34px' }, small: { 'padding-top': '6px', gap: '26px' }, children: [
  { type: 'box', style: { ...col, position: 'relative', 'margin-left': 'max(24px, 3.6vw)', 'margin-right': 'max(24px, 3.6vw)', height: 'clamp(380px, 54vh, 560px)', 'box-sizing': 'border-box', border: '3px dashed $shadow', 'border-radius': '34px', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$lavender-soft' },
    small: { 'margin-left': '16px', 'margin-right': '16px', height: '440px', 'border-radius': '26px' }, children: [
      { ...loader('{s:findingYourEvening}', 80), small: { display: 'none' } } as Node,
      { ...loader('{s:findingYourEvening}', 64), style: { display: 'none' }, small: { ...col, 'align-items': 'center', gap: '14px' } } as Node,
    ] },
  { type: 'box', style: { ...col, 'align-items': 'center', ...gutter }, small: gutterSmall, children: [skeleton('min(720px, 100%)', '62px', 31)] },
  rowSkeleton,
] };
const retryButton: Node = { type: 'box', when: [set('env.canRetry')], style: { ...row, 'justify-content': 'center' }, children: [
  { type: 'box', press: { action: 'retry' }, label: '{s:tryAgain}', style: { ...Candy, height: '46px', padding: '0px 24px' }, ...candy, children: [{ type: 'text', text: '{s:tryAgain}' }] },
] };
const failed = (message: string): Node => ({ type: 'box', when: [is('env.load', 'failed')], style: { ...col, 'padding-top': '48px' }, small: { 'padding-top': '24px' }, children: [
  { type: 'box', style: { ...col, gap: '4px' }, children: [emptyState('sad', '{s:somethingWentQuiet}', message), retryButton] },
] });

// ---------------------------------------------------------------- home

const heroChip: Style = { 'font-size': '12.5px', 'font-weight': '600', padding: '3px 10px', 'border-radius': '999px', 'background-color': '$night-veil', border: '1.5px solid $night-edge-strong', color: '$night-ink', 'font-variant-numeric': 'tabular-nums' };

// The featured title as a big sticker (slots.contract Banner): artwork in a thick rounded
// frame with a hard lavender shadow, the poster stuck on at a tilt, and a candy button.
const banner: Node = { type: 'box', motion: 'pop0', style: { ...col, position: 'relative' }, children: [
  { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
  { type: 'box', style: { ...col, position: 'relative', height: 'clamp(380px, 54vh, 560px)', 'box-sizing': 'content-box', border: '3px solid $ink', 'border-radius': '34px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$lavender-soft', 'box-shadow': '10px 11px 0px $lavender' },
    small: { height: '440px', 'border-radius': '26px', 'box-shadow': '6px 7px 0px $lavender' }, children: [
      { type: 'image', when: [set('hero.backdrop')], src: '{hero.backdrop}', alt: '', fade: true, style: fadeIn },
      { type: 'image', when: [not('hero.backdrop'), set('hero.poster')], src: '{hero.poster}', alt: '', style: { position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', 'object-fit': 'cover', filter: 'blur(60px) saturate(1.4)', opacity: '0.9' } },
      { type: 'widget', widget: 'heroPreview', when: [moving], style: fill },
      { type: 'box', style: { ...inset0, 'pointer-events': 'none', 'background-image': 'linear-gradient(90deg, $scrim 0%, $scrim-soft 48%, $scrim-clear 72%), linear-gradient(0deg, $scrim 0%, $scrim-clear 50%)' },
        small: { 'background-image': 'linear-gradient(0deg, $scrim 0%, $scrim 30%, $scrim-clear 75%)' } },
      { type: 'box', motion: 'hop160', style: { ...col, position: 'absolute', left: '0px', right: '0px', bottom: '0px', 'box-sizing': 'border-box', padding: '0px 44px 40px', 'max-width': '46rem', gap: '14px', color: '$night-ink' },
        small: { padding: '0px 20px 22px', 'max-width': 'none', gap: '10px' }, children: [
          { type: 'box', style: { ...row, 'align-self': 'flex-start', gap: '7px', 'align-items': 'center', padding: '5px 12px 5px 10px', 'border-radius': '999px', 'background-color': '$butter', color: '$ink', border: '2.5px solid $ink' }, children: [
            icon('heart', 11),
            { type: 'text', text: '{s:pickedForYou}', style: { ...Label, 'font-size': '11px' } },
          ] },
          { type: 'image', when: [set('hero.logo')], src: '{hero.logo}', alt: '{hero.name}', role: 'heading', level: 1, style: { height: '130px', width: 'auto', 'max-width': 'min(480px, 72%)', 'object-fit': 'contain', 'align-self': 'flex-start', filter: 'drop-shadow(3px 3px 0px $ink)' }, small: { height: '84px', 'max-width': '80%' } },
          { type: 'text', when: [not('hero.logo')], text: '{hero.name}', role: 'heading', level: 1, style: { ...Title, 'font-size': '64px', 'line-clamp': '2', color: '$night-ink', 'text-shadow': '3px 3px 0px $ink' }, small: { 'font-size': '38px' } },
          { type: 'box', style: { ...row, gap: '6px', 'flex-wrap': 'wrap' }, children: [
            { type: 'text', when: [set('hero.facts')], text: '{hero.facts}', style: heroChip },
            { type: 'repeat', over: 'hero.genres', limit: 3, item: { type: 'text', text: '{genre.text}', style: heroChip } },
          ] },
          { type: 'text', when: [set('hero.summary')], text: '{hero.summary}', style: { 'font-size': '16px', 'line-height': '1.5', 'line-clamp': '3', 'max-width': '34rem', color: '$night-ink', 'text-shadow': '0px 1px 8px $ink' }, small: { 'font-size': '14px', 'line-clamp': '2' } },
          { type: 'box', style: { ...row, 'margin-top': '8px' }, small: { 'margin-top': '4px' }, children: [
            { type: 'box', press: { action: 'select', arg: '{hero.kindId}' }, label: '{hero.label}', testId: 'hero-more', style: { ...Candy, height: '54px', 'padding-left': '28px', 'padding-right': '30px', gap: '10px' },
              small: { height: '48px', 'padding-left': '22px', 'padding-right': '24px' }, ...candy, children: [
                icon('play', 14),
                { type: 'text', text: '{s:peek}', style: { 'font-size': '17px' }, small: { 'font-size': '16px' } },
              ] },
          ] },
        ] },
    ] },
  // The poster, stuck over the frame's top edge with a strip of washi tape.
  { type: 'box', when: [set('hero.poster')], motion: 'pop260', style: { ...col, position: 'absolute', right: 'max(36px, 4.5vw)', top: '-14px', width: 'clamp(150px, 13vw, 210px)', 'aspect-ratio': '2 / 3', rotate: '5' }, small: { display: 'none' }, children: [
    { type: 'box', motion: 'float50', style: { ...col, position: 'relative', width: '100%', height: '100%', 'box-sizing': 'border-box', 'border-radius': '20px', border: '3px solid $ink', 'background-color': '$card', padding: '5px', 'box-shadow': '8px 10px 0px $shadow-pink' }, children: [
      { type: 'box', style: { ...col, position: 'relative', flex: '1', 'border-radius': '13px', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
        { type: 'image', src: '{hero.poster}', alt: '', fade: true, style: fadeIn },
      ] },
    ] },
    { type: 'box', style: { position: 'absolute', top: '-12px', left: '42%', ...sz(54, 20), rotate: '-8', 'background-color': '$mint', opacity: '0.85', border: '2px solid $ink', 'box-sizing': 'border-box' } },
  ] },
  { type: 'box', when: [set('hero.poster')], style: { ...col, position: 'absolute', right: 'max(20px, 2.5vw)', top: '-26px', color: '$butter', filter: 'drop-shadow(2px 2px 0px $ink)' }, small: { display: 'none' }, children: [twinkle('butter', 26)] },
] };

// The featured-title dots: the current one stretches and fills while home rotates.
const dot: Style = { position: 'relative', width: '14px', height: '14px', padding: '0px', 'box-sizing': 'border-box', border: '2.5px solid $ink', 'border-radius': '7px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$card', cursor: 'pointer' };
const heroDot: Node = { type: 'box', press: { action: 'pickHero', arg: '{index}' }, label: '{s:featuredTitle} {index.label} {s:of} {env.heroCount}: {hero.name}', a11y: { current: [set('index.current')] },
  style: dot, states: [{ when: [set('index.current')], style: { ...dot, width: '44px', 'background-color': '$pink-soft' } }], layoutTransition: '380ms ease-out',
  hover: { 'background-color': '$lavender-soft' }, focus: { 'box-shadow': '0px 0px 0px 2px $card, 0px 0px 0px 5px $focus' }, children: [
    { type: 'box', when: [set('index.current'), set('env.rotating')], motion: 'heroFill', style: { ...inset0, 'background-color': '$pink' } },
    { type: 'box', when: [set('index.current'), not('env.rotating')], style: { ...inset0, 'background-color': '$pink' } },
  ] };

// The search box (slots.contract SearchField): a chunky white pill with a butter badge
// that turns pink while you type, and a round clear button.
const field: Style = { ...row, position: 'relative', width: '100%', 'max-width': '720px', 'align-items': 'center', gap: '12px', height: '62px', 'box-sizing': 'border-box', padding: '0px 8px 0px 10px', border: '3px solid $ink', 'border-radius': '999px', 'background-color': '$card', 'box-shadow': '0px 5px 0px $ink', transition: 'box-shadow 200ms ease' };
const badge: Style = { ...row, ...sz(40), 'border-radius': '20px', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$butter', border: '2.5px solid $ink', 'box-sizing': 'border-box', color: '$ink', transition: 'background-color 160ms linear' };
// Mochi perches on its top edge, floating; the field and Mochi slide together while searching.
const searchField: Node = { type: 'box', style: field, states: [{ when: [set('env.searchFocused')], style: { ...field, 'box-shadow': '0px 6px 0px $ink, 0px 0px 0px 6px $lavender-soft' } }], children: [
  { type: 'box', motion: 'float36', style: { ...col, position: 'absolute', left: '30px', top: '-36px', 'z-index': '2', 'pointer-events': 'none' }, small: { left: '18px', top: '-30px' }, children: [
    mascot('happy', 48, { when: [not('env.searching')], small: sz(40, 36) }),
    mascot('wow', 48, { when: [set('env.searching')], small: sz(40, 36) }),
  ] },
  { type: 'box', style: badge, states: [{ when: [set('env.searchFocused')], style: { ...badge, 'background-color': '$pink' } }], children: [icon('search', 16)] },
  { type: 'widget', widget: 'searchInput', params: { placeholder: '{s:searchPlaceholder}', label: '{s:searchYourLibrary}', placeholderColor: '$ink-quiet' },
    style: { flex: '1', 'min-width': '0px', height: '100%', color: '$ink', 'font-family': fredoka, 'font-size': '17px', 'font-weight': '500', outline: 'none' } },
  { type: 'box', when: [set('env.searching')], press: { action: 'clearSearch' as Action }, label: '{s:clearSearch}', style: { ...Bubble, ...sz(40) }, ...bubble, children: [icon('close', 12)] },
] };

const searchBlock: Style = { ...col, position: 'relative', 'padding-top': '34px', 'padding-bottom': '10px', ...gutter, 'align-items': 'center' };
const ready: Condition = is('env.load', 'ready');
const home: Node = { type: 'box', style: { ...col, position: 'relative' }, children: [
  homeLoading,
  failed('{s:homeFailed}'),
  { type: 'box', when: [ready], style: { height: '10px', 'flex-shrink': '0' }, small: { height: '6px' } },
  { type: 'repeat', over: 'home.hero', when: [ready, not('env.searching')], item: { type: 'box', exit: 'heroOut', style: { ...col, ...gutter }, small: gutterSmall, children: [banner] } },
  { type: 'box', role: 'group', label: '{s:featuredTitles}', when: [ready, not('env.searching'), { test: 'env.heroCount', is: 'gt', value: '1' }],
    style: { ...row, gap: '8px', 'align-items': 'center', 'justify-content': 'center', 'padding-top': '20px' }, small: { 'padding-top': '16px' }, children: [
      { type: 'repeat', over: 'home.heroes', item: heroDot },
    ] },
  // Padding by searching and phone width, as states (variants layer over them).
  { type: 'box', when: [ready], style: searchBlock, layoutTransition: '420ms ease-out', states: [
      { when: [set('env.searching'), set('env.small')], style: { ...searchBlock, 'padding-top': '40px' } },
      { when: [set('env.searching')], style: { ...searchBlock, 'padding-top': '48px' } },
      { when: [set('env.small')], style: { ...searchBlock, 'padding-top': '26px' } },
    ], small: { 'padding-bottom': '4px', ...gutterSmall }, children: [
      searchField,
    ] },
  { type: 'box', when: [ready, not('env.searching')], style: { ...col, position: 'relative', 'padding-top': '18px' }, small: { 'padding-top': '12px' }, children: [
    { type: 'repeat', over: 'home.rows', item: { type: 'use', template: 'shelf', motion: 'hopRow', stagger: { step: 80, cap: 4 }, exit: 'rowOut' } as Node },
    { type: 'box', when: [set('env.homeHasMore')], style: { ...col, position: 'relative', 'min-height': '120px', 'align-items': 'center', 'justify-content': 'center' }, children: [
      { type: 'widget', widget: 'sentinel', params: { on: 'home' } },
      { ...loader('{s:loadingMore}', 48), when: [set('env.homeMoreLoading')] } as Node,
    ] },
    { ...emptyState('sleepy', '{s:nothingHereYet}', '{s:noRowsYet}'), when: [is('env.rowCount', '0')] } as Node,
    { type: 'box', style: { height: '40px' }, small: { height: '24px' } },
  ] },
] };


// ---------------------------------------------------------------- library

// A card in a wrapping grid fills its column (TitleCard fill).
const gridCard: Node = { ...card, stagger: { step: 28, cap: 18 }, style: { ...card.style, width: '100%' }, small: {} } as Node;

// A page heading as a sticker label: the artwork stuck on at a tilt, a pixel eyebrow, the name
// (library.contract PageHeading).
const pageHeading = (eyebrow: string, name: string, backdrop?: string): Node => ({ type: 'box', motion: 'hop40', style: { ...row, position: 'relative', gap: '16px', 'align-items': 'center', ...gutter, 'padding-top': '18px' },
  small: { gap: '12px', ...gutterSmall, 'padding-top': '10px' }, children: [
    ...(backdrop ? [{ type: 'box', when: [set(backdrop.slice(1, -1)), not('env.small')], style: { ...col, position: 'relative', ...sz(96, 60), 'border-radius': '16px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', border: '3px solid $ink', 'box-shadow': '4px 4px 0px $lavender', rotate: '-3' }, children: [
      { type: 'image', src: backdrop, alt: '', fade: true, style: fadeIn },
    ] } as Node] : []),
    { type: 'box', style: { ...col, gap: '4px', 'min-width': '0px' }, children: [
      { type: 'box', style: { ...row, gap: '6px', 'align-items': 'center', color: '$pink-deep' }, children: [
        icon('sparkle', 11),
        { type: 'text', text: eyebrow, style: { ...Label, 'font-size': '11px' } },
      ] },
      { type: 'text', text: name, role: 'heading', level: 1, style: { ...Title, 'font-size': '42px', 'line-clamp': '1' }, small: { 'font-size': '30px' } },
    ] },
  ] });

// One choice in a segmented candy group (library.contract Chip).
const chipBase: Style = { ...row, position: 'relative', 'align-items': 'center', height: '34px', padding: '0px 14px', border: '2px solid $page-clear', 'border-radius': '999px', 'background-color': '$page-clear', color: '$ink', 'font-family': fredoka, 'font-size': '14px', 'font-weight': '550', cursor: 'pointer', 'white-space': 'nowrap', transition: 'background-color 160ms linear' };
const chipOn: Style = { ...chipBase, 'border-color': '$ink', 'background-color': '$pink', 'font-weight': '650' };
const chip = (label: string, on: Condition[], arg: string, when: Condition[] = []): Node => ({ type: 'box', when, press: { action: 'libraryFilter' as Action, arg }, label, a11y: { pressed: on },
  style: chipBase, states: [{ when: on, style: chipOn }], hover: { 'border-color': '$ink' }, focus: { 'box-shadow': '0px 0px 0px 2px $card, 0px 0px 0px 5px $focus' }, children: [
    { type: 'text', text: label },
  ] });
const chipGroup = (label: string, when: Condition[], children: Node[]): Node => ({ type: 'box', role: 'group', label, when, style: { ...row, gap: '4px', padding: '4px', 'flex-shrink': '0', 'border-radius': '999px', 'background-color': '$card', border: '2.5px solid $ink' }, children });
// A native picker in Mochi's pill (look.contract Picker).
const Picker: Style = { height: '44px', 'flex-shrink': '0', 'box-sizing': 'border-box', padding: '0px 14px', border: '2.5px solid $ink', 'border-radius': '999px', 'background-color': '$card', color: '$ink', 'font-family': fredoka, 'font-size': '14px', 'font-weight': '600' };
const favourite: Style = { ...Bubble, ...row, height: '44px', 'padding-left': '14px', 'padding-right': '18px', gap: '8px', 'background-color': '$card' };

const toolbar: Node = { type: 'box', motion: 'hop90', style: { ...row, position: 'relative', gap: '10px', 'align-items': 'center', 'flex-wrap': 'wrap', 'padding-top': '4px', 'padding-bottom': '8px', ...gutter, 'min-width': '100%', 'box-sizing': 'border-box' },
  small: { 'flex-wrap': 'nowrap', ...gutterSmall, 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
    chipGroup('{s:all}', [{ test: 'library.kindCount', is: 'gt', value: '1' }], [
      chip('{s:all}', [is('library.kindFilter', '')], 'kind|'),
      { type: 'repeat', over: 'library.kinds', item: chip('{opt.label}', [set('opt.on')], 'kind|{opt.id}') },
    ]),
    chipGroup('{s:unwatched}', [set('library.canPlayed')], [
      chip('{s:all}', [is('library.playedFilter', '')], 'played|'),
      chip('{s:unwatched}', [is('library.playedFilter', 'false')], 'played|false'),
      chip('{s:watchedFilter}', [is('library.playedFilter', 'true')], 'played|true'),
    ]),
    ...[true, false].map(on => ({ type: 'box', when: [set('library.canFavorite'), on ? set('library.favoriteFilter') : not('library.favoriteFilter')], press: { action: 'libraryFilter' as Action, arg: on ? 'favorite|' : 'favorite|true' }, label: '{s:favourites}',
      a11y: { pressed: [set('library.favoriteFilter')] }, style: on ? { ...favourite, 'background-color': '$pink' } : favourite, ...bubble, children: [
        icon('heart', 14, on ? 'ink' : 'pink-deep'),
        { type: 'text', text: '{s:favourites}', style: { 'font-size': '15px', 'font-weight': '600' } },
      ] } as Node)),
    { type: 'widget', widget: 'select', when: [{ test: 'library.genreCount', is: 'gt', value: '0' }], params: { options: 'library.genres', action: 'libraryFilter', arg: 'genre|{value}', none: '{s:anyGenre}', label: '{s:genre}' }, style: Picker },
    { type: 'box', style: { flex: '1' } },
    { type: 'box', when: [{ test: 'library.sortCount', is: 'gt', value: '1' }], style: { ...row, gap: '8px', 'align-items': 'center', 'flex-shrink': '0' }, children: [
      { type: 'text', text: '{s:sortBy}', style: { ...Label, 'font-size': '11px', color: '$ink-soft' } },
      { type: 'widget', widget: 'select', params: { options: 'library.sorts', action: 'librarySort', label: '{s:sortBy}' }, style: Picker },
      // The flip names the current direction (one node per direction, so the arrow's turn
      // is not animated yet: states cannot carry a label).
      ...(['asc', 'desc'] as const).map(d => ({ type: 'box', when: [set('library.canFlip'), is('library.direction', d)], press: { action: 'librarySortFlip' as Action }, label: d === 'asc' ? '{s:ascending}' : '{s:descending}', style: { ...Bubble, ...sz(44) }, ...bubble, children: [
        { type: 'box', style: { ...col, rotate: d === 'asc' ? '180' : '0' }, children: [icon('sort', 15)] },
      ] } as Node)),
    ] },
  ] };

const libraryGrid: Node = { type: 'box', style: { ...col, transition: 'opacity 200ms linear' }, states: [{ when: [set('env.libraryLoading')], style: { ...col, transition: 'opacity 200ms linear', opacity: '0.6' } }], ...pending({ a11y: { busy: [set('env.libraryLoading')] } }), children: [
  { type: 'box', style: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(176px, 1fr))', 'column-gap': '24px', 'row-gap': '34px', ...gutter, 'padding-top': '8px' },
    small: { 'grid-template-columns': 'repeat(auto-fill, minmax(136px, 1fr))', 'column-gap': '14px', 'row-gap': '24px', ...gutterSmall }, children: [
      { type: 'repeat', over: 'library.items', item: { type: 'use', template: 'gridCard' } },
    ] },
] };

// A library: its name, the server's sort and filter choices, then its titles in a grid.
const library: Node = { type: 'box', style: { ...col, position: 'relative', color: '$ink', 'font-family': fredoka }, children: [
  // Before the page's first answer (library.contract Status kind "library", or a failure).
  { type: 'box', when: [is('env.load', 'loading')], role: 'status', label: '{s:findingTitles}', motion: 'statusIn', style: { ...col, 'padding-top': '72px', 'align-items': 'center' }, small: { 'padding-top': '48px' }, children: [
    { ...loader('{s:findingTitles}', 80), small: { display: 'none' } } as Node,
    { ...loader('{s:findingTitles}', 64), style: { display: 'none' }, small: { ...col, 'align-items': 'center', gap: '14px' } } as Node,
  ] },
  failed('{s:libraryFailed}'),
  { type: 'box', when: [ready], style: { ...col, position: 'relative', gap: '20px', 'padding-bottom': '80px' }, small: { gap: '14px' }, children: [
    pageHeading('{s:library}', '{library.name}', '{library.backdrop}'),
    toolbar,
    { type: 'box', when: [set('env.libraryLoading'), is('library.itemCount', '0')], style: { ...col, 'align-items': 'center', padding: '48px 0px' }, children: [loader('{s:findingTitles}', 64)] },
    { ...emptyState('sleepy', '{s:libraryEmpty}', '{s:libraryEmptyHint}'), when: [not('env.libraryLoading'), is('library.itemCount', '0')] } as Node,
    { ...libraryGrid, when: [{ test: 'library.itemCount', is: 'gt', value: '0' }] } as Node,
    { type: 'box', when: [{ test: 'library.itemCount', is: 'gt', value: '0' }, set('library.more')], style: { ...row, 'justify-content': 'center', 'padding-top': '18px' }, children: [
      { ...loader('{s:loadingMore}', 44), when: [set('env.libraryMoreLoading')] } as Node,
      { type: 'box', when: [not('env.libraryMoreLoading')], press: { action: 'libraryMore' as Action }, label: '{s:loadMore}', style: { ...Candy, height: '52px', 'padding-left': '30px', 'padding-right': '30px', gap: '10px' }, ...candy, children: [
        icon('sparkle', 14),
        { type: 'text', text: '{s:loadMore}', style: { 'font-size': '16px' } },
      ] },
    ] },
  ] },
] };

// ---------------------------------------------------------------- title

const side: Style = { 'padding-left': 'max(48px, 5vw)', 'padding-right': 'max(48px, 5vw)' };
const sideSmall = (n: number): Style => ({ 'padding-left': `${n}px`, 'padding-right': `${n}px` });
// A section title in pixel type beside a pixel icon in a candy badge (detail.contract).
const sectionHeading = (label: string, english: string, iconName: string): Node => ({ type: 'box', style: { ...row, gap: '10px', 'align-items': 'center' }, children: [
  { type: 'box', style: { ...row, 'align-items': 'center', 'justify-content': 'center', ...sz(32), 'border-radius': '10px', 'background-color': `$${accentOf(english)}`, border: '2.5px solid $ink', 'box-sizing': 'border-box' }, children: [icon(iconName, 14)] },
  { type: 'text', text: label, role: 'heading', level: 2, style: { ...Pixel, 'font-size': '26px' }, small: { 'font-size': '22px' } },
] });

// The big candy play button; it throws sparkles as it starts playback.
const playButton = (label: string, aria: string, arg: string, small: boolean, when: Condition[] = []): Node => ({ type: 'box', group: true, when, style: { ...col, position: 'relative', 'flex-shrink': '0' }, children: [{ type: 'box', press: { action: 'play', arg }, label: aria, testId: 'detail-play',
  style: { ...Candy, 'flex-shrink': '0', gap: '10px', height: small ? '50px' : '58px', 'padding-left': small ? '22px' : '30px', 'padding-right': small ? '26px' : '34px' },
  small: { height: '50px', 'padding-left': '22px', 'padding-right': '26px' }, ...candy, children: [
    icon('play', small ? 15 : 17, undefined, { small: sz(15) }),
    { type: 'text', text: label, style: { 'font-size': small ? '16px' : '18px' }, small: { 'font-size': '16px' } },
  ] }, burst] } as Node);
// Watched progress as a striped candy bar.
const candyBar = (pct: string, label: string, style: Style, small?: Style): Node => ({ type: 'box', role: 'progressbar', label, style: { ...col, height: '14px', 'border-radius': '7px', border: '2.5px solid $ink', 'box-sizing': 'border-box', 'background-color': '$card', 'overflow-x': 'hidden', 'overflow-y': 'hidden', ...style }, small, children: [
  { type: 'box', style: { height: '100%', width: `${pct}%`, 'background-image': 'repeating-linear-gradient(135deg, $pink 0px, $pink 5px, $pink-hover 5px, $pink-hover 10px)' } },
] });
const factChip: Style = { 'font-size': '13px', 'font-weight': '600', padding: '4px 12px', 'border-radius': '999px', 'background-color': '$lavender-soft', 'font-variant-numeric': 'tabular-nums' };
const posterSticker = (src: string, width: string, small: string, rotate: string, shadow: string, tape: Style, motion: string): Node => ({ type: 'box', motion, style: { ...col, position: 'relative', 'flex-shrink': '0', width, 'aspect-ratio': '2 / 3', rotate }, small: { width: small }, children: [
  { type: 'box', style: { ...col, position: 'relative', width: '100%', height: '100%', 'box-sizing': 'border-box', padding: '5px', border: '3px solid $ink', 'border-radius': '20px', 'background-color': '$card', 'box-shadow': shadow }, children: [
    { type: 'box', style: { ...col, position: 'relative', flex: '1', 'border-radius': '13px', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
      { type: 'image', src, alt: '', fade: true, style: fadeIn },
    ] },
  ] },
  { type: 'box', style: { position: 'absolute', 'box-sizing': 'border-box', border: '2px solid $ink', ...tape } },
] });

const titleActions: Node = { type: 'box', motion: 'hop260', style: { ...col, gap: '20px', ...side, 'padding-top': '24px', 'max-width': '56rem' }, small: { gap: '16px', ...sideSmall(20), 'padding-top': '16px' }, children: [
  { type: 'text', when: [set('detail.summary')], text: '{detail.summary}', style: { 'font-size': '17px', 'line-height': '1.6', color: '$ink-soft' }, small: { 'font-size': '15px' } },
  { type: 'box', style: { ...row, gap: '14px', 'align-items': 'center', 'flex-wrap': 'wrap' }, children: [
    playButton('{detail.playLabel}', '{detail.playLabel}', '{detail.id}', false, [set('detail.canPlay')]),
    { type: 'repeat', over: 'detail.trailers', when: [set('extra.ready')], item: { type: 'box', press: { action: 'playExtra', arg: '{extra.id}' }, label: '{s:watchTrailer}',
      style: { ...Puffy, height: '56px', 'padding-left': '22px', 'padding-right': '26px', gap: '10px' }, small: { height: '50px' }, ...puffy, children: [
        icon('star', 14),
        { type: 'text', text: '{s:watchTrailer}', style: { 'font-size': '16px' } },
      ] } },
  ] },
  { ...candyBar('{detail.resumePct}', '{s:watchProgress}', { width: '320px' }, { width: '70%' }), when: [set('detail.canPlay'), set('detail.hasResume')] } as Node,
] };

const titleHead: Node = { type: 'box', when: [ready], style: { ...col, position: 'relative' }, children: [
  // The artwork frame.
  ...byAccent('detail', a => ({ type: 'box', motion: 'pop0', style: { ...col, position: 'relative', margin: '22px 22px 0px', height: 'clamp(300px, 46vh, 480px)', 'box-sizing': 'content-box', border: '3px solid $ink', 'border-radius': '30px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': `$${a}`, 'box-shadow': '8px 9px 0px $lavender' },
    small: { margin: '0px', height: '260px', 'border-width': '0px', 'border-bottom-width': '3px', 'border-radius': '0px 0px 28px 28px', 'box-shadow': 'none' }, children: [
      { type: 'image', when: [set('detail.backdrop')], src: '{detail.backdrop}', alt: '', fade: true, style: fadeIn },
      { type: 'image', when: [not('detail.backdrop'), set('detail.poster')], src: '{detail.poster}', alt: '', style: { position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', 'object-fit': 'cover', filter: 'blur(50px) saturate(1.3)', opacity: '0.85' } },
      { type: 'box', style: { ...inset0, 'background-image': 'linear-gradient(0deg, $scrim-soft 0%, $scrim-clear 55%)' } },
      { type: 'box', style: { ...col, position: 'absolute', top: '18px', left: '22px', color: '$butter', filter: 'drop-shadow(2px 2px 0px $ink)' }, children: [twinkle('butter', 22)] },
    ] } as Node)),
  // The poster sticker and the title copy.
  { type: 'box', style: { ...row, position: 'relative', gap: '36px', ...side, 'margin-top': '-130px', 'align-items': 'flex-end' },
    small: { 'flex-direction': 'column', gap: '16px', ...sideSmall(20), 'margin-top': '-96px', 'align-items': 'flex-start' }, children: [
      { ...posterSticker('{detail.poster}', 'clamp(170px, 15vw, 230px)', '128px', '-3', '7px 8px 0px $shadow-pink', { top: '-11px', left: '34%', ...sz(56, 20), rotate: '6', 'background-color': '$butter', opacity: '0.9' }, 'pop120'), when: [set('detail.poster')] } as Node,
      { type: 'box', motion: 'hop160', style: { ...col, gap: '14px', flex: '1', 'min-width': '0px', 'padding-bottom': '6px' }, small: { gap: '12px', 'padding-bottom': '0px' }, children: [
        { type: 'box', style: { ...row, gap: '8px', 'align-items': 'center', 'flex-wrap': 'wrap' }, children: [
          { type: 'text', text: '{detail.kindLabel}', style: { ...Label, 'font-size': '11px', padding: '4px 10px', 'border-radius': '999px', 'background-color': '$mint', border: '2px solid $ink' } },
          { type: 'repeat', over: 'detail.mediaFacts', item: { type: 'text', text: '{fact.text}', style: { ...Label, 'font-size': '11px', padding: '4px 10px', 'border-radius': '8px', 'background-color': '$card', border: '2px solid $ink' } } },
        ] },
        // Phones show the logo when there is one; wider screens always set the name.
        { type: 'image', when: [set('detail.logo'), set('env.small')], src: '{detail.logo}', alt: '{detail.name}', role: 'heading', level: 1, style: { height: '80px', width: 'auto', 'max-width': '85%', 'object-fit': 'contain', 'align-self': 'flex-start' } },
        { type: 'text', when: [not('env.small')], text: '{detail.name}', role: 'heading', level: 1, style: { ...Title, 'font-size': '54px' } },
        { type: 'text', when: [set('env.small'), not('detail.logo')], text: '{detail.name}', role: 'heading', level: 1, style: { ...Title, 'font-size': '34px' } },
        { type: 'box', style: { ...row, gap: '6px', 'flex-wrap': 'wrap' }, children: [
          { type: 'text', when: [set('detail.facts')], text: '{detail.facts}', style: factChip },
          { type: 'repeat', over: 'detail.genres', limit: 4, item: { type: 'text', text: '{genre.text}', style: factChip } },
        ] },
      ] },
    ] },
  titleActions,
] };

// One episode as a white card (detail.contract EpisodeCard): a still that tilts and shows
// a play bubble, then its text; the whole card lifts while pointed at or focused.
const episodeBase: Style = { ...row, position: 'relative', gap: '20px', 'align-items': 'center', padding: '14px', 'border-radius': '22px', 'background-color': '$card', border: '2.5px solid $ink', 'box-shadow': '3px 3px 0px $shadow', translate: '0px 0px', transition: lift };
const episodeUp: Style = { 'box-shadow': '5px 6px 0px $shadow', translate: '0px -3px' };
const thumbBase = (a: Accent): Style => ({ ...col, position: 'relative', width: '200px', 'aspect-ratio': '16 / 9', 'box-sizing': 'content-box', border: '2.5px solid $ink', 'border-radius': '14px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': `$${a}`, color: '$ink', 'flex-shrink': '0', cursor: 'pointer', rotate: '0', transition: lift });
const episodeCard: Node = { type: 'box', group: true, motion: 'hop0', stagger: { step: 40, cap: 8 },
  style: episodeBase, states: [{ when: [stillC], style: { ...episodeBase, transition: liftStill } }], small: { gap: '12px', 'align-items': 'flex-start', padding: '10px' },
  hover: episodeUp, groupFocus: episodeUp, children: [
    ...byAccent('card', a => ({ type: 'box', press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'episode-{card.id}',
      style: thumbBase(a), states: [{ when: [stillC], style: { ...thumbBase(a), transition: liftStill } }], small: { width: '124px' }, groupHover: { rotate: '-1.5' }, groupFocus: { rotate: '-1.5' }, focus: { 'box-shadow': ring }, children: [
        { type: 'image', when: [set('card.backdrop')], src: '{card.backdrop}', alt: '', fade: true, style: fadeIn },
        { type: 'box', when: [not('card.backdrop')], style: { ...col, ...inset0, 'align-items': 'center', 'justify-content': 'center' }, children: [
          { type: 'text', when: [set('card.episodeNumberLabel')], text: '{card.episodeNumberLabel}', style: { ...Pixel, 'font-size': '30px' }, small: { 'font-size': '24px' } },
          { type: 'text', when: [not('card.episodeNumberLabel')], text: '{s:episode}', style: { ...Pixel, 'font-size': '30px' }, small: { 'font-size': '24px' } },
        ] },
        { type: 'box', style: { ...col, ...inset0, 'align-items': 'center', 'justify-content': 'center', 'background-color': '$scrim-soft', opacity: '0', transition: 'opacity 200ms linear' }, groupHover: { opacity: '1' }, groupFocus: { opacity: '1' }, children: [
          { type: 'box', style: { ...row, 'align-items': 'center', 'justify-content': 'center', ...sz(42), 'border-radius': '21px', 'background-color': '$pink', border: '2.5px solid $ink', 'box-sizing': 'border-box', scale: '0.7', transition: lift },
            states: [{ when: [stillC], style: { ...row, 'align-items': 'center', 'justify-content': 'center', ...sz(42), 'border-radius': '21px', 'background-color': '$pink', border: '2.5px solid $ink', 'box-sizing': 'border-box', scale: '0.7', transition: liftStill } }],
            groupHover: { scale: '1' }, groupFocus: { scale: '1' }, children: [icon('play', 14)] },
        ] },
        { type: 'box', when: [set('card.played')], style: { ...row, position: 'absolute', top: '6px', right: '6px', ...sz(22), 'border-radius': '11px', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$mint', border: '2px solid $ink', 'box-sizing': 'border-box' }, children: [icon('check', 10)] },
        { type: 'box', when: [set('card.hasProgress')], style: { ...col, position: 'absolute', left: '8px', right: '8px', bottom: '8px' }, children: [candyBar('{card.progressPct}', '{s:watchProgressOf} {card.name}', { width: '100%' })] },
      ] } as Node)),
    { type: 'box', style: { ...col, flex: '1', 'min-width': '0px', gap: '5px' }, children: [
      { type: 'box', style: { ...row, gap: '8px', 'align-items': 'center', 'min-width': '0px' }, children: [
        { type: 'text', when: [set('card.episodeNumberLabel')], text: '{card.episodeNumberLabel}', style: { ...Pixel, 'font-size': '13px', padding: '1px 8px', 'border-radius': '8px', 'background-color': '$lavender-soft', 'flex-shrink': '0' } },
        { type: 'text', text: '{card.name}', role: 'heading', level: 3, style: { 'font-size': '18px', 'font-weight': '650', 'line-clamp': '2' }, small: { 'font-size': '15px' } },
      ] },
      { type: 'text', when: [not('card.played')], text: '{card.facts}', style: { color: '$ink-soft', 'font-size': '13px', 'font-variant-numeric': 'tabular-nums' } },
      { type: 'text', when: [set('card.played')], text: '{card.facts} · {s:watched}', style: { color: '$ink-soft', 'font-size': '13px', 'font-variant-numeric': 'tabular-nums' } },
      { type: 'text', when: [set('card.summary'), not('env.small')], text: '{card.summary}', style: { color: '$ink-soft', 'font-size': '14px', 'line-clamp': '2', 'line-height': '1.5', 'max-width': '46rem' } },
    ] },
    { type: 'box', when: [not('env.small')], press: { action: 'play', arg: '{card.id}' }, label: '{s:play} {card.name}', style: { ...Bubble, ...sz(46), 'background-color': '$pink-soft' }, ...bubble, children: [icon('play', 15)] },
  ] };

const upNext: Node = { type: 'repeat', over: 'detail.upNext', item: { type: 'box', style: { ...row, 'align-items': 'center', gap: '22px', padding: '18px', 'border-radius': '26px', 'background-color': '$butter-soft', border: '3px solid $ink', 'box-shadow': '6px 7px 0px $butter' },
  small: { 'flex-direction': 'column', 'align-items': 'stretch', gap: '14px', padding: '14px' }, children: [
    { type: 'box', when: [set('card.backdrop')], style: { ...col, position: 'relative', width: '240px', 'aspect-ratio': '16 / 9', 'border-radius': '16px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', border: '3px solid $ink', 'box-sizing': 'border-box', 'flex-shrink': '0' }, small: { width: '100%' }, children: [
      { type: 'image', src: '{card.backdrop}', alt: '', fade: true, style: fadeIn },
    ] },
    { type: 'box', style: { ...col, gap: '6px', flex: '1', 'min-width': '0px' }, children: [
      { type: 'text', text: '{episode.upNextLabel}', style: { ...Label, 'font-size': '11px', color: '$pink-deep' } },
      { type: 'text', text: '{episode.numberTitle}', role: 'heading', level: 3, style: { ...Title, 'font-size': '28px' }, small: { 'font-size': '22px' } },
      { type: 'text', when: [set('card.facts')], text: '{card.facts}', style: { 'font-size': '13px', color: '$ink-soft' } },
    ] },
    playButton('{episode.playLabel}', '{s:resume} {card.name}', '{card.id}', true, [set('card.hasProgress')]),
    playButton('{episode.playLabel}', '{s:play} {card.name}', '{card.id}', true, [not('card.hasProgress')]),
  ] } };

// Season tabs light at once when picked; the episodes dim until the foundation answers.
const seasonPill: Style = { ...row, position: 'relative', 'align-items': 'center', height: '42px', 'box-sizing': 'content-box', padding: '0px 18px', border: '2.5px solid $ink', 'border-radius': '999px', color: '$ink', 'font-family': fredoka, 'font-weight': '600', 'flex-shrink': '0', cursor: 'pointer', 'background-color': '$card', 'box-shadow': '0px 2px 0px $ink' };
const episodeList: Style = { ...col, gap: '14px', transition: 'opacity 200ms linear' };
const episodesBody: Node[] = [
  sectionHeading('{s:episodes}', 'Episodes', 'layers'),
  { type: 'box', when: [{ test: 'detail.seasonCount', is: 'gt', value: '1' }], style: { ...row, 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, small: { 'margin-left': '-16px', 'margin-right': '-16px' }, children: [
    { type: 'box', role: 'group', label: '{s:season}', testId: 'season-picker', style: { ...row, gap: '10px', padding: '4px 16px 8px' }, children: [
      { type: 'repeat', over: 'detail.seasons', item: { type: 'box', press: { action: 'select', arg: '{season.pick}' }, label: '{card.name}', a11y: { pressed: [set('season.on')] },
        style: seasonPill, states: [{ when: [set('season.on')], style: { ...seasonPill, 'background-color': '$pink', 'box-shadow': '0px 4px 0px $ink' } }],
        hover: { scale: '1.05' }, focus: { 'box-shadow': ring }, ...active(press94), children: [
          { type: 'text', text: '{card.name}', style: { 'font-size': '15px' } },
        ] } },
    ] },
  ] },
  upNext,
  { type: 'box', style: episodeList, small: { gap: '12px' }, states: [{ when: [set('detail.seasonPending')], style: { ...episodeList, opacity: '0.5' } }], ...pending({ a11y: { busy: [set('detail.seasonPending')] } }), children: [
    { type: 'repeat', over: 'detail.episodes', item: episodeCard },
  ] },
];
// Shown when the title has seasons or episodes (two conditions, so two entries).
const episodesSection = (when: Condition[]): Node => ({ type: 'box', when: [ready, ...when], motion: 'hop380', style: { ...col, ...side, gap: '22px' }, small: { ...sideSmall(16), gap: '16px' }, children: episodesBody });

const extraTile = (readyTile: boolean): Node => ({ type: 'box', when: [readyTile ? set('extra.ready') : not('extra.ready')],
  ...(readyTile ? { press: { action: 'playExtra', arg: '{extra.id}' }, label: '{s:play} {extra.name}', ...puffy } : { role: 'group', label: '{extra.name} · {s:notAvailable}' }),
  style: { ...Puffy, 'justify-content': 'flex-start', 'border-radius': '22px', width: '270px', height: '104px', padding: '16px', 'flex-shrink': '0', gap: '14px', ...(readyTile ? {} : { opacity: '0.5', 'box-shadow': 'none', cursor: 'default' }) },
  small: { width: '220px', height: '92px' }, children: [
    { type: 'box', style: { ...row, 'align-items': 'center', 'justify-content': 'center', ...sz(42), 'border-radius': '21px', 'background-color': readyTile ? '$pink' : '$lavender-soft', border: '2.5px solid $ink', 'box-sizing': 'border-box' }, children: [icon(readyTile ? 'play' : 'lock', 14)] },
    { type: 'box', style: { ...col, gap: '4px', flex: '1', 'min-width': '0px', 'text-align': 'left' }, children: [
      { type: 'text', text: '{extra.name}', style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '2' } },
      ...(readyTile ? [] : [{ type: 'text', text: '{s:notAvailableYet}', style: { 'font-size': '12px', color: '$ink-soft' } } as Node]),
    ] },
  ] } as Node);

const extras: Node = { type: 'box', when: [ready, set('detail.hasExtras')], motion: 'hop420', style: { ...col, gap: '14px' }, children: [
  { type: 'box', style: { ...col, 'padding-left': 'max(48px, 5vw)' }, small: { 'padding-left': '16px' }, children: [sectionHeading('{s:extras}', 'Extras', 'star')] },
  { type: 'box', style: { ...row, 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', gap: '16px', ...side, 'padding-top': '6px', 'padding-bottom': '14px' }, small: sideSmall(16), children: [
    { type: 'repeat', over: 'detail.extras', item: extraTile(true) },
    { type: 'repeat', over: 'detail.extras', item: extraTile(false) },
  ] },
] };

const cast: Node = { type: 'box', when: [ready, set('detail.hasCast')], motion: 'hop460', style: { ...col, gap: '14px', ...side }, small: sideSmall(16), children: [
  sectionHeading('{s:featuring}', 'Featuring', 'heart'),
  { type: 'box', style: { ...row, gap: '10px', 'flex-wrap': 'wrap' }, children: [
    { type: 'repeat', over: 'detail.cast', item: { type: 'box', style: { ...row, gap: '10px', 'align-items': 'center', padding: '5px 16px 5px 5px', 'border-radius': '999px', 'background-color': '$card', border: '2.5px solid $ink', 'box-shadow': '0px 3px 0px $ink' }, children: [
      ...byAccent('person', a => ({ type: 'text', text: '{person.initials}', style: { ...sz(30), 'border-radius': '15px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-family': pixelFace, 'font-size': '14px', 'font-weight': '700', 'background-color': `$${a}` } })),
      { type: 'text', text: '{person.name}', style: { 'font-size': '15px', 'font-weight': '550' } },
    ] } },
  ] },
] };

const crew: Node = { type: 'box', when: [ready, set('detail.crewLine')], motion: 'hop480', style: { ...col, gap: '12px', ...side }, small: sideSmall(16), children: [
  sectionHeading('{s:behindTheStory}', 'Behind the story', 'sparkle'),
  { type: 'text', text: '{detail.crewLine}', style: { 'font-size': '15px', color: '$ink-soft', 'line-height': '1.7', 'max-width': '48rem' } },
] };

const related: Node = { type: 'repeat', over: 'detail.related', when: [ready], item: { type: 'use', template: 'relatedShelf', motion: 'hop500' } as Node };

// The title page opens as a framed page over the route frame's blurred scrim (detail.frame),
// with an ink-ringed close button.
// (The compiled trait's frame shadow named `var(--mochi.ink)` in a bound row, which never
// resolved, so the frame draws without one; matched here.)
const title: Node = { type: 'box', style: { ...col, position: 'relative', height: '100%' }, children: [
  { type: 'box', style: { ...col, ...inset0, 'box-sizing': 'border-box', padding: '4vh 4vw', color: '$ink' }, small: { padding: '0px' }, children: [
    { type: 'box', motion: 'pageOpen', style: { ...col, position: 'relative', flex: '1', 'min-height': '0px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'border-radius': '28px', 'background-color': '$page' },
      small: { 'border-radius': '0px' }, children: [
        { type: 'box', id: 'back', press: { action: 'back' }, label: '{s:closeTitle}', testId: 'detail-close', style: { position: 'absolute', top: '20px', right: '20px', 'z-index': '10', ...sz(44), 'box-sizing': 'border-box', padding: '13px', border: '3px solid $ink', 'border-radius': '22px', 'background-color': '$card', 'backdrop-filter': 'blur(20px) saturate(1.3)', color: '$ink' },
          // The glyph keeps its 18px size inside the 12px content box (as the foundation's close does).
          children: [{ type: 'icon', symbol: 'close', style: { ...sz(18) } }] },
        { type: 'box', id: '{env.route}-scroll-{env.entry}', role: 'region', label: '{s:titleDetails}', style: { ...col, flex: '1', 'min-height': '0px', 'overflow-y': 'auto', 'overflow-x': 'hidden', gap: '46px', 'padding-bottom': '72px', color: '$ink', 'font-family': fredoka },
          small: { gap: '34px' }, children: [
            // Opening: Mochi hopping where the page will be; failed: a sad Mochi.
            { type: 'box', when: [is('env.load', 'loading')], role: 'status', label: '{s:openingTitle}', motion: 'statusIn', style: { ...col, gap: '34px' }, small: { gap: '26px' }, children: [
              { type: 'box', style: { ...col, position: 'relative', height: '70vh', 'border-radius': '34px', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box' }, small: { 'border-radius': '26px' }, children: [
                { ...loader('{s:openingTitle}', 80), small: { display: 'none' } } as Node,
                { ...loader('{s:openingTitle}', 64), style: { display: 'none' }, small: { ...col, 'align-items': 'center', gap: '14px' } } as Node,
              ] },
            ] },
            failed('{s:titleFailed}'),
            titleHead,
            episodesSection([set('detail.hasEpisodes')]), episodesSection([not('detail.hasEpisodes'), set('detail.hasSeasons')]),
            extras, cast, crew, related,
          ] },
      ] },
  ] },
] };

// ---------------------------------------------------------------- motion

const fade = (duration: number) => ({ keyframes: 'dissolve', duration });
const hop = (delay: number) => ({ keyframes: 'doc:hop', duration: 560, delay, easing: boing, fill: 'both' as const, still: fade(200) });
const popIn = (delay: number) => ({ keyframes: 'doc:pop', duration: 520, delay, easing: boing, fill: 'both' as const, still: fade(200) });
const float = (seconds: number) => ({ keyframes: 'doc:float', duration: seconds * 1000, easing: 'ease-in-out', iterations: 'infinite' as const, fill: 'none' as const });
const vanish = (duration: number) => ({ keyframes: 'vanish', duration, easing: 'ease-in', fill: 'both' as const, still: { keyframes: 'vanish', duration: 120 } });

export default {
  schema: 1, renderer: 11, id, name: 'Mochi', version,
  tagline: 'Pastel pink, pixel sparkles and a bouncy friend for anime nights.',
  preview: asset('preview.jpg'), swatches: ['#fff0f6', '#3b1f4a', '#ff7eb6', '#b9a0ff', '#8fe8c9'],
  traits: { page: '$page', ink: '$ink', barMask: false, splashOnPaper: true, flatDetail: false },
  tokens: {
    page: '#fff0f6', 'page-deep': '#ffe2ee', 'page-clear': '#fff0f600',
    ink: '#3b1f4a', 'ink-soft': '#6b4f7d', 'ink-quiet': '#8f789f',
    card: '#ffffff', 'card-soft': '#fff8fb', edge: '#ffffff', line: '#3b1f4a1f', 'line-strong': '#3b1f4a38',
    pink: '#ff7eb6', 'pink-hover': '#ff97c4', 'pink-deep': '#d94c8f', 'pink-soft': '#ffc8df', 'pink-wash': '#ffd9e9',
    lavender: '#b9a0ff', 'lavender-soft': '#e6dcff', 'lavender-deep': '#7b5ae0',
    mint: '#8fe8c9', 'mint-soft': '#d6f8ec', butter: '#ffe48a', 'butter-soft': '#fff4c7', sky: '#a8dcff',
    shadow: '#c4a6f2', 'shadow-pink': '#f4a6c9', 'shadow-soft': '#7b5ae033',
    scrim: '#2a1546a6', 'scrim-soft': '#2a154640', 'scrim-clear': '#2a154600', focus: '#7b5ae0',
    skeleton: '#f6d3e4', 'skeleton-light': '#fff4f9', alert: '#ffe1e9',
    night: '#1d1236', 'night-2': '#2b1a52', 'night-3': '#3e2870', 'night-clear': '#1d123600', 'night-veil': '#1d1236cc', 'night-deep': '#120a24f2',
    'night-card': '#ffffff12', 'night-card-hover': '#ffffff1f', 'night-edge': '#ffffff2b', 'night-edge-strong': '#ffffff55',
    'night-ink': '#fff4fb', 'night-soft': '#dccbf5', 'night-quiet': '#a996cc', star: '#fff6c9', sakura: '#ffb7d5',
  },
  strings: { en: {
    name: 'Mochi', vela: 'vela', velaHome: 'Vela home', mainNavigation: 'Main navigation', home: 'Home', live: 'Live TV', search: 'Search',
    profileAndAppearance: 'Profile and appearance', hello: 'Hi there', appearance: 'Appearance', install: 'Install Vela', update: 'Update ready, reload', signOut: 'Sign out',
    pickedForYou: 'Picked for you', peek: 'Take a peek', featuredTitles: 'Featured titles', featuredTitle: 'Featured title', of: 'of',
    searchPlaceholder: 'Find a show, a vibe, a whole new world…', searchYourLibrary: 'Search your library', clearSearch: 'Clear search',
    loadingMore: 'Loading more…', nothingHereYet: 'Nothing here yet', noRowsYet: "Your library hasn't offered any rows yet. Titles appear here as your server adds them.",
    closeTitle: 'Close title', titleDetails: 'Title details', openingTitle: 'Opening title…', somethingWentQuiet: 'Something went quiet', titleFailed: "This title couldn't be opened. It may no longer be available.",
    watchTrailer: 'Watch trailer', watchProgress: 'Watch progress', watchProgressOf: 'Watch progress:', episodes: 'Episodes', season: 'Season', episode: 'Episode',
    extras: 'Extras', featuring: 'Featuring', behindTheStory: 'Behind the story', play: 'Play', resume: 'Resume', watched: 'Watched', notAvailable: 'Not available', notAvailableYet: 'Not available yet', tryAgain: 'Try again',
    findingYourEvening: 'Finding your evening…', findingTitles: 'Finding titles…', library: 'Library', all: 'All', unwatched: 'Unwatched', watchedFilter: 'Watched', favourites: 'Favourites',
    genre: 'Genre', anyGenre: 'Any genre', sortBy: 'Sort by', ascending: 'Ascending', descending: 'Descending', loadMore: 'Show more', libraryEmpty: 'Nothing matches these filters', libraryEmptyHint: 'Try another genre or clear a filter.',
    libraryFailed: "This library couldn't be opened. Check your connection and try again.", homeFailed: "Your library couldn't be reached. Check your server connection.",
  } },
  fonts: {
    fredoka: { family: 'Fredoka', files: [{ url: asset('fredoka.ttf'), weight: '300 700', style: 'normal' }] },
    pixel: { family: 'Pixelify Sans', files: [{ url: asset('pixelify-sans.ttf'), weight: '400 700', style: 'normal' }] },
  },
  // look.contract's keyframes, as data.
  keyframes: {
    hop: { from: { opacity: 0, translate: '0px 26px', scale: 0.94 } },
    pop: { from: { opacity: 0, scale: 0.7 } },
    wiggle: { '0%': { rotate: 0 }, '25%': { rotate: -4 }, '50%': { rotate: 3 }, '75%': { rotate: -2 }, '100%': { rotate: 0 } },
    float: { '50%': { translate: '0px -7px' } },
    twinkle: { '0%': { opacity: 1, scale: 1 }, '50%': { opacity: 0.2, scale: 0.55 }, '100%': { opacity: 1, scale: 1 } },
    bubble: { from: { opacity: 0, scale: 0.6, translate: '0px 8px' } },
    bounce: { '0%': { translate: '0px 0px', scale: 0.96, rotate: 0 }, '14%': { translate: '0px -4px', scale: 1.02, rotate: 0 }, '45%': { translate: '0px -22px', scale: 1.04, rotate: -6 }, '72%': { translate: '0px 0px', scale: 1, rotate: 0 }, '86%': { translate: '0px 1px', scale: 0.95, rotate: 0 }, '100%': { translate: '0px 0px', scale: 0.96, rotate: 0 } },
    shadow: { '0%': { scale: 1, opacity: 0.5 }, '45%': { scale: 0.6, opacity: 0.25 }, '72%': { scale: 1, opacity: 0.5 }, '100%': { scale: 1, opacity: 0.5 } },
    burst: { '0%': { opacity: 1, translate: '0px 0px', scale: 0.3 }, '60%': { opacity: 1 }, '100%': { opacity: 0, translate: '0px -54px', scale: 1.1 } },
  },
  motion: {
    navIn: { keyframes: 'doc:hop', duration: 600, easing: boing, fill: 'both', still: fade(200) },
    menuPop: { keyframes: 'doc:pop', duration: 360, easing: boing, fill: 'both', still: fade(160) },
    menuOut: vanish(160), heroOut: vanish(220), rowOut: vanish(200),
    wiggle: { keyframes: 'doc:wiggle', duration: 520, easing: 'ease-in-out', fill: 'both' },
    twinkle: { keyframes: 'doc:twinkle', duration: 2400, easing: 'ease-in-out', iterations: 'infinite', fill: 'none' },
    sparklePop: { keyframes: 'doc:pop', duration: 300, easing: 'ease-out', fill: 'both' },
    bubble: { keyframes: 'doc:bubble', duration: 300, easing: boing, fill: 'both', still: { keyframes: 'dissolve', duration: 120 } },
    burst: { keyframes: 'doc:burst', duration: 620, easing: settle, fill: 'both' },
    hopBounce: { keyframes: 'doc:bounce', duration: 900, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', iterations: 'infinite', fill: 'none' },
    hopShadow: { keyframes: 'doc:shadow', duration: 900, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', iterations: 'infinite', fill: 'none' },
    blink: { keyframes: 'tick', duration: 1000, easing: 'steps(1)', iterations: 'infinite', fill: 'none' },
    heroFill: { keyframes: 'fill', duration: 9000, easing: 'linear', fill: 'both' },
    float36: float(3.6), float50: float(5), float32: float(3.2),
    pop0: popIn(0), pop60: popIn(60), pop120: popIn(120), pop260: popIn(260),
    hop0: hop(0), hop40: hop(40), hop90: hop(90), hop160: hop(160), hop260: hop(260), hop380: hop(380), hop420: hop(420), hop460: hop(460), hop480: hop(480), hop500: hop(500), hopRow: hop(120),
    shimmer: { keyframes: 'shimmer', duration: 1600, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', iterations: 'infinite', fill: 'none' },
    statusIn: { keyframes: 'dissolve', duration: 400, easing: 'ease-out', fill: 'both', still: fade(200) },
    pageOpen: { keyframes: 'open', duration: 680, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both', still: fade(240) },
  },
  // Home draws its own loading and failure states.
  status: true,
  templates: { card, gridCard, shelf: shelf(true), relatedShelf: shelf(false) },
  slots: { shell, home },
  routes: { title, library },
  detail: { wide: 'fullscreen', small: 'fullscreen', frame: { scrim: '$scrim' } },
} as unknown as SkinDocument;

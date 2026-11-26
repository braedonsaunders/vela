// Mochi's look: fonts, motion curves, the candy/puffy/bubble surfaces, shared conditions, and the
// small building blocks (icons, Mochi, the hopping loader, the empty-state bubble) every page uses.
import type { Condition, Node, Style } from '../../../skin';
import { PIXEL } from './pixel';

export const id = 'mochi',
  version = '1.0.18';
export const asset = (file: string) => `/vela/v0/appearance/skins/${id}/${version}/${file}`;

export const fredoka = 'Fredoka, ui-rounded, system-ui, sans-serif';
export const pixelFace = '"Pixelify Sans", ui-monospace, monospace';
export const boing = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
export const settle = 'cubic-bezier(0.22, 1, 0.36, 1)';
// Hover and focus lift on cards and controls; under reduced motion only the shadow moves.
export const lift = `translate 380ms ${boing}, rotate 380ms ${boing}, scale 380ms ${boing}, box-shadow 260ms ${settle}`;
export const liftStill = 'box-shadow 160ms linear';
export const ring = '0px 0px 0px 3px $card, 0px 0px 0px 6px $focus';

export const Pixel: Style = { 'font-family': pixelFace, 'font-weight': '600', 'letter-spacing': '0.02em' };
export const Title: Style = {
  'font-family': 'Fredoka, ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  'font-weight': '650',
  'letter-spacing': '-0.01em',
  'line-height': '1.02',
};
export const Label: Style = {
  'font-family': pixelFace,
  'font-size': '12px',
  'font-weight': '600',
  'letter-spacing': '0.08em',
  'text-transform': 'uppercase',
};
// Surfaces (look.contract): a candy (pink) and a puffy (white) pill, a round bubble.
// Heights include the edge (border-box): a candy written 60px is the compiled 54px plus its 3px edge.
// Browsers draw a 2.5px edge as 2px, so controls with one are 4px taller than their content.
export const Candy: Style = {
  position: 'relative',
  display: 'flex',
  'flex-direction': 'row',
  'align-items': 'center',
  'justify-content': 'center',
  'box-sizing': 'border-box',
  border: '3px solid $ink',
  'border-radius': '999px',
  'background-color': '$pink',
  color: '$ink',
  'font-family': fredoka,
  'font-weight': '650',
  'box-shadow': '0px 4px 0px $ink',
  cursor: 'pointer',
};
export const Puffy: Style = { ...Candy, 'background-color': '$card', 'font-weight': '600' };
export const Bubble: Style = {
  position: 'relative',
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  'box-sizing': 'border-box',
  border: '2.5px solid $ink',
  'border-radius': '999px',
  'background-color': '$card',
  color: '$ink',
  cursor: 'pointer',
  'flex-shrink': '0',
};
export const press94 = { scale: '0.94' };
export const candy = {
  hover: { 'background-color': '$pink-hover' },
  focus: { outline: 'auto', 'box-shadow': ring },
  active: press94,
};
export const puffy = {
  hover: { 'background-color': '$lavender-soft' },
  focus: { outline: 'auto', 'box-shadow': ring },
  active: press94,
};
export const bubble = {
  hover: { 'background-color': '$pink-wash' },
  focus: { outline: 'auto', 'box-shadow': ring },
  active: { scale: '0.9' },
};

export const inset0: Style = { position: 'absolute', top: '0px', right: '0px', bottom: '0px', left: '0px' };
export const fill: Style = { ...inset0, width: '100%', height: '100%', 'object-fit': 'cover' };
export const fadeIn: Style = { ...fill, transition: `opacity 360ms ${settle}` };
export const gutter: Style = { 'padding-left': 'max(24px, 3.6vw)', 'padding-right': 'max(24px, 3.6vw)' };
export const gutterSmall: Style = { 'padding-left': '16px', 'padding-right': '16px' };
export const sz = (w: number, h = w): Style => ({ width: `${w}px`, height: `${h}px`, 'flex-shrink': '0' });
export const row: Style = { display: 'flex', 'flex-direction': 'row' };
export const col: Style = { display: 'flex', 'flex-direction': 'column' };
// The shell recomposes under 720 px (compiled `compact`), routes under 640 (`small`).
export const COMPACT = '720';

export const is = (test: string, value: string): Condition => ({ test, is: 'eq', value });
export const not = (test: string): Condition => ({ test, not: true });
export const set = (test: string): Condition => ({ test });
export const stillC: Condition = set('env.still');
export const moving: Condition = not('env.still');
// The page's first answer has arrived (routes draw their loading and failure states before it).
export const ready: Condition = is('env.load', 'ready');

// Accents come from the name, so neighbours differ without reordering (compiled `accent`:
// name length % 3 is pink, lavender or mint; `tilt`: % 2 leans left or right).
export const ACCENTS = ['pink', 'lavender', 'mint'] as const;
export type Accent = (typeof ACCENTS)[number];
export const mod = (ctx: string, n: number, r: number): Condition => ({
  test: `${ctx}.nameLength`,
  is: 'mod',
  value: `${n}:${r}`,
});
export const byAccent = (ctx: string, make: (a: Accent) => Node): Node[] =>
  ACCENTS.map((a, i) => {
    const n = make(a);
    return { ...n, when: [...(n.when ?? []), mod(ctx, 3, i)] } as Node;
  });
// Our own copy's accent (section headings): the English label's length, as compiled.
export const accentOf = (text: string): Accent => ACCENTS[text.length % 3];

export type Extra = Partial<Node> & { style?: Style };
export const icon = (name: string, size: number, colour?: string, extra: Extra = {}): Node =>
  ({
    type: 'icon',
    paths: [PIXEL[name]],
    viewBox: '0 0 9 9',
    ...extra,
    style: { ...sz(size), ...(colour ? { color: `$${colour}` } : {}), ...(extra.style ?? {}) },
  }) as Node;
// Mochi: happy, wow, sleepy (nothing here yet) and sad (something went wrong).
export const mascot = (mood: string, size: number, extra: Extra = {}): Node =>
  ({
    type: 'image',
    src: asset(`mascot-${mood}.svg`),
    alt: '',
    ...extra,
    style: { ...sz(size, size * 0.9), ...(extra.style ?? {}) },
  }) as Node;
// A pixel sparkle that twinkles in place (look.contract Twinkle).
export const twinkle = (colour: string, size: number, extra: Extra = {}): Node =>
  icon('sparkle', size, colour, { motion: 'twinkle', ...extra });

// Mochi hopping with a squash over a shadow that breathes with it (look.contract Hopper).
export const hopper = (size: number, mood = 'happy'): Node => ({
  type: 'box',
  style: {
    ...col,
    position: 'relative',
    width: `${size}px`,
    height: `${size * 1.32}px`,
    'justify-content': 'flex-end',
    'align-items': 'center',
    'flex-shrink': '0',
  },
  children: [
    {
      type: 'box',
      motion: 'hopShadow',
      style: {
        position: 'absolute',
        bottom: '0px',
        width: `${size * 0.7}px`,
        height: `${size * 0.12}px`,
        'border-radius': '50%',
        'background-color': '$shadow-soft',
      },
    },
    mascot(mood, size, {
      motion: 'hopBounce',
      style: { position: 'relative', 'margin-bottom': `${size * 0.06}px`, 'transform-origin': '50% 100%' },
    }),
  ],
});
// The loading line: Mochi hopping above a caption with a blinking pixel cursor.
export const loader = (message: string, size: number): Node => ({
  type: 'box',
  role: 'status',
  label: message,
  style: { ...col, 'align-items': 'center', gap: '14px' },
  children: [
    hopper(size),
    {
      type: 'box',
      style: { ...row, gap: '4px', 'align-items': 'center' },
      children: [
        { type: 'text', text: message, style: { ...Pixel, 'font-size': '15px', color: '$ink-soft' } },
        { type: 'box', motion: 'blink', style: { ...sz(8, 14), 'background-color': '$pink' } },
      ],
    },
  ],
});

// A designed moment for empty results and failures: Mochi under a speech bubble.
export const emptyState = (mood: string, title: string, message: string): Node => ({
  type: 'box',
  role: 'status',
  motion: 'pop60',
  style: { ...col, 'align-items': 'center', 'text-align': 'center', gap: '12px', padding: '44px 24px 64px' },
  children: [
    {
      type: 'box',
      style: { ...col, position: 'relative', 'align-items': 'center' },
      children: [
        {
          type: 'box',
          style: {
            padding: '12px 22px',
            'border-radius': '24px',
            border: '3px solid $ink',
            'background-color': '$card',
            'box-shadow': '5px 5px 0px $shadow-pink',
          },
          children: [{ type: 'text', text: title, style: { ...Title, 'font-size': '26px' } }],
        },
        {
          type: 'image',
          src: asset('tail-down.svg'),
          alt: '',
          style: { ...sz(24, 14), 'margin-top': '-3px' },
        },
      ],
    },
    mascot(mood, 86, { motion: 'float32' }),
    ...(message
      ? [
          {
            type: 'text',
            text: message,
            style: { 'font-size': '15px', color: '$ink-soft', 'line-height': '1.55', 'max-width': '26rem' },
          } as Node,
        ]
      : []),
  ],
});

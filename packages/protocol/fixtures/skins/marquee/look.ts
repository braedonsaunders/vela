import type { Condition, Node, Style } from '../../../skin';

// Marquee, as a skin document (packages/protocol/skin.ts): a charcoal media-server look with
// amber accents. A left sidebar of Home and the libraries (an icon rail on narrower
// screens, a drawer on phones), a top bar with the wordmark, a centred search and the
// account menu; a featured banner over hubs of posters; flat title pages with the
// poster beside the facts. Every value here follows the compiled original it replaces.

export const id = 'marquee',
  version = '1.0.5';
export const asset = (file: string) => `/vela/v0/appearance/skins/${id}/${version}/${file}`;

export const sans =
  '"Open Sans", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", sans-serif';
export const ease = 'cubic-bezier(0.2, 0, 0, 1)';
// The top bar: 56 px, 52 on phones. Page gutters: 40 px, 14 on phones.
export const bar = { normal: 56, small: 52 };
export const gutter: Style = { 'padding-left': '40px', 'padding-right': '40px' };
export const gutterSmall: Style = { 'padding-left': '14px', 'padding-right': '14px' };
export const fill: Style = { position: 'absolute', inset: '0px' };
export const px = (n: number) => `${n}px`;
export const is = (test: string, value: string): Condition => ({ test, is: 'eq', value });
export const isnt = (test: string, value: string): Condition => ({ test, is: 'ne', value });
export const set = (test: string): Condition => ({ test });
export const unset = (test: string): Condition => ({ test, not: true });

// Icons: a platform symbol where one fits, else Marquee's own one-colour line glyph (path
// data in a 24-unit box, even-odd), painted in the current colour like a symbol.
const builtIn: Record<string, string> = {
  home: 'home',
  search: 'search',
  menu: 'menu',
  close: 'close',
  check: 'checkmark',
  info: 'info',
  signout: 'sign-out',
  alert: 'alert',
  live: 'radio',
  play: 'play-fill',
  heart: 'heart',
  sort: 'sort',
  filter: 'filter',
  sliders: 'adjust',
  volume: 'speaker',
  mute: 'speaker-mute',
  phone: 'smartphone',
  star: 'star',
  rows: 'list',
  person: 'person',
  back: 'back',
  pause: 'pause-fill',
};
const glyphs: Record<string, string[]> = {
  down: ['M4.6 8.6 6 7.2l6 6 6-6 1.4 1.4L12 16z'],
  expand: ['M3 3h7v2H5v5H3z M14 3h7v7h-2V5h-5z M21 14v7h-7v-2h5v-5z M10 21H3v-7h2v5h5z'],
  film: [
    'M3 4h18v16H3z M8 5.6h8v12.8H8z M4.5 6h2v2h-2z M4.5 11h2v2h-2z M4.5 16h2v2h-2z M17.5 6h2v2h-2z M' +
      '17.5 11h2v2h-2z M17.5 16h2v2h-2z',
  ],
  grid: ['M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z'],
  left: ['M15.4 4.6 16.8 6l-6 6 6 6-1.4 1.4L8 12z'],
  pip: ['M2 4h20v16H2z M3.8 5.8h16.4v12.4H3.8z M11 11h7.2v5.2H11z'],
  right: ['M8.6 4.6 7.2 6l6 6-6 6 1.4 1.4L16 12z'],
  'skip-back': [
    'M7.55 5.88A8.4 8.4 0 1 0 16.82 6.12L15.79 7.59A6.6 6.6 0 1 1 8.50 7.40ZM12.00 2.50L8.60 5.50L12.00 8.50Z M' +
      '8.2 10.2h1.6v5.8H8.2z M11.4 10.2h1.5v5.8h-1.5z M14.4 10.2h1.5v5.8h-1.5z M' +
      '12.9 10.2h1.5v1.4h-1.5z M12.9 14.6h1.5v1.4h-1.5z',
  ],
  'skip-forward': [
    'M16.45 5.88A8.4 8.4 0 1 1 7.18 6.12L8.21 7.59A6.6 6.6 0 1 0 15.50 7.40Z M' +
      '12.00 2.50L15.40 5.50L12.00 8.50Z M8.2 10.2h1.6v5.8H8.2z M11.4 10.2h1.5v5.8h-1.5z M' +
      '14.4 10.2h1.5v5.8h-1.5z M12.9 10.2h1.5v1.4h-1.5z M12.9 14.6h1.5v1.4h-1.5z',
  ],
  stack: ['M3.5 9h17v11.5h-17z M5.3 10.8h13.4v7.9H5.3z M6 5.8h12v1.7H6z M8.5 2.8h7v1.7h-7z'],
  tv: [
    'M2.5 6.5h19v13h-19z M4.3 8.3h15.4v9.4H4.3z M7.3 3.3l1.2-1.2 4.1 4.1-1.2 1.2z M' +
      '16.7 3.3l-1.2-1.2-4.1 4.1 1.2 1.2z M8 20.5h8v1.6H8z',
  ],
  up: ['M4.6 15.4 6 16.8l6-6 6 6 1.4-1.4L12 8z'],
};
export const glyph = (name: string, size: number, extra: Partial<Node> = {}): Node =>
  ({
    type: 'icon',
    ...(builtIn[name]
      ? { symbol: builtIn[name] }
      : { paths: glyphs[name], viewBox: '0 0 24 24', fillRule: 'evenodd' }),
    ...extra,
    style: { width: px(size), height: px(size), 'flex-shrink': '0', ...(extra.style ?? {}) },
  }) as Node;

// The Vela lockup for dark grounds, 2.629:1.
export const wordmark = (h: number): Node => ({
  type: 'image',
  src: 'assets/brand/vela-lockup.svg',
  alt: '',
  style: { width: `${h * 2.629}px`, height: px(h), 'flex-shrink': '0' },
});

// Controls. Hover and press feedback is quick and flat.
export const quick = 'background-color 120ms linear, color 120ms linear';
export const ring = (c: string) => `0px 0px 0px 2px ${c}`;
// Marquee's controls draw their own hover and focus; Exact's control wash stays off (compiled classes replace it).
export const round = (
  size: number,
): Pick<Node, 'style' | 'hover' | 'focus' | 'active'> & { controlStates: boolean } => ({
  controlStates: false,
  style: {
    position: 'relative',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'box-sizing': 'border-box',
    width: px(size),
    height: px(size),
    outline: 'auto',
    'border-radius': '999px',
    'background-color': 'transparent',
    color: '$ink-dim',
    'flex-shrink': '0',
    'pointer-events': 'auto',
  },
  hover: { 'background-color': '$hover', color: '$ink' },
  focus: { 'box-shadow': ring('$amber'), color: '$ink' },
  active: { scale: '0.94' },
});
export const primary = (h: number, pad: string): Pick<Node, 'style' | 'hover' | 'focus'> =>
  ({
    style: {
      position: 'relative',
      display: 'flex',
      'flex-direction': 'row',
      gap: '8px',
      'align-items': 'center',
      'justify-content': 'center',
      'box-sizing': 'border-box',
      height: px(h),
      padding: pad,
      outline: 'auto',
      'border-radius': '6px',
      'background-color': '$amber',
      color: '$on-amber',
      'font-weight': '700',
    },
    hover: { 'background-color': '$amber-hover' },
    focus: { 'box-shadow': '0px 0px 0px 2px $page, 0px 0px 0px 4px $ink' },
    active: { scale: '0.98' },
  }) as Pick<Node, 'style' | 'hover' | 'focus'>;
export const secondary = (h: number, pad: string): Pick<Node, 'style' | 'hover' | 'focus'> =>
  ({
    style: {
      position: 'relative',
      display: 'flex',
      'flex-direction': 'row',
      gap: '8px',
      'align-items': 'center',
      'justify-content': 'center',
      'box-sizing': 'border-box',
      height: px(h),
      padding: pad,
      outline: 'auto',
      'border-radius': '6px',
      'background-color': '$control',
      color: '$ink',
      'font-weight': '600',
    },
    hover: { 'background-color': '$control-hover' },
    focus: { 'box-shadow': ring('$amber') },
    active: { scale: '0.98' },
  }) as Pick<Node, 'style' | 'hover' | 'focus'>;
export const avatar = (size: number, font: number): Node => ({
  type: 'text',
  text: '{env.viewerInitial}',
  style: {
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    width: px(size),
    height: px(size),
    'border-radius': px(size / 2),
    'font-size': px(font),
    'font-weight': '700',
    color: '$on-amber',
    'background-color': '$amber',
  },
});
export const label: Style = {
  'font-size': '12px',
  'font-weight': '700',
  'letter-spacing': '0.06em',
  'text-transform': 'uppercase',
  color: '$ink-faint',
};
export const oneLine: Style = {
  'white-space': 'nowrap',
  'overflow-x': 'hidden',
  'overflow-y': 'hidden',
  'text-overflow': 'ellipsis',
};

import type { Condition, Node, Style } from '../../../wire/v0/skin';

export const gutter: Style = { 'padding-left': 'max(28px, 4vw)', 'padding-right': 'max(28px, 4vw)' } as Style;
export const gutterSmall = { 'padding-left': '18px', 'padding-right': '18px' } as Style;
export const sans = '$ui.font';
export const enter = (delay: number) => `velaEnter${delay}`;
export const enterPresets = Object.fromEntries(
  [0, 60, 80, 120, 140, 200, 220, 260, 280, 300, 340, 380, 400, 420, 440, 480, 500, 520, 560, 580, 600].map(
    d => [
      enter(d),
      {
        keyframes: 'rise',
        duration: 640,
        delay: d,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'both' as const,
        still: { keyframes: 'dissolve', duration: 240 },
      },
    ],
  ),
);

// Compiled's GhostPill keeps the browser's content-box, so its border sits outside the height.
export const pill = (primary: boolean): Style =>
  ({
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'box-sizing': primary ? 'border-box' : 'content-box',
    height: '56px',
    'border-radius': '$ui.radiusControl',
    'padding-left': primary ? '28px' : '24px',
    'padding-right': primary ? '32px' : '26px',
    border: primary ? 'none' : '1px solid $ui.glassEdge',
    'background-color': primary ? '$ui.ink' : '$ui.control',
    color: primary ? '$ui.inkInverse' : '$ui.ink',
    'backdrop-filter': primary ? 'none' : 'blur(20px) saturate(1.3)',
    'font-weight': primary ? '650' : '600',
    transition: 'background-color 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
  }) as Style;

// The brand lockup (client/assets/brand, two-tone), one image node.
export const markSize = (size: number): Style => ({
  width: `${+(size * 2.629).toFixed(3)}px`,
  height: `${size}px`,
});
export const wordmark = (size: number, small: number): Node => ({
  type: 'image',
  src: 'assets/brand/vela-lockup.svg',
  alt: '',
  style: markSize(size),
  small: markSize(small),
});

// The pill and icon buttons' keyboard ring, and a nav link's.
export const focusRing = '0px 0px 0px 2px $ui.page, 0px 0px 0px 4px $ui.accent';
export const navFocus: Style = { 'box-shadow': '0px 0px 0px 2px $ui.accent', color: '$ui.ink' };

export const small: Condition = { test: 'env.small' };
// Waiting marks, as compiled cinematic draws them: three breathing dots (still under
// reduced motion) and shimmering skeleton blocks.
export const pulse: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'row', gap: '8px' },
  children: [0, 180, 360].flatMap(d => [
    {
      type: 'box',
      when: [{ test: 'env.still', not: true }],
      motion: `velaPulse${d}`,
      style: { width: '7px', height: '7px', 'border-radius': '4px', 'background-color': '$ui.accent' },
    } as Node,
    {
      type: 'box',
      when: [{ test: 'env.still' }],
      style: {
        width: '7px',
        height: '7px',
        'border-radius': '4px',
        'background-color': '$ui.accent',
        opacity: '0.8',
      },
    } as Node,
  ]),
};
export const skeleton = (style: Style, small?: Style): Node => ({
  type: 'box',
  style: {
    'flex-shrink': '0',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    'background-color': '$ui.skeleton',
    ...style,
  },
  ...(small ? { small } : {}),
  children: [
    {
      type: 'box',
      when: [{ test: 'env.still', not: true }],
      motion: 'velaShimmer',
      style: {
        width: '100%',
        height: '100%',
        'background-image': 'linear-gradient(90deg, #090b0e00 0%, $ui.skeletonLight 50%, #090b0e00 100%)',
      },
    },
  ],
});
export const rowSkeleton: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column', gap: '18px', 'padding-bottom': '28px' },
  children: [
    {
      type: 'box',
      style: { ...gutter },
      small: { ...gutterSmall },
      children: [skeleton({ width: '180px', height: '20px', 'border-radius': '6px' })],
    },
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '18px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        ...gutter,
      },
      small: { gap: '12px', ...gutterSmall },
      children: Array.from(
        { length: 8 },
        () =>
          ({
            type: 'box',
            style: { display: 'flex', 'flex-direction': 'column', gap: '10px', 'flex-shrink': '0' },
            children: [
              skeleton(
                {
                  width: 'clamp(150px, 12.4vw, 232px)',
                  height: 'clamp(225px, 18.6vw, 348px)',
                  'border-radius': '12px',
                },
                { width: '132px', height: '198px' },
              ),
              skeleton({ width: '70%', height: '12px', 'border-radius': '4px' }),
            ],
          }) as Node,
      ),
    },
  ],
};

// The title page as a route (a first cut: the full Detail is the UI lead's conversion).
// The title page, as compiled cinematic draws it (skins/cinematic/detail.contract).
export const side: Style = {
  'padding-left': 'max(32px, 5.5vw)',
  'padding-right': 'max(32px, 5.5vw)',
} as Style;
export const sideSmall: Style = { 'padding-left': '20px', 'padding-right': '20px' } as Style;
export const display: Style = {
  'font-family': '$ui.fontDisplay',
  'font-weight': '400',
  'letter-spacing': '-0.01em',
  'line-height': '0.98',
} as Style;
export const eyebrow: Style = {
  'font-size': '11px',
  'font-weight': '600',
  'letter-spacing': '0.24em',
  'text-transform': 'uppercase',
} as Style;
export const ghost: Style = {
  border: '1px solid $ui.glassEdge',
  'border-radius': '$ui.radiusControl',
  'background-color': '$ui.control',
  'backdrop-filter': 'blur(20px) saturate(1.3)',
  color: '$ui.ink',
  'font-weight': '600',
  transition: 'background-color 180ms linear',
} as Style;
export const sectionHeading = (key: string): Node => ({
  type: 'text',
  text: `{s:${key}}`,
  role: 'heading',
  level: 2,
  style: { ...display, 'font-size': '34px' },
  small: { 'font-size': '28px' },
});

// Loading and failure (status: true), as compiled cinematic's Status draws them: home's
// shape in skeletons while it loads, the title's while it opens, and a quiet empty state
// with Try again when either fails.
export const is = (test: string, value: string): Condition => ({ test, is: 'eq', value });
export const ready: Condition = is('env.load', 'ready');
export const bone = (width: string, height: string, radius: number, small?: Style): Node =>
  skeleton({ width, height, 'border-radius': `${radius}px` }, small);
// A centred, quiet moment: an icon in a glass ring, a display title and a line of help.
export const emptyState = (icon: string, title: string, message: string): Node => ({
  type: 'box',
  role: 'status',
  motion: enter(80),
  style: {
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    'text-align': 'center',
    gap: '14px',
    padding: '56px 24px 72px',
  },
  children: [
    {
      type: 'box',
      style: {
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        width: '64px',
        height: '64px',
        'border-radius': '32px',
        'background-color': '$ui.glass',
        border: '1px solid $ui.glassEdge',
        'box-shadow': 'inset 0px 1px 0px #ffffff2e',
        'margin-bottom': '6px',
      } as Style,
      children: [
        { type: 'icon', symbol: icon, style: { width: '24px', height: '24px', color: '$ui.accent' } },
      ],
    },
    { type: 'text', text: title, style: { ...display, 'font-size': '32px' } },
    {
      type: 'text',
      text: message,
      style: { 'font-size': '15px', color: '$ui.inkSecondary', 'line-height': '1.55', 'max-width': '28rem' },
    },
  ],
});
export const failure = (message: string): Node => ({
  type: 'box',
  when: [is('env.load', 'failed')],
  style: { display: 'flex', 'flex-direction': 'column', gap: '4px' },
  children: [
    emptyState('alert', '{t:ui.somethingWentQuiet}', message),
    {
      type: 'box',
      when: [{ test: 'env.canRetry' }],
      style: { display: 'flex', 'flex-direction': 'row', 'justify-content': 'center' },
      children: [
        {
          type: 'box',
          press: { action: 'retry' },
          label: '{t:ui.tryAgain}',
          style: {
            ...pill(true),
            position: 'relative',
            height: '44px',
            'padding-left': '24px',
            'padding-right': '24px',
            'font-size': '14px',
          },
          hover: { 'background-color': '#ffffff' },
          focus: { 'box-shadow': focusRing },
          children: [{ type: 'text', text: '{t:ui.tryAgain}' }],
        },
      ],
    },
  ],
});

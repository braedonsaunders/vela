// Jelly Twin's shared look: tokens in use, layout helpers, glyphs, control styles and the status views.
import type { Action, Condition, Node, Style } from '../../../skin';

export type Press = { action: Action; arg?: string; focus?: string };

export const id = 'jellytwin';
export const version = '1.0.17';
export const asset = (file: string) => `/vela/v0/appearance/skins/${id}/${version}/${file}`;

export const sans = '"Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const gradient = 'linear-gradient(90deg, $violet 0%, $accent 100%)';
// The page gutter: 3.3% of the width, 14px on a phone.
export const side: Style = { 'padding-left': '3.3%', 'padding-right': '3.3%' };
export const sideSmall: Style = { 'padding-left': '14px', 'padding-right': '14px' };
export const row = (s: Style = {}): Style => ({ display: 'flex', 'flex-direction': 'row', ...s });
export const col = (s: Style = {}): Style => ({ display: 'flex', 'flex-direction': 'column', ...s });
export const fill: Style = { position: 'absolute', inset: '0px' };
// The shell recomposes under 800px (the compiled skin's `compact`); pages under 640px (`small`).
export const COMPACT = '800';
// A bottom hairline (the other sides stay unbordered).
export const hairline: Style = {
  'border-width': '0px',
  'border-style': 'solid',
  'border-bottom-width': '1px',
  'border-bottom-color': '$line',
};
// A library destination that is the server's live television.
export const isLive: Condition = { test: 'dest.kind', is: 'eq', value: 'live' };
export const not = (c: Condition): Condition => ({ ...c, not: !c.not });

// Glyphs: platform symbols, and the skin's own single-path line icons painted in currentColor.
export const glyph = (symbol: string, size: number, extra: Partial<Node> = {}): Node =>
  ({
    type: 'icon',
    symbol,
    style: { width: `${size}px`, height: `${size}px`, 'flex-shrink': '0' },
    ...extra,
  }) as Node;
const PATHS: Record<string, [string, boolean]> = {
  film: [
    [
      'M3 4h18v16H3Z',
      'M8 6h8v12H8Z',
      'M4.5 6h2v2h-2Z',
      'M4.5 11h2v2h-2Z',
      'M4.5 16h2v2h-2Z',
      'M17.5 6h2v2h-2Z',
      'M17.5 11h2v2h-2Z',
      'M17.5 16h2v2h-2Z',
    ].join(' '),
    true,
  ],
  tv: ['M2 5h20v13H2Z M4 7h16v9H4Z M11.2 18h1.6v2h-1.6Z M7.5 20h9v1.6h-9Z', true],
  folder: ['M3 5h6.2l2 2.5H21V19H3Z M5 9.5h14V17H5Z', true],
  live: [
    [
      'M2 5h20v13H2Z',
      'M4 7h16v9H4Z',
      'M12 9.2a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6Z',
      'M11.2 18h1.6v2h-1.6Z',
      'M7.5 20h9v1.6h-9Z',
      'M8.4 1.2 12 4.2 15.6 1.2 16.6 2.4 12.9 5.4h-1.8L7.4 2.4Z',
    ].join(' '),
    true,
  ],
  left: ['M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12Z', false],
  right: ['M8.6 5.4 10 4l8 8-8 8-1.4-1.4 6.6-6.6Z', false],
};
export const jelly = (name: string, size: number, extra: Partial<Node> = {}): Node =>
  ({
    type: 'icon',
    paths: [PATHS[name][0]],
    viewBox: '0 0 24 24',
    fillRule: PATHS[name][1] ? 'evenodd' : 'nonzero',
    style: { width: `${size}px`, height: `${size}px`, 'flex-shrink': '0' },
    ...extra,
  }) as unknown as Node;
// A library or title kind's glyph: film, television, live or a folder (only the matching one shows).
const KINDS: [string, string[]][] = [
  ['film', ['movies', 'movie']],
  ['tv', ['shows', 'show', 'season', 'episode']],
  ['live', ['live']],
];
export const kindGlyphs = (key: string, size: number, style: Style = {}): Node[] =>
  [
    ...KINDS.flatMap(([icon, kinds]) =>
      kinds.map(k => jelly(icon, size, { when: [{ test: key, is: 'eq', value: k }] })),
    ),
    jelly('folder', size, {
      when: KINDS.flatMap(([, kinds]) => kinds).map(k => ({ test: key, is: 'ne' as const, value: k })),
    }),
  ].map(n => ({ ...n, style: { ...n.style, ...style } }) as Node);

// The placeholder tile colour, stable per identity: one of five, by the identity's length.
export const tile = (seed: string, extra: Style = {}, when: Condition[] = []): Node =>
  ({
    type: 'box',
    style: { ...fill, 'background-color': '$tile-5', ...extra },
    states: [1, 2, 3, 4].map(i => ({
      when: [{ test: seed, is: 'mod', value: `5:${i - 1}` }],
      style: { ...fill, 'background-color': `$tile-${i}`, ...extra },
    })),
    when,
  }) as Node;

// The shared control looks (look.contract).
export const iconBtn = (size: number): Style => ({
  position: 'relative',
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  'box-sizing': 'border-box',
  'flex-shrink': '0',
  width: `${size}px`,
  height: `${size}px`,
  padding: '0px',
  'border-radius': '999px',
  'background-color': 'transparent',
  color: '$ink-strong',
  cursor: 'pointer',
  transition: 'background-color 160ms linear, color 160ms linear',
});
export const iconBtnHover: Style = { color: '$accent', 'background-color': '$accent-soft' };
// Keyboard focus: the hover look plus the platform's own ring, as on a compiled button.
export const iconBtnFocus: Style = { ...iconBtnHover, outline: 'auto' };
export const menuRow: Style = {
  position: 'relative',
  display: 'flex',
  'flex-direction': 'row',
  'align-items': 'center',
  gap: '14px',
  'box-sizing': 'border-box',
  width: '100%',
  'min-height': '44px',
  padding: '0px 16px',
  'border-radius': '4px',
  'background-color': 'transparent',
  color: '$ink-strong',
  'font-size': '15px',
  'text-align': 'left',
  cursor: 'pointer',
};
export const submit: Style = {
  position: 'relative',
  display: 'flex',
  'flex-direction': 'row',
  'align-items': 'center',
  'justify-content': 'center',
  gap: '10px',
  'box-sizing': 'border-box',
  height: '46px',
  padding: '0px 20px',
  'border-radius': '4px',
  'background-color': '$accent',
  color: '$ink-strong',
  'font-size': '15px',
  'font-weight': '600',
  cursor: 'pointer',
};
export const submitFocus: Style = {
  'box-shadow': '0px 0px 0px 2px $page, 0px 0px 0px 4px $accent',
  outline: 'auto',
};
const tab: Style = {
  position: 'relative',
  display: 'flex',
  'flex-direction': 'row',
  'align-items': 'center',
  'box-sizing': 'border-box',
  height: '40px',
  padding: '0px 14px',
  'background-color': 'transparent',
  color: '$ink',
  'font-size': '15px',
  'font-weight': '400',
  'white-space': 'nowrap',
  'flex-shrink': '0',
  cursor: 'pointer',
};
export const sheet: Style = {
  'box-sizing': 'border-box',
  padding: '8px 0px',
  'border-radius': '6px',
  'background-color': '$popup',
  color: '$ink-strong',
  'box-shadow': '0px 12px 40px $shadow',
};
export const initial = (size: number, font: number): Node => ({
  type: 'text',
  text: '{env.viewerInitial}',
  style: {
    width: `${size}px`,
    height: `${size}px`,
    'border-radius': `${size / 2}px`,
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'font-size': `${font}px`,
    'font-weight': '600',
    color: '$ink-strong',
    'background-image': gradient,
    'flex-shrink': '0',
  },
});
export const wordmark: Node = {
  type: 'image',
  src: 'assets/brand/vela-lockup.svg',
  alt: '',
  style: { width: `${28 * 2.629}px`, height: '28px', 'flex-shrink': '0' },
};
// A tab: quiet until hovered, accent and semibold when current, with the gradient bar that slides between tabs.
export const tabNode = (
  label: string,
  on: Condition,
  press: Press,
  bar: { name: string; bottom: number },
  extra: Partial<Node> = {},
): Node =>
  ({
    type: 'box',
    press,
    label,
    style: tab,
    hover: { color: '$accent' },
    focus: { outline: 'auto', color: '$accent' },
    states: [
      {
        when: [on],
        style: { ...tab, color: '$accent', 'font-weight': '600' },
        hover: { color: '$accent' },
        focus: { outline: 'auto', color: '$accent' },
      },
    ],
    a11y: { role: 'tab', selected: [on] },
    children: [
      // Weight is resolved down the tree from the base style, so the current tab's text carries its own.
      { type: 'text', text: label, states: [{ when: [on], style: { 'font-weight': '600' } }] },
      {
        type: 'box',
        when: [on],
        sharedElement: bar.name,
        layoutTransition: '300ms ease-out',
        style: {
          position: 'absolute',
          left: '12px',
          right: '12px',
          bottom: `${bar.bottom}px`,
          height: '3px',
          'border-radius': '2px',
          'background-image': gradient,
        },
      },
    ],
    ...extra,
  }) as Node;
// The indeterminate spinner: an accent arc turning on a faint ring.
export const spinner = (size: number, extra: Partial<Node> = {}): Node =>
  ({
    type: 'box',
    motion: 'spin',
    style: {
      width: `${size}px`,
      height: `${size}px`,
      'box-sizing': 'border-box',
      'flex-shrink': '0',
      'border-radius': '999px',
      border: '3px solid $track',
      'border-top-color': '$accent',
    },
    ...extra,
  }) as Node;
export const emptyState = (icon: Node, title: string, message: string, when: Condition[]): Node => ({
  type: 'box',
  when,
  role: 'status',
  style: col({
    'align-items': 'center',
    'text-align': 'center',
    gap: '10px',
    padding: '64px 24px',
    color: '$secondary',
  }),
  children: [
    icon,
    {
      type: 'text',
      text: title,
      style: { 'margin-top': '6px', 'font-size': '20px', 'font-weight': '600', color: '$ink-strong' },
    },
    ...(message
      ? [
          {
            type: 'text',
            text: message,
            style: { 'max-width': '30rem', 'font-size': '15px', 'line-height': '1.5' },
          } as Node,
        ]
      : []),
  ],
});

// A page's own loading and failure (status.contract's look): the accent spinner fading in after a
// beat, or the centred message with a way to ask again when the foundation can.
const loading: Condition = { test: 'env.load', is: 'eq', value: 'loading' };
const failed: Condition = { test: 'env.load', is: 'eq', value: 'failed' };
export const ready: Condition = { test: 'env.load', is: 'eq', value: 'ready' };
export const waiting = (top: number, label: string): Node => ({
  type: 'box',
  when: [loading],
  role: 'status',
  label,
  motion: 'statusIn',
  style: col({
    'align-items': 'center',
    'justify-content': 'center',
    gap: '16px',
    'padding-top': `${top}px`,
    'padding-bottom': '80px',
  }),
  children: [spinner(54, { small: { width: '44px', height: '44px' } })],
});
export const failure = (message: string): Node => ({
  type: 'box',
  when: [failed],
  style: col({ gap: '4px' }),
  children: [
    emptyState(glyph('alert', 44), '{s:quiet}', message, []),
    {
      type: 'box',
      when: [{ test: 'env.canRetry' }],
      style: row({ 'justify-content': 'center' }),
      children: [
        {
          type: 'box',
          press: { action: 'retry' },
          label: '{s:tryAgain}',
          style: { ...submit, height: '42px' },
          hover: { opacity: '0.9' },
          focus: submitFocus,
          children: [{ type: 'text', text: '{s:tryAgain}' }],
        },
      ],
    },
  ],
});

export const raised: Style = row({
  position: 'relative',
  'align-items': 'center',
  'justify-content': 'center',
  gap: '8px',
  'box-sizing': 'border-box',
  height: '40px',
  padding: '0px 18px',
  'border-radius': '4px',
  'background-color': '$raised',
  color: '$ink-strong',
  'font-size': '14px',
  'font-weight': '500',
  cursor: 'pointer',
});

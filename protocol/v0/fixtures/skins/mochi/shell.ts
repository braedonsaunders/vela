// The shell: the pill-shaped bar (wordmark, destinations, search, profile), the profile menu, and the
// dotted paper (or the night ground on Live TV) behind every page.
import type { Condition, Node, Style } from '../../../skin';
import {
  Bubble,
  COMPACT,
  Extra,
  Label,
  Puffy,
  asset,
  bubble,
  col,
  fredoka,
  gutter,
  gutterSmall,
  icon,
  inset0,
  is,
  mascot,
  not,
  pixelFace,
  press94,
  puffy,
  ring,
  row,
  set,
  sz,
} from './look';

// The Vela mark redrawn in outlined pixels, beside the name in pixel type.
export const wordmark = (size: number): Node[] => [
  { type: 'image', src: asset('vela-mark.svg'), alt: '', style: sz(size * 1.05) },
  {
    type: 'text',
    text: '{s:vela}',
    style: {
      'font-family': pixelFace,
      'font-weight': '700',
      'font-size': `${size}px`,
      'line-height': '1',
      'letter-spacing': '0.04em',
      color: '$ink',
      'text-shadow': '3px 3px 0px $pink-soft',
    },
  },
];

// A destination pill (slots.contract NavItem): the current one is a pink candy whose
// pixel icon wiggles in; on phones every pill is a white sticker.
export const pillBase: Style = {
  ...row,
  position: 'relative',
  gap: '8px',
  'align-items': 'center',
  'flex-shrink': '0',
  height: '42px',
  'box-sizing': 'content-box',
  padding: '0px 16px',
  border: '2.5px solid $page-clear',
  'border-radius': '999px',
  'background-color': '$page-clear',
  'box-shadow': 'none',
  color: '$ink',
  'font-family': fredoka,
  cursor: 'pointer',
  transition: 'background-color 160ms linear, box-shadow 160ms linear',
};
export const pillOn: Style = {
  ...pillBase,
  'border-color': '$ink',
  'background-color': '$pink',
  'box-shadow': '0px 3px 0px $ink',
};
// Compact pills all wear the ink edge and shadow; only the current one is pink.
export const pillCompact: Style = {
  height: '38px',
  'border-color': '$ink',
  'box-shadow': '0px 3px 0px $ink',
};
export const compactC: Condition = { test: 'env.width', is: 'lt', value: COMPACT };
export const navItem = (
  label: string,
  iconName: (on: Condition[]) => Node[],
  on: Condition[],
  press: { action: 'home' | 'live' | 'library'; arg?: string },
  extra: Extra = {},
): Node =>
  ({
    type: 'box',
    press,
    label,
    testId: `nav-${label}`,
    ...extra,
    style: pillBase,
    below: { [COMPACT]: pillCompact },
    states: [
      { when: on, style: pillOn },
      { when: [compactC], style: { ...pillBase, 'background-color': '$card' } },
    ],
    a11y: { current: on },
    hover: { 'border-color': '$ink' },
    focus: { outline: 'auto', 'box-shadow': ring },
    active: press94,
    children: [
      ...iconName(on),
      {
        type: 'text',
        text: label,
        style: { 'font-size': '15px', 'font-weight': '550', 'white-space': 'nowrap' },
        states: [{ when: on, style: { 'font-size': '15px', 'font-weight': '650', 'white-space': 'nowrap' } }],
      },
    ],
  }) as Node;
// The icon is drawn fresh when its pill comes on, so it wiggles in.
export const navIcon =
  (name: string, when: Condition[] = []) =>
  (on: Condition[]): Node[] => [
    icon(name, 13, 'ink', { when: [...when, ...on], motion: 'wiggle' }),
    ...on.map(c => icon(name, 13, 'ink-soft', { when: [...when, { ...c, not: !c.not }] })),
  ];
// Library icons by kind, exactly as the compiled skin chooses them.
export const libIcon = (on: Condition[]): Node[] => [
  ...navIcon('layers', [is('dest.kind', 'show')])(on),
  ...navIcon('star', [is('dest.kind', 'movie')])(on),
  ...navIcon('grid', [
    { test: 'dest.kind', is: 'ne', value: 'show' },
    { test: 'dest.kind', is: 'ne', value: 'movie' },
  ])(on),
];
// Home, the server's libraries in order (a live library opens the guide), and Live when
// the server offers it without a live library.
// Hidden on a compact bar (a repeat's own fields do not reach its item, so its item is hidden).
export const hideCompact = (n: Node): Node =>
  n.type === 'repeat'
    ? { ...n, item: hideCompact(n.item) }
    : ({
        ...n,
        below: { ...(n.below ?? {}), [COMPACT]: { ...(n.below?.[COMPACT] ?? {}), display: 'none' } },
      } as Node);
export const destinations = (): Node[] => [
  navItem('{s:home}', navIcon('home'), [is('env.section', 'home')], { action: 'home' }),
  // One entry per library in server order: a live library opens Live TV.
  {
    type: 'repeat',
    over: 'nav.destinations',
    item: {
      type: 'box',
      style: { display: 'contents' },
      children: [
        navItem(
          '{dest.name}',
          navIcon('tv'),
          [is('env.section', 'live')],
          { action: 'live' },
          { when: [is('dest.kind', 'live'), set('env.canLive')] },
        ),
        navItem(
          '{dest.name}',
          libIcon,
          [set('dest.on')],
          { action: 'library', arg: '{dest.id}' },
          { when: [{ test: 'dest.kind', is: 'ne', value: 'live' }] },
        ),
      ],
    },
  },
  navItem(
    '{s:live}',
    navIcon('tv'),
    [is('env.section', 'live')],
    { action: 'live' },
    { when: [set('env.canLive'), not('env.hasLiveLibrary')] },
  ),
];

// The speech bubble under the search button (look.contract SpeechBubble, side "below"):
// shown on hover or focus, never over the open menu or on a compact bar.
export const searchTip: Node = {
  type: 'box',
  when: [not('flag:menu'), { test: 'env.width', is: 'gt', value: '719' }],
  style: {
    ...col,
    position: 'absolute',
    top: 'calc(100% + 12px)',
    left: '50%',
    translate: '-50% 0px',
    'z-index': '40',
    'pointer-events': 'none',
    display: 'none',
    'align-items': 'center',
  },
  groupHover: { display: 'flex' },
  groupFocus: { display: 'flex' },
  children: [
    {
      type: 'box',
      motion: 'bubble',
      style: { ...col, 'align-items': 'center', 'transform-origin': '50% 0%' },
      children: [
        {
          type: 'image',
          src: asset('tail-small-up.svg'),
          alt: '',
          style: { ...sz(16, 9), 'margin-bottom': '-2.5px', position: 'relative', 'z-index': '1' },
        },
        {
          type: 'text',
          text: '{s:search}',
          style: {
            'white-space': 'nowrap',
            padding: '6px 12px',
            'border-radius': '14px',
            border: '2.5px solid $ink',
            'background-color': '$card',
            color: '$ink',
            'font-family': fredoka,
            'font-size': '13px',
            'font-weight': '600',
            'box-shadow': '0px 3px 0px $ink',
          },
        },
      ],
    },
  ],
};

export const profileButton: Style = {
  ...Bubble,
  ...row,
  height: '44px',
  'padding-left': '4px',
  'padding-right': '16px',
  'justify-content': 'flex-start',
  gap: '8px',
  'background-color': '$card',
};
export const nav: Node = {
  type: 'box',
  role: 'navigation',
  label: '{s:mainNavigation}',
  when: [set('env.viewer')],
  motion: 'navIn',
  style: {
    ...col,
    position: 'relative',
    'z-index': '20',
    'flex-shrink': '0',
    'padding-top': '14px',
    ...gutter,
    'padding-bottom': '8px',
  },
  below: { [COMPACT]: { 'padding-top': '10px', ...gutterSmall, 'padding-bottom': '4px' } },
  children: [
    {
      type: 'box',
      style: {
        ...row,
        height: '66px',
        'box-sizing': 'border-box',
        'padding-left': '22px',
        'padding-right': '10px',
        'align-items': 'center',
        gap: '10px',
        border: '3px solid $ink',
        'border-radius': '999px',
        'background-color': '$card',
        'box-shadow': '0px 5px 0px $ink',
      },
      below: { [COMPACT]: { height: '56px', 'padding-left': '14px', 'padding-right': '8px', gap: '6px' } },
      children: [
        {
          type: 'box',
          press: { action: 'home' },
          label: '{s:velaHome}',
          controlStates: false,
          style: {
            ...row,
            position: 'relative',
            'align-items': 'center',
            gap: `${26 * 0.24}px`,
            'margin-right': '18px',
            'flex-shrink': '0',
            color: '$ink',
          },
          below: { [COMPACT]: { gap: `${22 * 0.24}px`, 'margin-right': '0px' } },
          children: [
            {
              type: 'box',
              style: { ...row, 'align-items': 'center', gap: `${26 * 0.24}px` },
              below: { [COMPACT]: { display: 'none' } },
              children: wordmark(26),
            },
            {
              type: 'box',
              style: { display: 'none' },
              below: { [COMPACT]: { ...row, 'align-items': 'center', gap: `${22 * 0.24}px` } },
              children: wordmark(22),
            },
          ],
        },
        // The destinations scroll inside the bar; compact bars move them to a strip below.
        {
          type: 'box',
          style: {
            ...row,
            flex: '1',
            'min-width': '0px',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'scrollbar-width': 'none',
            gap: '4px',
            'align-items': 'center',
          },
          below: { [COMPACT]: { 'overflow-x': 'hidden' } },
          children: [...destinations().map(hideCompact)],
        },
        {
          type: 'box',
          group: true,
          style: { ...row, position: 'relative', 'flex-shrink': '0' },
          children: [
            {
              type: 'box',
              press: { action: 'search', focus: 'vela-search' },
              label: '{s:search}',
              style: { ...Bubble, ...sz(44), 'background-color': '$butter-soft' },
              ...bubble,
              children: [icon('search', 18)],
            },
            searchTip,
          ],
        },
        // The profile button, washed pink while its menu is open.
        {
          type: 'box',
          id: 'profile-menu-trigger',
          press: { action: 'toggle', arg: 'menu' },
          label: '{s:profileAndAppearance}',
          testId: 'profile-menu',
          a11y: { expanded: [set('flag:menu')] },
          style: profileButton,
          states: [
            { when: [set('flag:menu')], style: { ...profileButton, 'background-color': '$pink-wash' } },
          ],
          below: { [COMPACT]: { 'padding-right': '4px' } },
          ...bubble,
          children: [
            {
              type: 'text',
              text: '{env.viewerInitial}',
              style: {
                ...sz(32),
                'border-radius': '16px',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                'font-family': pixelFace,
                'font-size': '16px',
                'font-weight': '700',
                color: '$ink',
                'background-color': '$pink-soft',
                border: '2px solid $ink',
                'box-sizing': 'border-box',
              },
            },
            {
              type: 'text',
              text: '{env.viewer}',
              style: {
                'font-size': '15px',
                'font-weight': '600',
                'max-width': '140px',
                'white-space': 'nowrap',
                'overflow-x': 'hidden',
                'text-overflow': 'ellipsis',
              },
              below: { [COMPACT]: { display: 'none' } },
            },
          ],
        },
      ],
    },
    // Compact: the destinations as a strip under the bar.
    {
      type: 'box',
      style: { display: 'none' },
      below: {
        [COMPACT]: {
          ...row,
          gap: '8px',
          'align-items': 'center',
          'overflow-x': 'auto',
          'overflow-y': 'hidden',
          'scrollbar-width': 'none',
          'margin-left': '-16px',
          'margin-right': '-16px',
          padding: '12px 16px 6px',
        },
      },
      children: destinations(),
    },
  ],
};

export const swatch = (colour: string): Node => ({
  type: 'box',
  style: {
    ...sz(12),
    'border-radius': '6px',
    'background-color': colour,
    border: '2px solid $ink',
    'box-sizing': 'border-box',
  },
});
export const menu: Node = {
  type: 'box',
  id: 'viewer-settings',
  role: 'dialog',
  label: '{s:profileAndAppearance}',
  when: [set('env.viewer'), set('flag:menu')],
  motion: 'menuPop',
  exit: 'menuOut',
  style: {
    ...col,
    position: 'absolute',
    top: '92px',
    right: 'max(24px, 3.6vw)',
    'z-index': '30',
    width: '272px',
    'box-sizing': 'border-box',
    padding: '20px',
    gap: '16px',
    border: '3px solid $ink',
    'border-radius': '24px',
    'background-color': '$card',
    color: '$ink',
    'box-shadow': '6px 6px 0px $lavender',
    'transform-origin': 'top right',
  },
  below: { [COMPACT]: { top: '74px', right: '12px' } },
  children: [
    {
      type: 'image',
      src: asset('tail-up.svg'),
      alt: '',
      style: { position: 'absolute', top: '-14px', right: '34px', ...sz(24, 14) },
    },
    {
      type: 'box',
      style: { ...row, gap: '12px', 'align-items': 'center' },
      children: [
        mascot('happy', 44),
        {
          type: 'box',
          style: { ...col, gap: '2px', flex: '1', 'min-width': '0px' },
          children: [
            { type: 'text', text: '{s:hello}', style: { ...Label, 'font-size': '10px', color: '$ink-soft' } },
            {
              type: 'text',
              text: '{env.viewer}',
              style: {
                'font-size': '18px',
                'font-weight': '650',
                'white-space': 'nowrap',
                'overflow-x': 'hidden',
                'text-overflow': 'ellipsis',
              },
            },
          ],
        },
      ],
    },
    {
      type: 'box',
      style: {
        height: '0px',
        'border-style': 'dashed',
        'border-width': '0px',
        'border-top-width': '2.5px',
        'border-top-color': '$line-strong',
      },
    },
    {
      type: 'box',
      press: { action: 'openPicker' },
      label: '{s:appearance}',
      testId: 'skin-picker',
      when: [{ test: 'env.skinCount', is: 'gt', value: '1' }],
      style: {
        ...row,
        position: 'relative',
        gap: '12px',
        'align-items': 'center',
        'box-sizing': 'border-box',
        width: '100%',
        padding: '10px 12px',
        border: '2.5px solid $ink',
        'border-radius': '16px',
        'background-color': '$page',
        color: '$ink',
        cursor: 'pointer',
      },
      hover: { 'background-color': '$lavender-soft' },
      focus: { outline: 'auto', 'box-shadow': ring },
      active: { scale: '0.97' },
      children: [
        {
          type: 'box',
          style: { ...col, gap: '2px', flex: '1', 'min-width': '0px', 'text-align': 'left' },
          children: [
            {
              type: 'text',
              text: '{s:appearance}',
              style: { ...Label, 'font-size': '10px', color: '$ink-soft' },
            },
            {
              type: 'text',
              text: '{s:name}',
              style: { 'font-size': '16px', 'font-weight': '600', color: '$ink' },
            },
          ],
        },
        {
          type: 'box',
          style: { ...row, gap: '4px' },
          children: ['#fff0f6', '#3b1f4a', '#ff7eb6', '#b9a0ff'].map(swatch),
        },
      ],
    },
    { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
    { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
    {
      type: 'box',
      press: { action: 'signOut' },
      label: '{s:signOut}',
      style: { ...Puffy, height: '42px', padding: '0px 16px', 'box-shadow': '0px 3px 0px $ink', gap: '10px' },
      ...puffy,
      children: [icon('out', 14), { type: 'text', text: '{s:signOut}', style: { 'font-size': '15px' } }],
    },
  ],
};

export const shell: Node = {
  type: 'box',
  escape: 'menu',
  returnFocus: 'profile-menu-trigger',
  style: {
    ...col,
    position: 'relative',
    height: '100%',
    'min-height': '0px',
    'background-color': '$page',
    color: '$ink',
    'color-scheme': 'light',
    'font-family': fredoka,
  },
  children: [
    // The dotted paper, or on Live TV the night's ground, behind everything (the route sits at z 1).
    {
      type: 'image',
      when: [{ test: 'env.section', is: 'ne', value: 'live' }],
      src: asset('dots.svg'),
      alt: '',
      style: {
        ...inset0,
        width: '100%',
        height: '100%',
        'object-fit': 'fill',
        'pointer-events': 'none',
        'z-index': '0',
      },
    },
    {
      type: 'box',
      when: [is('env.section', 'live')],
      style: { ...inset0, 'background-color': '$night', 'pointer-events': 'none', 'z-index': '0' },
    },
    nav,
    menu,
    {
      type: 'slot',
      slot: 'children',
      style: { ...col, flex: '1', 'min-height': '0px', position: 'relative', 'z-index': '1' } as Style,
      inner: { ...col, 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' },
    },
  ],
};

// Marquee's frame: the sidebar (an icon rail on narrower screens, a drawer on phones),
// the top bar and the account menu.
import type { Condition, Node, Style } from '../../../skin';
import { searchBox } from './search';
import {
  sans,
  bar,
  fill,
  px,
  is,
  isnt,
  set,
  unset,
  glyph,
  wordmark,
  quick,
  ring,
  round,
  avatar,
  label,
  oneLine,
} from './look';

// The sidebar shows full labels from 1100 px and an icon rail below; the menu button flips
// that (`keep-flip`, kept across pages). One element per part, so widths animate.
const flip = set('flag:keep-flip'),
  narrow: Condition = { test: 'env.width', is: 'lt', value: '1100' },
  wideEnough: Condition = { ...narrow, not: true };
type State = { when: Condition[]; style: Style; hover?: Style };
/** The rail's states over `full` (the node's style): slim below 1100 px, the other way round when flipped. */
const rail = (full: Style, slim: Style, extra: Condition[] = [], hover?: Style): State[] => [
  { when: [...extra, flip, narrow], style: full, hover },
  { when: [...extra, flip], style: slim, hover },
  { when: [...extra, narrow], style: slim, hover },
  ...(extra.length ? [{ when: extra, style: full, hover }] : []),
];
export const notSmall = unset('env.small');
const railLayout = '200ms ease-out';

const navRow = (
  full: boolean,
  name: string,
  icon: Node,
  on: Condition,
  press: { action: 'home' | 'live' | 'library'; arg?: string },
  extraWhen: Condition[] = [],
  testId = `nav-${name}`,
): Node => {
  const row = (lit: boolean, slim: boolean): Style => ({
    position: 'relative',
    outline: 'auto',
    display: 'flex',
    'flex-direction': 'row',
    gap: '14px',
    'align-items': 'center',
    'box-sizing': 'border-box',
    width: '100%',
    height: '44px',
    'border-radius': '6px',
    'justify-content': slim ? 'center' : 'flex-start',
    padding: slim ? '0px' : '0px 12px',
    'background-color': lit ? '$selected' : 'transparent',
    color: lit ? '$ink' : '$ink-dim',
    transition: quick,
  });
  const text = (lit: boolean): Style => ({
    'font-size': '15px',
    'font-weight': lit ? '700' : '600',
    ...oneLine,
    'min-width': '0px',
  });
  const litHover: Style = { 'background-color': '$selected', color: '$ink' };
  return {
    type: 'box',
    press,
    label: name,
    testId,
    when: extraWhen,
    style: row(false, false),
    hover: { 'background-color': '$hover', color: '$ink' },
    focus: { 'box-shadow': 'inset 0px 0px 0px 2px $amber' },
    states: full
      ? [{ when: [on], style: row(true, false), hover: litHover }]
      : [
          ...rail(row(true, false), row(true, true), [on], litHover),
          ...rail(row(false, false), row(false, true)),
        ],
    a11y: { current: [on], ...(full ? {} : { title: name }) },
    children: [
      { ...icon, states: [{ when: [on], style: { color: '$amber' } }] } as Node,
      {
        type: 'text',
        text: name,
        style: text(false),
        states: full
          ? [{ when: [on], style: text(true) }]
          : [...rail(text(true), { display: 'none' }, [on]), ...rail(text(false), { display: 'none' })],
      } as Node,
    ],
  } as Node;
};
// One library: a live library opens the guide (when the server offers live), others their page.
const library = (full: boolean): Node[] => [
  navRow(
    full,
    '{dest.name}',
    glyph('live', 22),
    is('env.section', 'live'),
    { action: 'live' },
    [is('dest.kind', 'live'), set('nav.showLive')],
    'nav-{dest.name}',
  ),
  navRow(
    full,
    '{dest.name}',
    glyph('film', 22),
    set('dest.on'),
    { action: 'library', arg: '{dest.id}' },
    [is('dest.kind', 'movies')],
    'nav-{dest.name}',
  ),
  navRow(
    full,
    '{dest.name}',
    glyph('tv', 22),
    set('dest.on'),
    { action: 'library', arg: '{dest.id}' },
    [is('dest.kind', 'shows')],
    'nav-{dest.name}',
  ),
  navRow(
    full,
    '{dest.name}',
    glyph('stack', 22),
    set('dest.on'),
    { action: 'library', arg: '{dest.id}' },
    [isnt('dest.kind', 'movies'), isnt('dest.kind', 'shows'), isnt('dest.kind', 'live')],
    'nav-{dest.name}',
  ),
];
// Home, then the server's libraries in order, then Live when the server offers it without a live library.
const destinations = (full: boolean, extra: Style = {}): Node => {
  const pad = (slim: boolean): Style => ({
    display: 'flex',
    'flex-direction': 'column',
    gap: '2px',
    padding: slim ? '10px 8px' : '10px 10px',
    ...extra,
  });
  const heading: Style = { ...label, padding: '18px 12px 8px', 'white-space': 'nowrap' };
  const divider: Style = { display: 'flex', height: '1px', margin: '10px 8px', 'background-color': '$line' };
  return {
    type: 'box',
    testId: 'marquee-sidebar',
    style: pad(false),
    states: full ? [] : rail(pad(false), pad(true)),
    children: [
      navRow(
        full,
        '{s:home}',
        glyph('home', 22),
        is('env.section', 'home'),
        { action: 'home' },
        [],
        'nav-Home',
      ),
      {
        type: 'text',
        text: '{s:libraries}',
        when: [{ test: 'env.libraryCount', is: 'gt', value: '0' }],
        style: heading,
        states: full ? [] : rail(heading, { display: 'none' }),
      } as Node,
      {
        type: 'box',
        when: [{ test: 'env.libraryCount', is: 'gt', value: '0' }],
        style: { display: 'none' },
        states: full ? [] : rail({ display: 'none' }, divider),
      } as Node,
      {
        type: 'repeat',
        over: 'nav.destinations',
        item: {
          type: 'box',
          style: { display: 'flex', 'flex-direction': 'column' },
          children: library(full),
        },
      },
      navRow(full, '{s:live}', glyph('live', 22), is('env.section', 'live'), { action: 'live' }, [
        set('nav.showLive'),
        unset('env.hasLiveLibrary'),
      ]),
    ],
  } as Node;
};
const sidebarStyle = (w: number): Style => ({
  width: px(w),
  'flex-shrink': '0',
  'box-sizing': 'border-box',
  'background-color': '$chrome',
  'overflow-x': 'hidden',
  'overflow-y': 'auto',
  'scrollbar-width': 'none',
});
const sidebar: Node = {
  type: 'box',
  role: 'navigation',
  label: '{s:mainNavigation}',
  when: [set('env.viewer'), notSmall],
  style: sidebarStyle(232),
  states: rail(sidebarStyle(232), sidebarStyle(72), [notSmall]),
  layoutTransition: railLayout,
  children: [destinations(false)],
} as Node;

// The bar's left end: the menu button and the wordmark, as wide as the rail (at least 200).
// The menu button says whether the rail is expanded: open when flipped on a narrow screen or unflipped on a wide one.
const never: Condition[] = [flip, unset('flag:keep-flip')];
const railButton = (cond: Condition[], expanded: boolean): Node =>
  ({
    type: 'box',
    when: [notSmall, ...cond],
    press: { action: 'toggle', arg: 'keep-flip' },
    label: '{s:toggleSidebar}',
    testId: 'marquee-menu',
    id: 'marquee-menu-button',
    ...round(44),
    a11y: { expanded: expanded ? cond : never },
    children: [glyph('menu', 22)],
  }) as Node;
const barStartStyle = (w: number): Style => ({
  display: 'flex',
  'flex-direction': 'row',
  width: px(w),
  'flex-shrink': '0',
  'box-sizing': 'border-box',
  'padding-left': '12px',
  gap: '10px',
  'align-items': 'center',
  'pointer-events': 'auto',
});
const barStart: Node = {
  type: 'box',
  style: barStartStyle(232),
  states: rail(barStartStyle(232), barStartStyle(200), [notSmall]),
  layoutTransition: railLayout,
  small: { width: 'auto', 'padding-left': '4px', gap: '4px' },
  children: [
    railButton([flip, narrow], true),
    railButton([flip, wideEnough], false),
    railButton([unset('flag:keep-flip'), narrow], false),
    railButton([unset('flag:keep-flip'), wideEnough], true),
    {
      type: 'box',
      when: [set('env.small')],
      escape: 'drawer',
      returnFocus: 'marquee-drawer-button',
      press: { action: 'toggle', arg: 'drawer' },
      label: '{s:openNavigation}',
      testId: 'marquee-menu',
      id: 'marquee-drawer-button',
      ...round(44),
      a11y: { expanded: [set('flag:drawer')] },
      children: [glyph('menu', 22)],
    } as Node,
    {
      type: 'box',
      press: { action: 'home' },
      label: '{s:velaHome}',
      style: {
        position: 'relative',
        display: 'flex',
        'align-items': 'center',
        padding: '6px 4px',
        'border-radius': '4px',
      },
      children: [wordmark(28)],
    },
  ],
} as Node;

export const glassBar: Style = { 'background-color': '$chrome-glass', 'backdrop-filter': 'blur(18px)' };
const topBar: Node = {
  type: 'box',
  when: [set('env.viewer')],
  escape: 'menu',
  returnFocus: 'marquee-account',
  style: {
    position: 'relative',
    height: px(bar.normal),
    'flex-shrink': '0',
    'z-index': '20',
    display: 'flex',
    'flex-direction': 'row',
    'align-items': 'center',
    'box-sizing': 'border-box',
    'padding-right': '14px',
    gap: '12px',
    ...glassBar,
  },
  small: { height: px(bar.small), 'padding-right': '6px', gap: '2px' },
  children: [
    barStart,
    { type: 'box', style: { display: 'none' }, small: { display: 'flex', flex: '1' } },
    {
      type: 'box',
      press: { action: 'search', focus: 'vela-search' },
      label: '{s:search}',
      ...round(44),
      style: { ...round(44).style, display: 'none' },
      small: { display: 'flex' },
      children: [glyph('search', 22)],
    },
    {
      type: 'box',
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'row',
        flex: '1',
        'min-width': '0px',
        'justify-content': 'center',
      },
      small: { display: 'none' },
      children: [
        { ...searchBox, when: [is('env.section', 'home'), notSmall] } as Node,
        {
          type: 'box',
          when: [isnt('env.section', 'home')],
          press: { action: 'search', focus: 'vela-search' },
          label: '{s:searchYourLibrary}',
          style: {
            position: 'relative',
            outline: 'auto',
            display: 'flex',
            'flex-direction': 'row',
            gap: '10px',
            'align-items': 'center',
            width: 'min(560px, 100%)',
            'box-sizing': 'border-box',
            height: '38px',
            padding: '0px 14px',
            'border-radius': '6px',
            'background-color': '$field',
            color: '$ink-faint',
            cursor: 'text',
          },
          hover: { 'background-color': '$field-focus' },
          focus: { 'box-shadow': ring('$amber') },
          children: [
            glyph('search', 18),
            { type: 'text', text: '{s:search}', style: { 'font-size': '15px' } },
          ],
        },
      ],
    },
    {
      type: 'box',
      press: { action: 'toggle', arg: 'menu' },
      label: '{s:profile}',
      testId: 'profile-menu',
      id: 'marquee-account',
      ...round(44),
      a11y: { expanded: [set('flag:menu')], controls: 'marquee-account-menu' },
      children: [avatar(32, 14)],
    } as Node,
  ],
};

const menuRow = (
  text: string,
  icon: Node,
  press: { action: 'openPicker' | 'manageLibraries' | 'signOut' },
  extra: Partial<Node> = {},
): Node =>
  ({
    type: 'box',
    press,
    label: text,
    ...extra,
    style: {
      position: 'relative',
      outline: 'auto',
      display: 'flex',
      'flex-direction': 'row',
      gap: '12px',
      'align-items': 'center',
      'box-sizing': 'border-box',
      width: '100%',
      height: '42px',
      padding: '0px 16px',
      color: '$ink',
    },
    hover: { 'background-color': '$hover' },
    focus: { 'box-shadow': 'inset 0px 0px 0px 2px $amber' },
    children: [icon, { type: 'text', text, style: { 'font-size': '14px' } }],
  }) as Node;
const divider: Node = { type: 'box', style: { height: '1px', 'background-color': '$line' } };
const accountMenu: Node = {
  type: 'box',
  when: [set('env.viewer'), set('flag:menu')],
  id: 'marquee-account-menu',
  motion: 'drop',
  exit: 'gone100',
  escape: 'menu',
  returnFocus: 'marquee-account',
  style: {
    position: 'absolute',
    top: px(bar.normal - 4),
    right: '14px',
    'z-index': '30',
    width: '260px',
    'box-sizing': 'border-box',
    padding: '8px 0px',
    'border-radius': '6px',
    'background-color': '$menu',
    'box-shadow': '0px 12px 40px $shadow, 0px 0px 0px 1px $line',
  },
  small: { top: px(bar.small - 4), right: '8px' },
  children: [
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '12px',
        'align-items': 'center',
        padding: '10px 16px 14px',
      },
      children: [
        avatar(36, 16),
        {
          type: 'text',
          text: '{env.viewer}',
          style: {
            'font-size': '15px',
            'font-weight': '700',
            flex: '1',
            'min-width': '0px',
            'line-clamp': '1',
          },
        },
      ],
    },
    divider,
    menuRow('{s:changeAppearance}', glyph('grid', 18), { action: 'openPicker' }, {
      testId: 'skin-picker',
      when: [{ test: 'env.skinCount', is: 'gt', value: '1' }],
      a11y: { haspopup: 'dialog' },
    } as Partial<Node>),
    menuRow('{s:manageLibraries}', glyph('rows', 18), { action: 'manageLibraries' }, {
      testId: 'manage-libraries',
      when: [set('env.canManageLibraries')],
    } as Partial<Node>),
    {
      type: 'box',
      style: { padding: '0px 16px' },
      children: [
        { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
        { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
      ],
    },
    divider,
    menuRow('{s:signOut}', glyph('signout', 18), { action: 'signOut' }),
    // Which Vela this is, where it runs and the server: quiet, selectable, and on TV a stop the remote reaches.
    {
      type: 'box',
      when: [set('env.aboutLine')],
      readingStop: true,
      label: '{env.aboutLabel}',
      testId: 'about-line',
      style: { padding: '6px 16px 8px' },
      children: [{ type: 'text', text: '{env.aboutLine}', style: { 'font-size': '12px', 'line-height': '16px', color: '$ink-faint' } }],
    },
  ],
} as Node;

// Phones: the sidebar is a drawer behind the menu button.
const drawerOpen = [set('env.viewer'), set('env.small'), set('flag:drawer')];
const drawer: Node[] = [
  {
    type: 'box',
    when: drawerOpen,
    press: { action: 'close', arg: 'drawer', focus: 'marquee-drawer-button' },
    label: '{s:closeNavigation}',
    motion: 'fade',
    exit: 'gone120',
    style: { ...fill, 'z-index': '40', 'background-color': '$scrim' },
  } as Node,
  {
    type: 'box',
    when: drawerOpen,
    role: 'navigation',
    label: '{s:mainNavigation}',
    motion: 'slide',
    exit: 'gone120',
    escape: 'drawer',
    returnFocus: 'marquee-drawer-button',
    style: {
      position: 'absolute',
      top: '0px',
      left: '0px',
      bottom: '0px',
      'z-index': '41',
      width: 'min(300px, 84vw)',
      'box-sizing': 'border-box',
      display: 'flex',
      'flex-direction': 'column',
      'background-color': '$chrome',
      'box-shadow': '12px 0px 40px $shadow',
    },
    children: [
      {
        type: 'box',
        style: {
          display: 'flex',
          'flex-direction': 'row',
          height: px(bar.small),
          'align-items': 'center',
          gap: '4px',
          'padding-left': '4px',
          'padding-right': '4px',
          'flex-shrink': '0',
        },
        children: [
          {
            type: 'box',
            press: { action: 'close', arg: 'drawer', focus: 'marquee-drawer-button' },
            label: '{s:closeNavigation}',
            ...round(44),
            children: [glyph('close', 22)],
          },
          wordmark(28),
        ],
      },
      destinations(true, { flex: '1', 'min-height': '0px', 'overflow-y': 'auto' }),
    ],
  } as Node,
];

// The page beside the sidebar: the route's own box fills it.
const page: Node = {
  type: 'slot',
  slot: 'children',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    flex: '1',
    'min-width': '0px',
    'min-height': '0px',
  },
  inner: {
    display: 'flex',
    'flex-direction': 'column',
    'flex-grow': '1',
    'min-height': '0px',
    height: '100%',
    width: '100%',
  },
} as Node;

// The bar sits in flow above the sidebar and the page, so the page's scroll view starts below it
// and a sticky toolbar pins under the bar on web and native alike.
export const shell: Node = {
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    height: '100%',
    'min-height': '0px',
    'background-color': '$page',
    color: '$ink',
    'color-scheme': 'dark',
    'font-family': sans,
  },
  children: [
    topBar,
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', flex: '1', 'min-height': '0px' },
      children: [sidebar, page],
    },
    accountMenu,
    ...drawer,
  ],
};

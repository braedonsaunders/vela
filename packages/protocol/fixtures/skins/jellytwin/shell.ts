// The shell: the header with section tabs, the user menu and the slide-in drawer.
import type { Condition, Node, Style } from '../../../skin';
import {
  type Press,
  isLive,
  sans,
  row,
  col,
  fill,
  COMPACT,
  hairline,
  not,
  glyph,
  jelly,
  kindGlyphs,
  iconBtn,
  iconBtnHover,
  iconBtnFocus,
  menuRow,
  sheet,
  initial,
  wordmark,
  tabNode,
} from './look';

const onLive: Condition = { test: 'env.section', is: 'eq', value: 'live' };
const onHome: Condition = { test: 'env.section', is: 'eq', value: 'home' };
// The header's sections: Home, the server's libraries in order (live only when offered),
// and Live TV when no library is live.
const sectionBar = { name: 'jt-tab', bottom: 2 };
const sections = (style: Style, below: Style): Node => ({
  type: 'box',
  role: 'tablist',
  label: '{s:sections}',
  style: row({
    'align-items': 'center',
    'min-width': '0px',
    'overflow-x': 'auto',
    'overflow-y': 'hidden',
    'scrollbar-width': 'none',
    ...style,
  }),
  below: { [COMPACT]: below },
  children: [
    { type: 'box', style: { flex: '1' } },
    tabNode('{s:home}', onHome, { action: 'home' }, sectionBar, { testId: 'nav-{s:home}' }),
    {
      type: 'repeat',
      over: 'nav.destinations',
      item: {
        type: 'box',
        style: row({ 'flex-shrink': '0' }),
        children: [
          tabNode('{dest.name}', onLive, { action: 'live' }, sectionBar, {
            testId: 'nav-{dest.name}',
            when: [isLive, { test: 'env.canLive' }],
          }),
          tabNode('{dest.name}', { test: 'dest.on' }, { action: 'library', arg: '{dest.id}' }, sectionBar, {
            testId: 'nav-{dest.name}',
            when: [not(isLive)],
          }),
        ],
      },
    },
    tabNode('{s:liveTv}', onLive, { action: 'live' }, sectionBar, {
      testId: 'nav-{s:liveTv}',
      when: [{ test: 'env.canLive' }, { test: 'env.hasLiveLibrary', not: true }],
    }),
    { type: 'box', style: { flex: '1' } },
  ],
});

const headerHeight = { style: { height: '58px' }, below: { [COMPACT]: { height: '52px' } } };
// Escape closes the user menu from the profile button too (focus stays there when the menu opens).
const header: Node = {
  type: 'box',
  role: 'navigation',
  label: '{s:mainNavigation}',
  when: [{ test: 'env.viewer' }],
  escape: 'menu',
  returnFocus: 'jt-user',
  style: col({
    position: 'relative',
    'flex-shrink': '0',
    'z-index': '20',
    'background-color': '$header',
    'backdrop-filter': 'blur(12px)',
    'box-shadow': '0px 2px 6px $shadow',
  }),
  children: [
    {
      type: 'box',
      style: row({
        ...headerHeight.style,
        'box-sizing': 'border-box',
        'padding-left': '10px',
        'padding-right': '14px',
        'align-items': 'center',
        gap: '6px',
      }),
      below: {
        [COMPACT]: {
          ...headerHeight.below[COMPACT],
          'padding-left': '4px',
          'padding-right': '6px',
          gap: '2px',
        },
      },
      children: [
        {
          type: 'box',
          id: 'jt-menu',
          press: { action: 'only', arg: 'drawer', focus: 'jt-drawer-home' },
          label: '{s:openMenu}',
          testId: 'jt-menu',
          a11y: { expanded: [{ test: 'flag:drawer' }] },
          style: iconBtn(44),
          hover: iconBtnHover,
          focus: iconBtnFocus,
          children: [glyph('menu', 24)],
        },
        {
          type: 'box',
          press: { action: 'home' },
          label: '{s:velaHome}',
          style: { position: 'relative', padding: '0px 8px', 'flex-shrink': '0', color: '$ink-strong' },
          children: [wordmark],
        },
        sections({ flex: '1' }, { display: 'none' }),
        { type: 'box', style: { display: 'none' }, below: { [COMPACT]: { display: 'flex', flex: '1' } } },
        {
          type: 'box',
          press: { action: 'search', focus: 'vela-search' },
          label: '{s:search}',
          testId: 'jt-search-button',
          style: iconBtn(44),
          hover: iconBtnHover,
          focus: iconBtnFocus,
          children: [glyph('search', 23)],
        },
        {
          type: 'box',
          id: 'jt-user',
          press: { action: 'only', arg: 'menu' },
          label: '{s:profile}',
          testId: 'profile-menu',
          a11y: { expanded: [{ test: 'flag:menu' }] },
          style: iconBtn(44),
          hover: iconBtnHover,
          focus: iconBtnFocus,
          children: [initial(30, 14)],
        },
      ],
    },
    // Under 800px the tabs take their own line under the bar, centred.
    sections({ display: 'none' }, { display: 'flex', 'padding-left': '6px', 'padding-right': '6px' }),
  ],
};

const userMenu: Node[] = [
  {
    type: 'box',
    when: [{ test: 'env.viewer' }, { test: 'flag:menu' }],
    press: { action: 'close', arg: 'menu' },
    label: '{s:close}',
    style: { ...fill, 'z-index': '29', 'background-color': 'transparent' },
  },
  {
    type: 'box',
    when: [{ test: 'env.viewer' }, { test: 'flag:menu' }],
    id: 'jt-user-menu',
    role: 'dialog',
    label: '{s:profile}',
    motion: 'menuIn',
    exit: 'menuOut',
    escape: 'menu',
    returnFocus: 'jt-user',
    style: {
      ...sheet,
      ...col({
        position: 'absolute',
        top: '56px',
        right: '14px',
        'z-index': '30',
        width: '260px',
        padding: '8px',
        gap: '4px',
        'transform-origin': 'top right',
      }),
    },
    below: { [COMPACT]: { top: '50px', right: '8px' } },
    children: [
      {
        type: 'box',
        style: row({ gap: '12px', 'align-items': 'center', padding: '10px 12px 12px' }),
        children: [
          initial(40, 17),
          {
            type: 'text',
            text: '{env.viewer}',
            style: {
              'font-size': '16px',
              'font-weight': '600',
              flex: '1',
              'min-width': '0px',
              'line-clamp': '1',
            },
          },
        ],
      },
      { type: 'box', style: { height: '1px', 'background-color': '$line', margin: '0px 8px 6px' } },
      {
        type: 'box',
        when: [{ test: 'env.skinCount', is: 'gt', value: '1' }],
        press: { action: 'openPicker' },
        label: '{s:appearance}',
        testId: 'skin-picker',
        a11y: { haspopup: 'dialog' },
        style: menuRow,
        hover: { 'background-color': '$hover' },
        focus: { outline: 'auto', 'background-color': '$hover' },
        children: [glyph('sparkles', 20), { type: 'text', text: '{s:appearance}' }],
      },
      { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
      { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
      {
        type: 'box',
        press: { action: 'signOut' },
        label: '{s:signOut}',
        style: menuRow,
        hover: { 'background-color': '$hover' },
        focus: { outline: 'auto', 'background-color': '$hover' },
        children: [glyph('sign-out', 20), { type: 'text', text: '{s:signOut}' }],
      },
    ],
  },
];

// A drawer entry: its glyph and name, accent on a soft accent ground when current.
const drawerRow: Style = {
  ...menuRow,
  'border-radius': '0px',
  padding: '0px 20px',
  'min-height': '48px',
  gap: '18px',
};
const drawerItem = (
  domId: string,
  label: string,
  glyphs: Node[],
  on: Condition | undefined,
  press: Press,
  when: Condition[] = [],
): Node =>
  ({
    type: 'box',
    id: domId,
    press,
    label,
    when,
    style: drawerRow,
    hover: { 'background-color': '$hover' },
    focus: { outline: 'auto', 'background-color': '$hover' },
    ...(on
      ? {
          a11y: { current: [on] },
          states: [
            {
              when: [on],
              style: { ...drawerRow, 'background-color': '$accent-soft', color: '$accent' },
              hover: { 'background-color': '$accent-soft' },
              focus: { outline: 'auto', 'background-color': '$accent-soft' },
            },
          ],
        }
      : {}),
    children: [...glyphs, { type: 'text', text: label, style: { 'font-size': '15px', 'line-clamp': '1' } }],
  }) as Node;
const drawerHeading = (text: string): Node => ({
  type: 'text',
  text,
  style: { 'font-size': '13px', 'font-weight': '600', color: '$secondary', padding: '16px 20px 6px' },
});

const drawer: Node[] = [
  {
    type: 'box',
    when: [{ test: 'env.viewer' }, { test: 'flag:drawer' }],
    press: { action: 'close', arg: 'drawer', focus: 'jt-menu' },
    label: '{s:closeMenu}',
    motion: 'scrimIn',
    exit: 'scrimOut',
    style: { ...fill, 'z-index': '40', 'background-color': '$overlay' },
  },
  {
    type: 'box',
    when: [{ test: 'env.viewer' }, { test: 'flag:drawer' }],
    role: 'dialog',
    label: '{s:menu}',
    motion: 'drawerIn',
    exit: 'drawerOut',
    escape: 'drawer',
    returnFocus: 'jt-menu',
    style: col({
      position: 'absolute',
      top: '0px',
      left: '0px',
      bottom: '0px',
      'z-index': '40',
      width: '300px',
      'overflow-y': 'auto',
      'overflow-x': 'hidden',
      'background-color': '$drawer',
      'box-shadow': '4px 0px 24px $shadow',
    }),
    below: { [COMPACT]: { width: 'min(300px, 84vw)' } },
    children: [
      {
        type: 'box',
        style: col({ 'padding-bottom': '24px' }),
        children: [
          {
            type: 'box',
            style: row({
              ...headerHeight.style,
              'align-items': 'center',
              'padding-left': '18px',
              gap: '10px',
              ...hairline,
              'margin-bottom': '8px',
              'flex-shrink': '0',
            }),
            below: headerHeight.below,
            children: [wordmark],
          },
          drawerItem('jt-drawer-home', '{s:home}', [glyph('home', 22)], onHome, { action: 'home' }),
          {
            ...drawerHeading('{s:media}'),
            when: [{ test: 'env.libraryCount', is: 'gt', value: '0' }],
          } as Node,
          {
            ...drawerHeading('{s:media}'),
            when: [{ test: 'env.libraryCount', is: 'eq', value: '0' }, { test: 'env.canLive' }],
          } as Node,
          {
            type: 'repeat',
            over: 'nav.destinations',
            item: {
              type: 'box',
              style: col(),
              children: [
                drawerItem(
                  'jt-drawer-{dest.id}',
                  '{dest.name}',
                  [jelly('live', 22)],
                  onLive,
                  { action: 'live' },
                  [isLive, { test: 'env.canLive' }],
                ),
                drawerItem(
                  'jt-drawer-{dest.id}',
                  '{dest.name}',
                  kindGlyphs('dest.kind', 22),
                  { test: 'dest.on' },
                  { action: 'library', arg: '{dest.id}' },
                  [not(isLive)],
                ),
              ],
            },
          },
          drawerItem('jt-drawer-live', '{s:liveTv}', [jelly('live', 22)], onLive, { action: 'live' }, [
            { test: 'env.canLive' },
            { test: 'env.hasLiveLibrary', not: true },
          ]),
          drawerHeading('{s:user}'),
          {
            type: 'box',
            style: row({ gap: '12px', 'align-items': 'center', padding: '6px 20px 10px' }),
            children: [
              glyph('person', 22),
              { type: 'text', text: '{env.viewer}', style: { 'font-size': '15px', 'line-clamp': '1' } },
            ],
          },
          drawerItem(
            'jt-drawer-appearance',
            '{s:appearance}',
            [glyph('sparkles', 22)],
            undefined,
            { action: 'openPicker' },
            [{ test: 'env.skinCount', is: 'gt', value: '1' }],
          ),
          drawerItem('jt-drawer-signout', '{s:signOut}', [glyph('sign-out', 22)], undefined, {
            action: 'signOut',
          }),
        ],
      },
    ],
  },
];

export const shell: Node = {
  type: 'box',
  style: col({
    position: 'relative',
    height: '100%',
    'min-height': '0px',
    'background-color': '$page',
    color: '$ink',
    'color-scheme': 'dark',
    'font-family': sans,
  }),
  children: [
    header,
    {
      type: 'slot',
      slot: 'children',
      style: col({ position: 'relative', flex: '1', 'min-height': '0px' }),
      inner: col({ 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' }),
    },
    ...userMenu,
    ...drawer,
  ],
};

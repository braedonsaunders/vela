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

// Which Vela this is, where it runs and the server, under the menu's and the drawer's last row:
// quiet, selectable, and on TV a stop the remote reaches.
const aboutLine: Node = {
  type: 'box',
  when: [{ test: 'env.aboutLine' }],
  readingStop: true,
  label: '{env.aboutLabel}',
  testId: 'about-line',
  children: [{ type: 'text', text: '{env.aboutLine}', style: { 'font-size': '12px', 'line-height': '16px', color: '$secondary' } }],
};

const onLive: Condition = { test: 'env.section', is: 'eq', value: 'live' };
const onHome: Condition = { test: 'env.section', is: 'eq', value: 'home' };
// The header's sections: Home, the server's libraries in order (live only when offered),
// and Live TV when no library is live.
const sectionBar = { name: 'jt-tab', bottom: 2 };
// More (`fit`, the header's tabs): the bar keeps the tabs it has room for (the renderer measures
// them) and the rest wait in a menu under this tab, which is the current one while their section is.
const moreOn: Condition = { test: 'nav.moreOn' };
const moreRow = (label: string, on: Condition, press: Press, testId: string, when: Condition[]): Node => ({
  type: 'box', press, label, testId, when, a11y: { current: [on] },
  style: menuRow, states: [{ when: [on], style: { ...menuRow, color: '$accent', 'font-weight': '600' } }],
  hover: { 'background-color': '$hover' }, focus: { outline: 'auto', 'background-color': '$hover' },
  children: [{ type: 'text', text: label, style: { flex: '1', 'line-clamp': '1' } }],
});
// More is a 44px target (the bar's own tabs are 40px).
const tall = (node: Node): Node => {
  const box = node as Node & { style: Style; states: { when: Condition[]; style: Style }[] };
  return { ...box, style: { ...box.style, height: '44px' }, states: box.states.map(state => ({ ...state, style: { ...state.style, height: '44px' } })) } as Node;
};
const moreTab: Node = {
  type: 'box',
  when: [{ test: 'nav.more' }],
  style: row({ position: 'relative', 'flex-shrink': '0' }),
  children: [
    tall(tabNode('{s:more}', moreOn, { action: 'only', arg: 'more', focus: 'jt-more-menu' }, sectionBar, {
      id: 'jt-more', testId: 'nav-more', label: '{s:moreSections}',
      a11y: { current: [moreOn], expanded: [{ test: 'flag:more' }], haspopup: 'menu' },
    })),
    {
      type: 'box',
      when: [{ test: 'flag:more' }],
      id: 'jt-more-menu',
      role: 'navigation',
      label: '{s:moreSections}',
      motion: 'menuIn',
      escape: 'more',
      returnFocus: 'jt-more',
      style: { ...sheet, ...col({ position: 'absolute', top: '100%', right: '0px', 'margin-top': '8px', 'z-index': '30', width: '240px', 'max-height': '70vh', 'overflow-y': 'auto', padding: '8px', gap: '2px', 'transform-origin': 'top right' }) },
      children: [
        {
          type: 'repeat',
          over: 'nav.destinations',
          when: [{ test: 'dest.more' }],
          item: {
            type: 'box',
            style: col(),
            children: [
              moreRow('{dest.name}', onLive, { action: 'live' }, 'nav-more-{dest.id}', [isLive, { test: 'nav.showLive' }]),
              moreRow('{dest.name}', { test: 'dest.on' }, { action: 'library', arg: '{dest.id}' }, 'nav-more-{dest.id}', [not(isLive)]),
            ],
          },
        },
        moreRow('{s:liveTv}', onLive, { action: 'live' }, 'nav-more-live', [{ test: 'nav.showLive' }, { test: 'env.hasLiveLibrary', not: true }, { test: 'nav.liveMore' }]),
      ],
    },
  ],
};

// `fit`: the bar's tabs keep to the room between the wordmark and Search; the strip under a compact
// bar scrolls.
const sections = (style: Style, below: Style, fit = false): Node => ({
  type: 'box',
  role: 'tablist',
  label: '{s:sections}',
  ...(fit ? { fit: 'nav' as const } : {}),
  style: row({
    'align-items': 'center',
    'min-width': '0px',
    ...(fit ? { 'max-width': '100%' } : { 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }),
    ...style,
  }),
  below: { [COMPACT]: below },
  children: [
    ...(fit ? [] : [{ type: 'box', style: { flex: '1' } } as Node]),
    tabNode('{s:home}', onHome, { action: 'home' }, sectionBar, { testId: 'nav-{s:home}' }),
    {
      type: 'repeat',
      over: 'nav.destinations',
      item: {
        type: 'box',
        ...(fit ? { when: [{ test: 'dest.more', not: true }] } : {}),
        style: row({ 'flex-shrink': '0' }),
        children: [
          tabNode('{dest.name}', onLive, { action: 'live' }, sectionBar, {
            testId: 'nav-{dest.name}',
            when: [isLive, { test: 'nav.showLive' }],
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
      when: [{ test: 'nav.showLive' }, { test: 'env.hasLiveLibrary', not: true }, ...(fit ? [{ test: 'nav.liveMore', not: true }] : [])],
    }),
    ...(fit ? [moreTab] : [{ type: 'box', style: { flex: '1' } } as Node]),
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
        // The room the tabs fit to, centring them.
        {
          type: 'box',
          style: row({ position: 'relative', flex: '1', 'min-width': '0px', 'align-items': 'center', 'justify-content': 'center' }),
          below: { [COMPACT]: { display: 'none' } },
          children: [sections({}, {}, true)],
        },
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
      {
        type: 'box',
        when: [{ test: 'env.canManageLibraries' }],
        press: { action: 'manageLibraries' },
        label: '{s:manageLibraries}',
        testId: 'manage-libraries',
        style: menuRow,
        hover: { 'background-color': '$hover' },
        focus: { outline: 'auto', 'background-color': '$hover' },
        children: [glyph('library', 20), { type: 'text', text: '{s:manageLibraries}' }],
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
      { ...aboutLine, style: { padding: '8px 12px 6px', 'border-radius': '6px' } },
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
            when: [{ test: 'env.libraryCount', is: 'eq', value: '0' }, { test: 'nav.showLive' }],
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
                  [isLive, { test: 'nav.showLive' }],
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
            { test: 'nav.showLive' },
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
          drawerItem('jt-drawer-manage-libraries', '{s:manageLibraries}', [glyph('library', 22)], undefined, { action: 'manageLibraries' }, [
            { test: 'env.canManageLibraries' },
          ]),
          drawerItem('jt-drawer-signout', '{s:signOut}', [glyph('sign-out', 22)], undefined, {
            action: 'signOut',
          }),
          { ...aboutLine, style: { padding: '14px 20px 20px' } },
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

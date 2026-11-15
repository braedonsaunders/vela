// Jelly Twin as a skin document (protocol/v0/skin.ts): a familiar home-media client,
// near-black with cyan accents and card rows. It reproduces the compiled skin it replaces
// node for node: the header with section tabs and a slide-in drawer, the featured banner,
// My Media tiles, poster and wide-thumbnail rows, and the flat title page.
import type { Action, Condition, Node, SkinDocument, Style } from '../../../skin';

type Press = { action: Action; arg?: string; focus?: string };

const id = 'jellytwin', version = '1.0.0';
const asset = (file: string) => `/vela/v0/appearance/skins/${id}/${version}/${file}`;

const sans = '"Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const gradient = 'linear-gradient(90deg, $violet 0%, $accent 100%)';
// The page gutter: 3.3% of the width, 14px on a phone.
const side: Style = { 'padding-left': '3.3%', 'padding-right': '3.3%' };
const sideSmall: Style = { 'padding-left': '14px', 'padding-right': '14px' };
const row = (s: Style = {}): Style => ({ display: 'flex', 'flex-direction': 'row', ...s });
const col = (s: Style = {}): Style => ({ display: 'flex', 'flex-direction': 'column', ...s });
const fill: Style = { position: 'absolute', inset: '0px' };
// The shell recomposes under 800px (the compiled skin's `compact`); pages under 640px (`small`).
const COMPACT = '800';
// A bottom hairline (the other sides stay unbordered).
const hairline: Style = { 'border-width': '0px', 'border-style': 'solid', 'border-bottom-width': '1px', 'border-bottom-color': '$line' };
const not = (c: Condition): Condition => ({ ...c, not: !c.not });

// Glyphs: platform symbols, and the skin's own single-path line icons painted in currentColor.
const glyph = (symbol: string, size: number, extra: Partial<Node> = {}): Node => ({ type: 'icon', symbol, style: { width: `${size}px`, height: `${size}px`, 'flex-shrink': '0' }, ...extra } as Node);
const PATHS: Record<string, [string, boolean]> = {
  film: ['M3 4h18v16H3Z M8 6h8v12H8Z M4.5 6h2v2h-2Z M4.5 11h2v2h-2Z M4.5 16h2v2h-2Z M17.5 6h2v2h-2Z M17.5 11h2v2h-2Z M17.5 16h2v2h-2Z', true],
  tv: ['M2 5h20v13H2Z M4 7h16v9H4Z M11.2 18h1.6v2h-1.6Z M7.5 20h9v1.6h-9Z', true],
  folder: ['M3 5h6.2l2 2.5H21V19H3Z M5 9.5h14V17H5Z', true],
  live: ['M2 5h20v13H2Z M4 7h16v9H4Z M12 9.2a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6Z M11.2 18h1.6v2h-1.6Z M7.5 20h9v1.6h-9Z M8.4 1.2 12 4.2 15.6 1.2 16.6 2.4 12.9 5.4h-1.8L7.4 2.4Z', true],
  left: ['M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12Z', false],
  right: ['M8.6 5.4 10 4l8 8-8 8-1.4-1.4 6.6-6.6Z', false],
};
const jelly = (name: string, size: number, extra: Partial<Node> = {}): Node => ({ type: 'icon', paths: [PATHS[name][0]], viewBox: '0 0 24 24', fillRule: PATHS[name][1] ? 'evenodd' : 'nonzero', style: { width: `${size}px`, height: `${size}px`, 'flex-shrink': '0' }, ...extra } as unknown as Node);
// A library or title kind's glyph: film, television, live or a folder (only the matching one shows).
const KINDS: [string, string[]][] = [['film', ['movies', 'movie']], ['tv', ['shows', 'show', 'season', 'episode']], ['live', ['live']]];
const kindGlyphs = (key: string, size: number, style: Style = {}): Node[] => [
  ...KINDS.flatMap(([icon, kinds]) => kinds.map(k => jelly(icon, size, { when: [{ test: key, is: 'eq', value: k }] }))),
  jelly('folder', size, { when: KINDS.flatMap(([, kinds]) => kinds).map(k => ({ test: key, is: 'ne' as const, value: k })) }),
].map(n => ({ ...n, style: { ...n.style, ...style } } as Node));

// The placeholder tile colour, stable per identity: one of five, by the identity's length.
const tile = (seed: string, extra: Style = {}, when: Condition[] = []): Node => ({ type: 'box', style: { ...fill, 'background-color': '$tile-5', ...extra },
  states: [1, 2, 3, 4].map(i => ({ when: [{ test: seed, is: 'mod', value: `5:${i - 1}` }], style: { ...fill, 'background-color': `$tile-${i}`, ...extra } })), when } as Node);

// The shared control looks (look.contract).
const iconBtn = (size: number): Style => ({ position: 'relative', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', 'flex-shrink': '0', width: `${size}px`, height: `${size}px`, padding: '0px', 'border-radius': '999px', 'background-color': 'transparent', color: '$ink-strong', cursor: 'pointer', transition: 'background-color 160ms linear, color 160ms linear' });
const iconBtnHover: Style = { color: '$accent', 'background-color': '$accent-soft' };
// Keyboard focus: the hover look plus the platform's own ring, as on a compiled button.
const iconBtnFocus: Style = { ...iconBtnHover, outline: 'auto' };
const menuRow: Style = { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '14px', 'box-sizing': 'border-box', width: '100%', 'min-height': '44px', padding: '0px 16px', 'border-radius': '4px', 'background-color': 'transparent', color: '$ink-strong', 'font-size': '15px', 'text-align': 'left', cursor: 'pointer' };
const submit: Style = { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'justify-content': 'center', gap: '10px', 'box-sizing': 'border-box', height: '46px', padding: '0px 20px', 'border-radius': '4px', 'background-color': '$accent', color: '$ink-strong', 'font-size': '15px', 'font-weight': '600', cursor: 'pointer' };
const submitFocus: Style = { 'box-shadow': '0px 0px 0px 2px $page, 0px 0px 0px 4px $accent', outline: 'auto' };
const tab: Style = { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'box-sizing': 'border-box', height: '40px', padding: '0px 14px', 'background-color': 'transparent', color: '$ink', 'font-size': '15px', 'font-weight': '400', 'white-space': 'nowrap', 'flex-shrink': '0', cursor: 'pointer' };
const sheet: Style = { 'box-sizing': 'border-box', padding: '8px 0px', 'border-radius': '6px', 'background-color': '$popup', color: '$ink-strong', 'box-shadow': '0px 12px 40px $shadow' };
const initial = (size: number, font: number): Node => ({ type: 'text', text: '{env.viewerInitial}', style: { width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-size': `${font}px`, 'font-weight': '600', color: '$ink-strong', 'background-image': gradient, 'flex-shrink': '0' } });
const wordmark: Node = { type: 'image', src: 'assets/brand/vela-lockup.svg', alt: '', style: { width: `${28 * 2.629}px`, height: '28px', 'flex-shrink': '0' } };
// A tab: quiet until hovered, accent and semibold when current, with the gradient bar that slides between tabs.
const tabNode = (label: string, on: Condition, press: Press, bar: { name: string; bottom: number }, extra: Partial<Node> = {}): Node => ({
  type: 'box', press, label, style: tab, hover: { color: '$accent' }, focus: { outline: 'auto', color: '$accent' },
  states: [{ when: [on], style: { ...tab, color: '$accent', 'font-weight': '600' }, hover: { color: '$accent' }, focus: { outline: 'auto', color: '$accent' } }],
  a11y: { role: 'tab', selected: [on] },
  children: [
    // Weight is resolved down the tree from the base style, so the current tab's text carries its own.
    { type: 'text', text: label, states: [{ when: [on], style: { 'font-weight': '600' } }] },
    { type: 'box', when: [on], sharedElement: bar.name, layoutTransition: '300ms ease-out', style: { position: 'absolute', left: '12px', right: '12px', bottom: `${bar.bottom}px`, height: '3px', 'border-radius': '2px', 'background-image': gradient } },
  ], ...extra } as Node);
// The indeterminate spinner: an accent arc turning on a faint ring.
const spinner = (size: number, extra: Partial<Node> = {}): Node => ({ type: 'box', motion: 'spin', style: { width: `${size}px`, height: `${size}px`, 'box-sizing': 'border-box', 'flex-shrink': '0', 'border-radius': '999px', border: '3px solid $track', 'border-top-color': '$accent' }, ...extra } as Node);
const emptyState = (icon: Node, title: string, message: string, when: Condition[]): Node => ({ type: 'box', when, role: 'status', style: col({ 'align-items': 'center', 'text-align': 'center', gap: '10px', padding: '64px 24px', color: '$secondary' }), children: [
  icon,
  { type: 'text', text: title, style: { 'margin-top': '6px', 'font-size': '20px', 'font-weight': '600', color: '$ink-strong' } },
  { type: 'text', text: message, style: { 'max-width': '30rem', 'font-size': '15px', 'line-height': '1.5' } },
] });

// ---------------------------------------------------------------- Shell

const isLive: Condition = { test: 'dest.kind', is: 'eq', value: 'live' };
const onLive: Condition = { test: 'env.section', is: 'eq', value: 'live' };
const onHome: Condition = { test: 'env.section', is: 'eq', value: 'home' };
// The header's sections: Home, the server's libraries in order (live only when offered), and Live TV when no library is live.
const sectionBar = { name: 'jt-tab', bottom: 2 };
const sections = (style: Style, below: Style): Node => ({ type: 'box', role: 'tablist', label: '{s:sections}', style: row({ 'align-items': 'center', 'min-width': '0px', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', ...style }), below: { [COMPACT]: below }, children: [
  { type: 'box', style: { flex: '1' } },
  tabNode('{s:home}', onHome, { action: 'home' }, sectionBar, { testId: 'nav-{s:home}' }),
  { type: 'repeat', over: 'nav.destinations', item: { type: 'box', style: row({ 'flex-shrink': '0' }), children: [
    tabNode('{dest.name}', onLive, { action: 'live' }, sectionBar, { testId: 'nav-{dest.name}', when: [isLive, { test: 'env.canLive' }] }),
    tabNode('{dest.name}', { test: 'dest.on' }, { action: 'library', arg: '{dest.id}' }, sectionBar, { testId: 'nav-{dest.name}', when: [not(isLive)] }),
  ] } },
  tabNode('{s:liveTv}', onLive, { action: 'live' }, sectionBar, { testId: 'nav-{s:liveTv}', when: [{ test: 'env.canLive' }, { test: 'env.hasLiveLibrary', not: true }] }),
  { type: 'box', style: { flex: '1' } },
] });

const headerHeight = { style: { height: '58px' }, below: { [COMPACT]: { height: '52px' } } };
const header: Node = { type: 'box', role: 'navigation', label: '{s:mainNavigation}', when: [{ test: 'env.viewer' }],
  style: col({ position: 'relative', 'flex-shrink': '0', 'z-index': '20', 'background-color': '$header', 'backdrop-filter': 'blur(12px)', 'box-shadow': '0px 2px 6px $shadow' }), children: [
    { type: 'box', style: row({ ...headerHeight.style, 'box-sizing': 'border-box', 'padding-left': '10px', 'padding-right': '14px', 'align-items': 'center', gap: '6px' }),
      below: { [COMPACT]: { ...headerHeight.below[COMPACT], 'padding-left': '4px', 'padding-right': '6px', gap: '2px' } }, children: [
        { type: 'box', id: 'jt-menu', press: { action: 'only', arg: 'drawer', focus: 'jt-drawer-home' }, label: '{s:openMenu}', testId: 'jt-menu', a11y: { expanded: [{ test: 'flag:drawer' }] },
          style: iconBtn(44), hover: iconBtnHover, focus: iconBtnFocus, children: [glyph('menu', 24)] },
        { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', style: { position: 'relative', padding: '0px 8px', 'flex-shrink': '0', color: '$ink-strong' }, children: [wordmark] },
        sections({ flex: '1' }, { display: 'none' }),
        { type: 'box', style: { display: 'none' }, below: { [COMPACT]: { display: 'flex', flex: '1' } } },
        { type: 'box', press: { action: 'search', focus: 'vela-search' }, label: '{s:search}', testId: 'jt-search-button', style: iconBtn(44), hover: iconBtnHover, focus: iconBtnFocus, children: [glyph('search', 23)] },
        { type: 'box', id: 'jt-user', press: { action: 'only', arg: 'menu' }, label: '{s:profile}', testId: 'profile-menu', a11y: { expanded: [{ test: 'flag:menu' }] },
          style: iconBtn(44), hover: iconBtnHover, focus: iconBtnFocus, children: [initial(30, 14)] },
      ] },
    // Under 800px the tabs take their own line under the bar, centred.
    sections({ display: 'none' }, { display: 'flex', 'padding-left': '6px', 'padding-right': '6px' }),
  ] };

const userMenu: Node[] = [
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:menu' }], press: { action: 'close', arg: 'menu' }, label: '{s:close}', style: { ...fill, 'z-index': '29', 'background-color': 'transparent' } },
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:menu' }], id: 'jt-user-menu', role: 'dialog', label: '{s:profile}', motion: 'menuIn', exit: 'menuOut', escape: 'menu', returnFocus: 'jt-user',
    style: { ...sheet, ...col({ position: 'absolute', top: '56px', right: '14px', 'z-index': '30', width: '260px', padding: '8px', gap: '4px', 'transform-origin': 'top right' }) }, below: { [COMPACT]: { top: '50px', right: '8px' } }, children: [
      { type: 'box', style: row({ gap: '12px', 'align-items': 'center', padding: '10px 12px 12px' }), children: [
        initial(40, 17),
        { type: 'text', text: '{env.viewer}', style: { 'font-size': '16px', 'font-weight': '600', flex: '1', 'min-width': '0px', 'line-clamp': '1' } },
      ] },
      { type: 'box', style: { height: '1px', 'background-color': '$line', margin: '0px 8px 6px' } },
      { type: 'box', when: [{ test: 'env.skinCount', is: 'gt', value: '1' }], press: { action: 'openPicker' }, label: '{s:appearance}', testId: 'skin-picker', a11y: { haspopup: 'dialog' },
        style: menuRow, hover: { 'background-color': '$hover' }, focus: { outline: 'auto', 'background-color': '$hover' }, children: [glyph('sparkles', 20), { type: 'text', text: '{s:appearance}' }] },
      { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
      { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
      { type: 'box', press: { action: 'signOut' }, label: '{s:signOut}', style: menuRow, hover: { 'background-color': '$hover' }, focus: { outline: 'auto', 'background-color': '$hover' }, children: [glyph('sign-out', 20), { type: 'text', text: '{s:signOut}' }] },
    ] },
];

// A drawer entry: its glyph and name, accent on a soft accent ground when current.
const drawerRow: Style = { ...menuRow, 'border-radius': '0px', padding: '0px 20px', 'min-height': '48px', gap: '18px' };
const drawerItem = (domId: string, label: string, glyphs: Node[], on: Condition | undefined, press: Press, when: Condition[] = []): Node => ({
  type: 'box', id: domId, press, label, when, style: drawerRow, hover: { 'background-color': '$hover' }, focus: { outline: 'auto', 'background-color': '$hover' },
  ...(on ? { a11y: { current: [on] }, states: [{ when: [on], style: { ...drawerRow, 'background-color': '$accent-soft', color: '$accent' }, hover: { 'background-color': '$accent-soft' }, focus: { outline: 'auto', 'background-color': '$accent-soft' } }] } : {}),
  children: [...glyphs, { type: 'text', text: label, style: { 'font-size': '15px', 'line-clamp': '1' } }] } as Node);
const drawerHeading = (text: string): Node => ({ type: 'text', text, style: { 'font-size': '13px', 'font-weight': '600', color: '$secondary', padding: '16px 20px 6px' } });

const drawer: Node[] = [
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:drawer' }], press: { action: 'close', arg: 'drawer', focus: 'jt-menu' }, label: '{s:closeMenu}', motion: 'scrimIn', exit: 'scrimOut', style: { ...fill, 'z-index': '40', 'background-color': '$overlay' } },
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:drawer' }], role: 'dialog', label: '{s:menu}', motion: 'drawerIn', exit: 'drawerOut', escape: 'drawer', returnFocus: 'jt-menu',
    style: col({ position: 'absolute', top: '0px', left: '0px', bottom: '0px', 'z-index': '40', width: '300px', 'overflow-y': 'auto', 'overflow-x': 'hidden', 'background-color': '$drawer', 'box-shadow': '4px 0px 24px $shadow' }), below: { [COMPACT]: { width: 'min(300px, 84vw)' } }, children: [
      { type: 'box', style: col({ 'padding-bottom': '24px' }), children: [
        { type: 'box', style: row({ ...headerHeight.style, 'align-items': 'center', 'padding-left': '18px', gap: '10px', ...hairline, 'margin-bottom': '8px', 'flex-shrink': '0' }), below: headerHeight.below, children: [wordmark] },
        drawerItem('jt-drawer-home', '{s:home}', [glyph('home', 22)], onHome, { action: 'home' }),
        { ...drawerHeading('{s:media}'), when: [{ test: 'env.libraryCount', is: 'gt', value: '0' }] } as Node,
        { ...drawerHeading('{s:media}'), when: [{ test: 'env.libraryCount', is: 'eq', value: '0' }, { test: 'env.canLive' }] } as Node,
        { type: 'repeat', over: 'nav.destinations', item: { type: 'box', style: col(), children: [
          drawerItem('jt-drawer-{dest.id}', '{dest.name}', [jelly('live', 22)], onLive, { action: 'live' }, [isLive, { test: 'env.canLive' }]),
          drawerItem('jt-drawer-{dest.id}', '{dest.name}', kindGlyphs('dest.kind', 22), { test: 'dest.on' }, { action: 'library', arg: '{dest.id}' }, [not(isLive)]),
        ] } },
        drawerItem('jt-drawer-live', '{s:liveTv}', [jelly('live', 22)], onLive, { action: 'live' }, [{ test: 'env.canLive' }, { test: 'env.hasLiveLibrary', not: true }]),
        drawerHeading('{s:user}'),
        { type: 'box', style: row({ gap: '12px', 'align-items': 'center', padding: '6px 20px 10px' }), children: [
          glyph('person', 22), { type: 'text', text: '{env.viewer}', style: { 'font-size': '15px', 'line-clamp': '1' } },
        ] },
        drawerItem('jt-drawer-appearance', '{s:appearance}', [glyph('sparkles', 22)], undefined, { action: 'openPicker' }, [{ test: 'env.skinCount', is: 'gt', value: '1' }]),
        drawerItem('jt-drawer-signout', '{s:signOut}', [glyph('sign-out', 22)], undefined, { action: 'signOut' }),
      ] },
    ] },
];

const shell: Node = { type: 'box', style: col({ position: 'relative', height: '100%', 'min-height': '0px', 'background-color': '$page', color: '$ink', 'color-scheme': 'dark', 'font-family': sans }), children: [
  header,
  { type: 'slot', slot: 'children', style: col({ position: 'relative', flex: '1', 'min-height': '0px' }), inner: col({ 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' }) },
  ...userMenu,
  ...drawer,
] };

// ---------------------------------------------------------------- Cards and rows

// The card every row draws: artwork with the played mark and progress, the name and its subline.
// Posters and wide thumbnails scale with the window; a row of episodes or part-watched titles is wide.
const posterW = { style: 'clamp(128px, 11.6vw, 220px)', small: '31vw' };
const wideW = { style: 'clamp(240px, 21.5vw, 400px)', small: '62vw' };
const subline: Style = { width: '100%', 'min-height': '1.3em', 'font-size': '13px', color: '$secondary', 'line-clamp': '1', 'font-variant-numeric': 'tabular-nums' };
const isEpisode: Condition = { test: 'card.kind', is: 'eq', value: 'episode' };
const hasSE: Condition[] = [isEpisode, { test: 'card.seasonNumberLabel' }, { test: 'card.episodeNumberLabel' }];
// "Not an episode with both numbers", written as the three ways it can hold.
const noSE: Condition[][] = [[not(isEpisode)], [isEpisode, { test: 'card.seasonNumberLabel', not: true }], [isEpisode, { test: 'card.seasonNumberLabel' }, { test: 'card.episodeNumberLabel', not: true }]];
const card = (wide: boolean, width = wide ? wideW : posterW): Node => {
  const art = wide ? ['card.backdrop', 'card.poster'] : ['card.poster', 'card.backdrop'];
  const noArt: Condition[] = [{ test: 'card.poster', not: true }, { test: 'card.backdrop', not: true }];
  const ring: Style = { 'box-shadow': '0px 0px 0px 3px $accent', filter: 'brightness(0.75)' };
  return { type: 'box', style: col({ position: 'relative', width: width.style, 'flex-shrink': '0', gap: '1px', 'align-items': 'center', 'text-align': 'center' }),
    small: { width: width.small }, children: [
      { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
      { type: 'box', press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
        style: { position: 'relative', width: '100%', 'aspect-ratio': wide ? '16 / 9' : '2 / 3', 'border-radius': '5px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', color: '$ink-strong', cursor: 'pointer', 'background-color': '$card', 'box-shadow': '0px 2px 6px $shadow', filter: 'none', transition: 'box-shadow 140ms linear' },
        hover: ring, focus: { ...ring, outline: 'auto' }, children: [
          tile('card.seed', {}, noArt),
          { type: 'image', when: [{ test: art[0] }], src: `{${art[0]}}`, alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
          { type: 'image', when: [{ test: art[0], not: true }, { test: art[1] }], src: `{${art[1]}}`, alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
          { type: 'box', when: noArt, style: { position: 'absolute', top: '34%', left: '34%', width: '32%', height: '32%', color: '$secondary' }, children: kindGlyphs('card.kind', 0, { width: '100%', height: '100%' }) },
          { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '6px', right: '6px', width: '24px', height: '24px', 'border-radius': '12px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$accent', color: '$ink-strong' }, children: [glyph('checkmark', 14)] },
          { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '5px', 'background-color': '$overlay', 'background-image': 'linear-gradient(90deg, $accent {card.progressPct}%, transparent 0%)' } },
        ] },
      { type: 'text', text: '{card.name}', style: { width: '100%', 'margin-top': '6px', 'font-size': '14px', 'font-weight': '500', color: '$ink-strong', 'line-clamp': '1' } },
      // S1:E3 for an episode, else the year, else the facts.
      { type: 'text', when: hasSE, text: '{s:seasonEpisode}', style: subline },
      ...noSE.map(w => ({ type: 'text', when: [...w, { test: 'card.yearLabel' }], text: '{card.yearLabel}', style: subline } as Node)),
      ...noSE.map(w => ({ type: 'text', when: [...w, { test: 'card.yearLabel', not: true }], text: '{card.facts}', style: subline } as Node)),
    ] };
};

// A section: its heading, then one line of cards (wide thumbnails for a landscape row).
// A section: its heading (with page-by-page arrows on a home row), then one line of cards,
// wide thumbnails for a landscape row, and the end cell that asks for the row's next page.
const arrow = (dir: 'pagePrev' | 'pageNext', icon: string, label: string, end: string): Node => ({ type: 'box', press: { action: dir, arg: '{row.id}' }, label, disabled: [{ test: end }],
  style: iconBtn(36), hover: iconBtnHover, focus: iconBtnFocus, disabledStyle: { opacity: '0.35' }, children: [jelly(icon, 22)] } as Node);
const rowEnd: Node = { type: 'box', when: [{ test: 'row.hasMore' }], style: col({ position: 'relative', width: '80px', 'align-self': 'stretch', 'flex-shrink': '0', 'align-items': 'center', 'justify-content': 'center' }), small: { width: '48px' }, children: [
  { type: 'widget', widget: 'sentinel', params: { on: 'row' }, style: fill },
  spinner(28, { when: [{ test: 'row.loadingMore' }] }),
] };
const section = (items: string, heading: Node[], landscape: Condition | undefined, paged = false): Node => ({ type: 'box', style: col({ gap: '8px', 'padding-bottom': '26px' }), small: { gap: '6px', 'padding-bottom': '18px' }, children: [
  { type: 'box', style: row({ 'align-items': 'center', gap: '8px', ...side, 'min-height': '40px' }), small: sideSmall, children: [
    ...heading,
    ...(paged ? [{ type: 'box', when: [{ test: 'pager.overflows' }, { test: 'env.small', not: true }], style: row({ gap: '8px' }), children: [
      arrow('pagePrev', 'left', '{s:previousPage}', 'pager.atStart'),
      arrow('pageNext', 'right', '{s:nextPage}', 'pager.atEnd'),
    ] } as Node] : []),
  ] },
  { type: 'box', ...(paged ? { pager: { inset: 48, peek: 63 } } : {}), style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', 'scroll-padding-left': '3.3%' }), small: { 'scroll-padding-left': '14px' }, children: [
    { type: 'box', style: row({ gap: '16px', 'align-items': 'flex-start', 'padding-top': '4px', 'padding-bottom': '6px', ...side }), small: { gap: '10px', ...sideSmall }, children: [
      { type: 'repeat', over: items, when: landscape ? [not(landscape)] : [], item: { type: 'use', template: 'poster' } },
      ...(landscape ? [{ type: 'repeat', over: items, when: [landscape], item: { type: 'use', template: 'wide' } } as Node] : []),
      ...(paged ? [rowEnd] : []),
    ] },
  ] },
] } as Node);
const sectionTitle = (text: string, when: Condition[] = []): Node => ({ type: 'text', text, when, role: 'heading', level: 2, style: { flex: '1', 'min-width': '0px', 'font-size': '20px', 'font-weight': '600', color: '$ink-strong', 'line-clamp': '1' } });

// ---------------------------------------------------------------- Home

// The featured banner: full-bleed artwork, the logo or name, facts, the overview and dots.
const dot: Style = { position: 'relative', width: '9px', height: '9px', 'border-radius': '5px', cursor: 'pointer', 'background-color': '$track', 'background-image': 'none' };
const mediaBar: Node = { type: 'repeat', over: 'home.hero', when: [{ test: 'env.searching', not: true }], item: {
  type: 'box', motion: 'fadeIn', style: col({ position: 'relative', height: 'min(54vh, 500px)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'margin-bottom': '22px', 'flex-shrink': '0' }),
  small: { height: '300px', 'margin-bottom': '14px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
    { type: 'image', when: [{ test: 'hero.backdrop' }], src: '{hero.backdrop}', alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
    tile('hero.seed', {}, [{ test: 'hero.backdrop', not: true }]),
    { type: 'box', style: { ...fill, 'background-image': 'linear-gradient(90deg, $scrim 0%, $scrim-clear 65%), linear-gradient(0deg, $page 0%, $scrim-clear 45%)' } },
    { type: 'box', style: col({ position: 'relative', height: '100%', 'justify-content': 'flex-end', 'box-sizing': 'border-box', ...side, 'padding-bottom': '34px', gap: '12px', 'max-width': '48rem' }),
      small: { ...sideSmall, 'padding-bottom': '18px', gap: '8px', 'max-width': 'none' }, children: [
        { type: 'image', when: [{ test: 'hero.logo' }], src: '{hero.logo}', alt: '{hero.name}', role: 'heading', level: 1, style: { height: '120px', width: 'auto', 'max-width': '80%', 'object-fit': 'contain', 'align-self': 'flex-start' }, small: { height: '64px' } },
        { type: 'text', when: [{ test: 'hero.logo', not: true }], text: '{hero.name}', role: 'heading', level: 1, style: { 'font-size': '46px', 'font-weight': '700', color: '$ink-strong', 'line-clamp': '2', 'text-shadow': '0px 2px 12px $shadow' }, small: { 'font-size': '28px' } },
        { type: 'box', style: row({ gap: '14px', 'align-items': 'center', 'flex-wrap': 'wrap' }), children: [
          { type: 'text', when: [{ test: 'hero.yearLabel' }], text: '{hero.yearLabel}', style: { 'font-size': '14px', color: '$ink-strong' } },
          { type: 'text', when: [{ test: 'hero.rating' }], text: '{hero.rating}', style: { 'font-size': '12px', padding: '1px 6px', border: '1px solid $secondary', 'border-radius': '3px', color: '$ink' } },
          { type: 'text', when: [{ test: 'hero.genresLine' }], text: '{hero.genresLine}', style: { 'font-size': '14px', color: '$ink' } },
        ] },
        { type: 'text', when: [{ test: 'hero.summary' }, { test: 'env.small', not: true }], text: '{hero.summary}', style: { 'font-size': '15px', 'line-height': '1.5', color: '$ink', 'line-clamp': '3', 'max-width': '40rem' } },
        { type: 'box', style: row({ gap: '10px', 'margin-top': '4px' }), children: [
          { type: 'box', press: { action: 'select', arg: '{hero.kindId}' }, label: '{hero.label}', style: { ...submit, height: '44px' }, small: { height: '40px' }, hover: { opacity: '0.9' }, focus: submitFocus, children: [
            glyph('info', 19), { type: 'text', text: '{s:moreInfo}' },
          ] },
        ] },
      ] },
    { type: 'box', when: [{ test: 'env.heroCount', is: 'gt', value: '1' }], role: 'group', label: '{s:featured}', style: row({ position: 'absolute', right: '3.3%', bottom: '38px', gap: '8px' }), small: { right: '14px', bottom: '22px' }, children: [
      { type: 'repeat', over: 'home.heroes', item: { type: 'box', press: { action: 'pickHero', arg: '{index}' }, label: '{s:featuredOf}', a11y: { current: [{ test: 'index.current' }] }, layoutTransition: '260ms ease-out',
        style: dot, focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 2px $ink-strong' },
        states: [{ when: [{ test: 'index.current' }], style: { ...dot, width: '22px', 'background-color': '$accent', 'background-image': gradient }, focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 2px $ink-strong' } }] } },
    ] },
  ] } };

// My Media: one wide tile per library, its artwork behind its name.
const libraryTile = (press: Press, when: Condition[]): Node => ({ type: 'box', when, style: col({ width: wideW.style, 'flex-shrink': '0', gap: '7px' }), small: { width: wideW.small, gap: '5px' }, children: [
  { type: 'box', group: true, press, label: '{dest.name}', testId: 'library-{dest.id}',
    style: { position: 'relative', width: '100%', 'aspect-ratio': '16 / 9', 'border-radius': '6px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', color: '$ink-strong', cursor: 'pointer', 'box-shadow': '0px 2px 6px $shadow', transition: 'box-shadow 140ms linear' },
    small: { 'border-radius': '4px' }, hover: { 'box-shadow': '0px 0px 0px 3px $accent' }, focus: { 'box-shadow': '0px 0px 0px 3px $accent', outline: 'auto' }, children: [
      tile('dest.seed'),
      { type: 'image', when: [{ test: 'dest.backdrop' }], src: '{dest.backdrop}', alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
      { type: 'box', when: [{ test: 'dest.backdrop', not: true }], style: col({ ...fill, 'align-items': 'center', 'justify-content': 'center', color: '$secondary' }), children: kindGlyphs('dest.kind', 48, {}).map(n => ({ ...n, small: { width: '34px', height: '34px' } } as Node)) },
      { type: 'box', style: { ...fill, 'background-color': '$overlay', opacity: '0', transition: 'opacity 160ms linear' }, groupHover: { opacity: '0.4' }, groupFocus: { opacity: '0.4' } },
    ] },
  { type: 'text', text: '{dest.name}', style: { 'font-size': '14px', 'font-weight': '500', color: '$ink-strong', 'text-align': 'center', 'line-clamp': '1' }, small: { 'font-size': '13px' } },
] });
const myMedia: Node = { type: 'box', when: [{ test: 'env.searching', not: true }, { test: 'env.libraryCount', is: 'gt', value: '0' }], style: col({ gap: '8px', 'padding-bottom': '26px' }), small: { gap: '6px', 'padding-bottom': '18px' }, children: [
  { type: 'text', text: '{s:myMedia}', role: 'heading', level: 2, style: { 'font-size': '21px', 'font-weight': '600', color: '$ink-strong', ...side, 'min-height': '40px', display: 'flex', 'align-items': 'center' }, small: { 'font-size': '17px', ...sideSmall } },
  { type: 'box', style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }), children: [
    { type: 'box', style: row({ gap: '16px', 'padding-top': '4px', 'padding-bottom': '6px', ...side }), small: { gap: '10px', ...sideSmall }, children: [
      { type: 'repeat', over: 'nav.destinations', item: { type: 'box', style: row({ 'flex-shrink': '0' }), children: [
        libraryTile({ action: 'live' }, [isLive, { test: 'env.canLive' }]),
        libraryTile({ action: 'library', arg: '{dest.id}' }, [not(isLive)]),
      ] } },
    ] },
  ] },
] };

// Search: a field that stays folded away until the header's search opens it or it holds a query.
const open: Condition[][] = [[{ test: 'env.searchFocused' }], [{ test: 'env.searching' }]];
const folded: Style = col({ 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'max-height': '0px', opacity: '0', transition: 'opacity 160ms linear', 'flex-shrink': '0' });
const searchBox: Style = row({ position: 'relative', margin: '18px auto 6px', width: 'calc(100% - 28px)', 'max-width': '760px', height: '48px', 'box-sizing': 'border-box', 'align-items': 'center', gap: '10px', padding: '0px 6px 0px 14px', 'border-radius': '4px', 'background-color': '$field', border: '1px solid $field', 'flex-shrink': '0' });
const searchField: Node = { type: 'box', style: folded, layoutTransition: '220ms ease-out', states: open.map(when => ({ when, style: { ...folded, 'max-height': '96px', opacity: '1' } })), children: [
  { type: 'box', style: searchBox, states: [{ when: [{ test: 'env.searchFocused' }], style: { ...searchBox, 'border-color': '$accent', 'border-top-color': '$accent', 'border-bottom-color': '$accent' } }], children: [
    glyph('search', 20, { style: { width: '20px', height: '20px', 'flex-shrink': '0', color: '$secondary' }, states: [{ when: [{ test: 'env.searchFocused' }], style: { width: '20px', height: '20px', 'flex-shrink': '0', color: '$accent' } }] }),
    { type: 'widget', widget: 'searchInput', params: { placeholder: '{s:search}', label: '{s:searchLibrary}', placeholderColor: '$quiet' }, style: { flex: '1', 'min-width': '0px', height: '100%', color: '$ink-strong', 'font-size': '16px', outline: 'none' } },
    { type: 'box', when: [{ test: 'env.searching' }], press: { action: 'clearSearch' }, label: '{s:clearSearch}', style: iconBtn(36), hover: iconBtnHover, focus: iconBtnFocus, children: [glyph('close', 18)] },
  ] },
] } as Node;

// A page's own loading and failure (status.contract's look): the accent spinner fading in after a
// beat, or the centred message with a way to ask again when the foundation can.
const loading: Condition = { test: 'env.load', is: 'eq', value: 'loading' };
const failed: Condition = { test: 'env.load', is: 'eq', value: 'failed' };
const ready: Condition = { test: 'env.load', is: 'eq', value: 'ready' };
const waiting = (top: number, label: string): Node => ({ type: 'box', when: [loading], role: 'status', label, motion: 'statusIn',
  style: col({ 'align-items': 'center', 'justify-content': 'center', gap: '16px', 'padding-top': `${top}px`, 'padding-bottom': '80px' }), children: [spinner(54, { small: { width: '44px', height: '44px' } })] });
const failure = (message: string): Node => ({ type: 'box', when: [failed], style: col({ gap: '4px' }), children: [
  emptyState(glyph('alert', 44), '{s:quiet}', message, []),
  { type: 'box', when: [{ test: 'env.canRetry' }], style: row({ 'justify-content': 'center' }), children: [
    { type: 'box', press: { action: 'retry' }, label: '{s:tryAgain}', style: { ...submit, height: '42px' }, hover: { opacity: '0.9' }, focus: submitFocus, children: [{ type: 'text', text: '{s:tryAgain}' }] },
  ] },
] });

const home: Node = { type: 'box', style: col({ 'padding-bottom': '40px', color: '$ink', 'font-family': sans }), children: [
  waiting(140, '{s:findingEvening}'),
  failure('{s:homeFailed}'),
  ...([
  searchField,
  { type: 'box', style: col(), children: [mediaBar] },
  { type: 'box', when: [{ test: 'env.searching', not: true }, { test: 'env.heroCount', is: 'eq', value: '0' }], style: { height: '22px', 'flex-shrink': '0' }, small: { height: '14px' } },
  myMedia,
  // Repeats sit in a container: a repeat's own style (its flex order among these nodes) belongs to its items.
  { type: 'box', when: [{ test: 'env.searching', not: true }], style: col(), children: [
    { type: 'repeat', over: 'home.rows', item: section('row.items', [sectionTitle('{row.name}')], { test: 'row.landscape' }, true) },
  ] },
  { type: 'box', when: [{ test: 'env.searching', not: true }, { test: 'env.homeHasMore' }], style: col({ position: 'relative', height: '100px', 'align-items': 'center', 'justify-content': 'center', 'flex-shrink': '0' }), children: [
    { type: 'widget', widget: 'sentinel', params: { on: 'home' }, style: fill },
    { type: 'box', when: [{ test: 'env.homeMoreLoading' }], role: 'status', label: '{s:loadingMore}', style: row(), children: [spinner(36)] },
  ] },
  emptyState(jelly('folder', 44), '{s:nothingHere}', '{s:noRows}', [{ test: 'env.searching', not: true }, { test: 'env.rowCount', is: 'eq', value: '0' }, { test: 'env.heroCount', is: 'eq', value: '0' }]),
  ] as Node[]).map(n => ({ ...n, when: [ready, ...(n.when ?? [])] } as Node)),
] };


// ---------------------------------------------------------------- Library

// A library: its tabs (everything, then each kind the server offers), a toolbar with favourites,
// sort and filter menus, then the titles in a grid in server order.
const raised: Style = row({ position: 'relative', 'align-items': 'center', 'justify-content': 'center', gap: '8px', 'box-sizing': 'border-box', height: '40px', padding: '0px 18px', 'border-radius': '4px', 'background-color': '$raised', color: '$ink-strong', 'font-size': '14px', 'font-weight': '500', cursor: 'pointer' });
const libraryTab = (label: string, on: Condition, arg: string, when: Condition[] = []): Node => tabNode(label, on, { action: 'libraryFilter', arg }, { name: 'jt-library-tab', bottom: 0 }, { when });
// One choice in a menu, with a check beside the current one.
const choice = (label: string, on: Condition, press: Press, when: Condition[] = []): Node => ({ type: 'box', press, label, when, a11y: { role: 'menuitemradio', checked: [on] },
  style: menuRow, hover: { 'background-color': '$hover' }, focus: { 'background-color': '$hover', outline: 'auto' }, states: [{ when: [on], style: { ...menuRow, color: '$accent' }, hover: { 'background-color': '$hover' }, focus: { 'background-color': '$hover', outline: 'auto' } }], children: [
    glyph('checkmark', 18, { style: { width: '18px', height: '18px', 'flex-shrink': '0', opacity: '0' }, states: [{ when: [on], style: { width: '18px', height: '18px', 'flex-shrink': '0', opacity: '1' } }] }),
    { type: 'text', text: label, style: { 'line-clamp': '1' } },
  ] } as Node);
const menuHeading = (text: string, when: Condition[] = [], pad = '8px 16px 4px'): Node => ({ type: 'text', text, when, style: { 'font-size': '13px', 'font-weight': '600', color: '$secondary', padding: pad } });
const divider = (when: Condition[] = []): Node => ({ type: 'box', when, style: { height: '1px', 'flex-shrink': '0', 'background-color': '$line', margin: '6px 0px' } });
const hasFilters: Condition[][] = [[{ test: 'library.canPlayed' }], [{ test: 'library.genreCount', is: 'gt', value: '0' }], [{ test: 'library.canYear' }]];
const filtering: Condition[][] = [[{ test: 'library.playedFilter' }], [{ test: 'library.genreFilter' }], [{ test: 'library.year', is: 'gt', value: '0' }]];
// A menu sheet, anchored under its toolbar button (its right edge 16px inside the button's), the width of the phone less a margin.
const menuSheet = (flag: string, label: string, width: number, shifted: Condition[][], returnFocus: string, children: Node[]): Node => {
  const at = (right: string): Style => ({ ...sheet, ...col({ position: 'absolute', top: '94px', right, 'z-index': '6', width: `${width}px`, 'max-height': '70vh', 'overflow-y': 'auto', 'overflow-x': 'hidden' }) });
  return { type: 'box', when: [{ test: `flag:${flag}` }], role: 'dialog', label, escape: flag, returnFocus, style: at('calc(3.3% + 16px)'), states: shifted.map(when => ({ when, style: at('calc(3.3% + 60px)') })),
    small: { left: '0px', right: 'auto', width: 'calc(100vw - 28px)' }, children } as Node;
};
const toolBtn = (testId: string, domId: string, label: string, press: Press, icon: Node, extra: Partial<Node> = {}): Node => ({ type: 'box', id: domId, testId, press, label, style: iconBtn(40), hover: iconBtnHover, focus: iconBtnFocus, children: [icon], ...extra } as Node);
const sortButton = (when: Condition[]): Node => toolBtn('jt-sort', 'jt-library-sort', '{s:sortBy}', { action: 'toggle', arg: 'sort' }, glyph('sort', 21), { when, a11y: { haspopup: 'dialog', expanded: [{ test: 'flag:sort' }] } });
const filterIcon: Style = { ...iconBtn(40) };

const libraryHeader: Node = { type: 'box', style: col({ position: 'sticky', top: '0px', 'z-index': '5', 'background-color': '$page', ...hairline }), children: [
  { type: 'text', text: '{library.name}', role: 'heading', level: 1, style: { position: 'absolute', width: '1px', height: '1px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', opacity: '0', 'pointer-events': 'none' } },
  { type: 'box', role: 'tablist', label: '{library.name}', style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', 'box-sizing': 'border-box', padding: '6px 8px 0px' }), children: [
    { type: 'box', style: { flex: '1' } },
    libraryTab('{library.name}', { test: 'library.kindFilter', not: true }, 'kind|'),
    { type: 'repeat', over: 'library.kinds', when: [{ test: 'library.kindCount', is: 'gt', value: '1' }], item: libraryTab('{opt.label}', { test: 'opt.on' }, 'kind|{opt.id}') },
    { type: 'box', style: { flex: '1' } },
  ] },
  { type: 'box', role: 'toolbar', label: '{s:libraryTools}', style: row({ 'align-items': 'center', gap: '4px', ...side, 'padding-top': '4px', 'padding-bottom': '6px' }), small: sideSmall, children: [
    { type: 'text', when: [{ test: 'library.sortCount', is: 'gt', value: '0' }], text: '{library.sortLabel}', style: { 'font-size': '13px', color: '$secondary', flex: '1', 'min-width': '0px', 'line-clamp': '1' } },
    { type: 'box', when: [{ test: 'library.sortCount', is: 'eq', value: '0' }], style: { flex: '1' } },
    toolBtn('jt-favourites', 'jt-library-favourites', '{s:favourites}', { action: 'libraryFilter', arg: 'favorite|true' }, glyph('heart', 21), { when: [{ test: 'library.canFavorite' }, { test: 'library.favoriteFilter', not: true }], a11y: { pressed: [{ test: 'library.favoriteFilter' }] } }),
    toolBtn('jt-favourites', 'jt-library-favourites', '{s:favourites}', { action: 'libraryFilter', arg: 'favorite|' }, glyph('heart-fill', 21), { when: [{ test: 'library.canFavorite' }, { test: 'library.favoriteFilter' }], a11y: { pressed: [{ test: 'library.favoriteFilter' }] }, style: { ...iconBtn(40), color: '$accent' } }),
    sortButton([{ test: 'library.sortCount', is: 'gt', value: '1' }]),
    sortButton([{ test: 'library.sortCount', is: 'lt', value: '2' }, { test: 'library.canFlip' }]),
    ...hasFilters.map((w, i) => toolBtn('jt-filter', 'jt-library-filter', '{s:filters}', { action: 'toggle', arg: 'filter' }, glyph('filter', 21), {
      // Shown once, by the first condition that holds; accent while a filter is on.
      when: [...hasFilters.slice(0, i).map(c => ({ ...c[0], ...(c[0].is === 'gt' ? { is: 'lt', value: '1' } : { not: true }) } as Condition)), ...w],
      a11y: { haspopup: 'dialog', expanded: [{ test: 'flag:filter' }] }, style: filterIcon, states: filtering.map(f => ({ when: f, style: { ...filterIcon, color: '$accent' }, hover: iconBtnHover, focus: iconBtnFocus })) })),
  ] },
  // A tap outside an open menu closes it.
  { type: 'box', when: [{ test: 'flag:sort' }], press: { action: 'toggle', arg: 'sort' }, label: '{s:close}', controlStates: false, style: { position: 'absolute', top: '0px', left: '0px', width: '100vw', height: '100vh', 'z-index': '5', 'background-color': 'transparent' } } as Node,
  { type: 'box', when: [{ test: 'flag:filter' }], press: { action: 'toggle', arg: 'filter' }, label: '{s:close}', controlStates: false, style: { position: 'absolute', top: '0px', left: '0px', width: '100vw', height: '100vh', 'z-index': '5', 'background-color': 'transparent' } } as Node,
  menuSheet('sort', '{s:sortBy}', 280, hasFilters, 'jt-library-sort', [
    menuHeading('{s:sortBy}'),
    { type: 'repeat', over: 'library.sorts', item: choice('{opt.label}', { test: 'opt.on' }, { action: 'librarySort', arg: '{opt.id}' }) },
    divider([{ test: 'library.canFlip' }]),
    menuHeading('{s:sortOrder}', [{ test: 'library.canFlip' }]),
    choice('{s:ascending}', { test: 'library.direction', is: 'eq', value: 'asc' }, { action: 'librarySort', arg: '{library.sort}' }, [{ test: 'library.canFlip' }, { test: 'library.direction', is: 'eq', value: 'asc' }]),
    choice('{s:ascending}', { test: 'library.direction', is: 'eq', value: 'asc' }, { action: 'librarySortFlip' }, [{ test: 'library.canFlip' }, { test: 'library.direction', is: 'ne', value: 'asc' }]),
    choice('{s:descending}', { test: 'library.direction', is: 'eq', value: 'desc' }, { action: 'librarySort', arg: '{library.sort}' }, [{ test: 'library.canFlip' }, { test: 'library.direction', is: 'eq', value: 'desc' }]),
    choice('{s:descending}', { test: 'library.direction', is: 'eq', value: 'desc' }, { action: 'librarySortFlip' }, [{ test: 'library.canFlip' }, { test: 'library.direction', is: 'ne', value: 'desc' }]),
  ]),
  // The filter menu opens under the rightmost button; the sort menu, one button to its left, moves over when it is there.
  menuSheet('filter', '{s:filters}', 300, [], 'jt-library-filter', [
    menuHeading('{s:status}', [{ test: 'library.canPlayed' }]),
    choice('{s:all}', { test: 'library.playedFilter', not: true }, { action: 'libraryFilter', arg: 'played|' }, [{ test: 'library.canPlayed' }]),
    choice('{s:unplayed}', { test: 'library.playedFilter', is: 'eq', value: 'false' }, { action: 'libraryFilter', arg: 'played|false' }, [{ test: 'library.canPlayed' }]),
    choice('{s:played}', { test: 'library.playedFilter', is: 'eq', value: 'true' }, { action: 'libraryFilter', arg: 'played|true' }, [{ test: 'library.canPlayed' }]),
    divider([{ test: 'library.genreCount', is: 'gt', value: '0' }]),
    menuHeading('{s:genres}', [{ test: 'library.genreCount', is: 'gt', value: '0' }]),
    choice('{s:anyGenre}', { test: 'library.genreFilter', not: true }, { action: 'libraryFilter', arg: 'genre|' }, [{ test: 'library.genreCount', is: 'gt', value: '0' }]),
    { type: 'repeat', over: 'library.genres', item: choice('{opt.label}', { test: 'opt.on' }, { action: 'libraryFilter', arg: 'genre|{opt.id}' }) },
  ]),
] };

const libraryGrid: Node = { type: 'box', style: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(160px, 1fr))', 'column-gap': '18px', 'row-gap': '26px', ...side },
  small: { 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', 'column-gap': '10px', 'row-gap': '16px', ...sideSmall }, children: [
    { type: 'repeat', over: 'library.items', item: { type: 'use', template: 'gridPoster' } },
  ] };
const library: Node = { type: 'box', style: col({ 'min-height': '100%', color: '$ink', 'font-family': sans, 'padding-bottom': '56px' }), children: [
  waiting(140, '{s:findingTitles}'),
  failure('{s:libraryFailed}'),
  ...([
    libraryHeader,
    { type: 'box', style: col({ 'padding-top': '22px' }), small: { 'padding-top': '14px' }, children: [
      { type: 'box', when: [{ test: 'env.libraryLoading' }, { test: 'library.itemCount', is: 'eq', value: '0' }], role: 'status', label: '{s:findingTitles}', style: row({ 'justify-content': 'center', padding: '64px' }), children: [spinner(48)] },
      emptyState(glyph('filter', 44), '{s:libraryEmpty}', '{s:libraryEmptyHint}', [{ test: 'env.libraryLoading', not: true }, { test: 'library.itemCount', is: 'eq', value: '0' }]),
      { type: 'box', when: [{ test: 'library.itemCount', is: 'gt', value: '0' }], style: col({ opacity: '1', transition: 'opacity 160ms linear' }), states: [{ when: [{ test: 'env.libraryLoading' }], style: col({ opacity: '0.6', transition: 'opacity 160ms linear' }) }], children: [libraryGrid] },
      { type: 'box', when: [{ test: 'library.itemCount', is: 'gt', value: '0' }, { test: 'library.more' }], style: row({ 'justify-content': 'center', 'padding-top': '28px' }), children: [
        { type: 'box', when: [{ test: 'env.libraryMoreLoading' }], role: 'status', label: '{s:loadingMore}', style: row(), children: [spinner(36)] },
        { type: 'box', when: [{ test: 'env.libraryMoreLoading', not: true }], press: { action: 'libraryMore' }, label: '{s:showMore}', testId: 'jt-more', style: raised, hover: { 'background-color': '$raised-hover' }, focus: { 'box-shadow': '0px 0px 0px 2px $accent', outline: 'auto' }, children: [{ type: 'text', text: '{s:showMore}' }] },
      ] },
    ] },
  ] as Node[]).map(n => ({ ...n, when: [ready, ...(n.when ?? [])] } as Node)),
] };

// ---------------------------------------------------------------- Title

const heading2: Style = { 'font-size': '21px', 'font-weight': '600', color: '$ink-strong' };
const heading2Small: Style = { 'font-size': '17px' };
const heading20: Style = { 'font-size': '20px', 'font-weight': '600', color: '$ink-strong' };
const block: Style = col({ 'padding-bottom': '26px' });

// A round action under the title: the play circle carries the gradient.
const roundAction = (label: string, icon: Node, primary: boolean, press: Press, testId: string, when: Condition[] = []): Node => ({
  type: 'box', press, label, testId, when, style: col({ position: 'relative', 'align-items': 'center', gap: '6px', padding: '0px', 'border-radius': '8px', color: '$ink-strong', cursor: 'pointer' }),
  hover: { opacity: '0.88' }, focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 2px $accent' }, children: [
    { type: 'box', style: { width: '58px', height: '58px', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', 'box-shadow': '0px 4px 14px $shadow',
      ...(primary ? { 'background-color': '$accent', 'background-image': gradient } : { 'background-color': '$raised', border: '1px solid $line' }) }, small: { width: '54px', height: '54px' },
      children: [icon] },
    { type: 'text', text: label, style: { 'font-size': '12px', color: '$secondary' } },
  ] });
const infoLine = (label: string, value: string, when: Condition[]): Node => ({ type: 'box', when, style: row({ gap: '10px', 'align-items': 'baseline' }), children: [
  { type: 'text', text: label, style: { color: '$secondary', width: '90px', 'flex-shrink': '0' } },
  { type: 'text', text: value, style: { color: '$ink', flex: '1', 'min-width': '0px' } },
] });

const titleTop: Node = { type: 'box', style: col({ position: 'relative' }), children: [
  { type: 'box', style: col({ position: 'relative', height: 'min(56vh, 520px)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$card' }), small: { height: '230px' }, children: [
    tile('detail.seed', {}, [{ test: 'detail.backdrop', not: true }]),
    { type: 'image', when: [{ test: 'detail.backdrop' }], src: '{detail.backdrop}', alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
    { type: 'box', style: { ...fill, 'background-image': 'linear-gradient(0deg, $page 0%, $scrim-page 18%, $scrim-clear 60%), linear-gradient(180deg, $scrim 0%, $scrim-clear 30%)' } },
  ] },
  { type: 'box', style: row({ position: 'relative', gap: '36px', 'align-items': 'flex-start', ...side, 'margin-top': '-190px' }), small: { gap: '0px', ...sideSmall, 'margin-top': '-60px' }, children: [
    { type: 'box', style: col({ position: 'relative', width: 'clamp(180px, 17vw, 300px)', 'flex-shrink': '0', 'aspect-ratio': '2 / 3', 'border-radius': '6px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$card', 'box-shadow': '0px 8px 30px $shadow', 'align-items': 'center', 'justify-content': 'center', color: '$secondary' }),
      small: { display: 'none' }, children: [
        tile('detail.seed', {}, [{ test: 'detail.poster', not: true }]),
        { type: 'image', when: [{ test: 'detail.poster' }], src: '{detail.poster}', alt: '', style: { width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'box', when: [{ test: 'detail.poster', not: true }], style: { position: 'relative', width: '56px', height: '56px' }, children: kindGlyphs('detail.kind', 0, { width: '100%', height: '100%' }) },
      ] },
    { type: 'box', style: col({ flex: '1', 'min-width': '0px', gap: '16px', 'padding-top': '60px', 'align-items': 'flex-start', 'text-align': 'left' }), small: { gap: '12px', 'padding-top': '0px', 'align-items': 'center', 'text-align': 'center' }, children: [
      { type: 'image', when: [{ test: 'detail.logo' }], src: '{detail.logo}', alt: '{detail.name}', role: 'heading', level: 1, style: { height: '110px', width: 'auto', 'max-width': 'min(480px, 90%)', 'object-fit': 'contain' }, small: { height: '70px', 'max-width': '80%' } },
      { type: 'text', when: [{ test: 'detail.logo', not: true }], text: '{detail.name}', role: 'heading', level: 1, style: { 'font-size': '40px', 'font-weight': '700', color: '$ink-strong', 'line-height': '1.15', 'text-shadow': '0px 2px 10px $shadow' }, small: { 'font-size': '28px' } },
      { type: 'box', style: row({ gap: '14px', 'align-items': 'center', 'flex-wrap': 'wrap', 'justify-content': 'flex-start', 'font-size': '15px' }), small: { 'justify-content': 'center' }, children: [
        { type: 'text', text: '{detail.kindLabel}', style: { color: '$secondary' } },
        { type: 'text', when: [{ test: 'detail.yearLabel' }], text: '{detail.yearLabel}', style: { color: '$ink-strong' } },
        { type: 'text', when: [{ test: 'detail.durationLabel' }, { test: 'detail.kind', is: 'ne', value: 'show' }], text: '{detail.durationLabel}', style: { color: '$ink-strong' } },
        { type: 'text', when: [{ test: 'detail.rating' }], text: '{detail.rating}', style: { 'font-size': '12px', padding: '1px 6px', border: '1px solid $secondary', 'border-radius': '3px' } },
        { type: 'box', when: [{ test: 'detail.played' }], style: row({ gap: '4px', 'align-items': 'center', color: '$accent' }), children: [glyph('checkmark', 16), { type: 'text', text: '{s:played}', style: { 'font-size': '14px' } }] },
      ] },
      { type: 'box', style: row({ gap: '12px', 'align-items': 'flex-start', 'flex-wrap': 'wrap', 'justify-content': 'flex-start', 'margin-top': '4px' }), small: { gap: '14px', 'justify-content': 'center' }, children: [
        roundAction('{s:resume}', glyph('play-fill', 28), true, { action: 'play', arg: '{detail.id}' }, 'detail-play', [{ test: 'detail.canPlay' }, { test: 'detail.hasResume' }]),
        roundAction('{s:play}', glyph('play-fill', 28), true, { action: 'play', arg: '{detail.id}' }, 'detail-play', [{ test: 'detail.canPlay' }, { test: 'detail.hasResume', not: true }]),
        { type: 'repeat', over: 'detail.trailers', item: roundAction('{s:trailer}', jelly('film', 24), false, { action: 'playExtra', arg: '{extra.id}' }, 'detail-trailer-{extra.id}') },
      ] },
      { type: 'box', when: [{ test: 'detail.hasResume' }, { test: 'detail.durationLabel' }], style: col({ gap: '6px', width: '320px' }), small: { width: '70%' }, children: [
        { type: 'box', role: 'progressbar', label: '{s:watchProgress}', style: { height: '5px', 'border-radius': '3px', 'background-color': '$track', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
          { type: 'box', style: { height: '5px', width: '{detail.resumePct}%', 'background-color': '$accent' } },
        ] },
        { type: 'text', text: '{s:resumeFrom}', style: { 'font-size': '13px', color: '$secondary' } },
      ] },
      { type: 'text', when: [{ test: 'detail.summary' }], text: '{detail.summary}', style: { 'font-size': '16px', 'line-height': '1.6', color: '$ink', 'max-width': '52rem', 'text-align': 'left' }, small: { 'font-size': '15px' } },
      { type: 'box', style: col({ gap: '6px', 'font-size': '14px', 'max-width': '52rem', 'align-self': 'stretch', 'text-align': 'left' }), children: [
        infoLine('{s:genres}', '{detail.genresLine}', [{ test: 'detail.genresLine' }]),
        infoLine('{s:crew}', '{detail.crewLineComma}', [{ test: 'detail.crewLineComma' }]),
        { type: 'box', when: [{ test: 'detail.hasMediaFacts' }], style: row({ gap: '8px', 'flex-wrap': 'wrap', 'margin-top': '6px' }), children: [
          { type: 'repeat', over: 'detail.mediaFacts', item: { type: 'text', text: '{fact.text}', style: { 'font-size': '12px', 'font-weight': '600', padding: '4px 8px', 'border-radius': '4px', 'background-color': '$raised', color: '$ink' } } },
        ] },
      ] },
    ] },
  ] },
] };

// One episode in a season's list: its still, number and name, facts and overview.
const episodeRow: Node = { type: 'box', group: true, style: row({ position: 'relative', gap: '20px', 'align-items': 'center', padding: '12px 8px', 'border-radius': '6px', 'background-color': 'transparent' }),
  small: { gap: '12px', 'align-items': 'flex-start' }, children: [
    // The row's ground lights while it is hovered or its play button has focus.
    { type: 'box', style: { ...fill, 'border-radius': '6px', 'background-color': 'transparent' }, groupHover: { 'background-color': '$hover' }, groupFocus: { 'background-color': '$hover' } },
    { type: 'box', press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}', style: { position: 'relative', width: '220px', 'aspect-ratio': '16 / 9', 'flex-shrink': '0', 'border-radius': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$card', color: '$ink-strong', cursor: 'pointer' },
      small: { width: '130px' }, focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 3px $accent' }, children: [
        tile('card.seed', {}, [{ test: 'card.backdrop', not: true }]),
        { type: 'image', when: [{ test: 'card.backdrop' }], src: '{card.backdrop}', alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'box', style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$overlay', opacity: '0', transition: 'opacity 140ms linear' }, groupHover: { opacity: '1' }, groupFocus: { opacity: '1' }, children: [
          { type: 'box', style: { width: '44px', height: '44px', 'border-radius': '22px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$accent' }, children: [glyph('play-fill', 24)] },
        ] },
        { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '6px', right: '6px', width: '24px', height: '24px', 'border-radius': '12px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$accent', color: '$ink-strong' }, children: [glyph('checkmark', 14)] },
        { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '4px', 'background-color': '$overlay' }, children: [
          { type: 'box', style: { height: '100%', width: '{card.progressPct}%', 'background-color': '$accent' } },
        ] },
      ] },
    { type: 'box', style: col({ position: 'relative', flex: '1', 'min-width': '0px', gap: '5px' }), children: [
      { type: 'box', press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'episode-{card.id}', style: { position: 'relative', color: '$ink-strong', 'text-align': 'left', cursor: 'pointer' }, hover: { color: '$accent' }, focus: { outline: 'auto', color: '$accent' }, children: [
        { type: 'text', text: '{episode.numberTitle}', style: { 'font-size': '16px', 'font-weight': '600', 'line-clamp': '2' }, small: { 'font-size': '15px' } },
      ] },
      { type: 'text', when: [{ test: 'card.facts' }], text: '{card.facts}', style: { 'font-size': '13px', color: '$secondary', 'font-variant-numeric': 'tabular-nums' } },
      { type: 'text', when: [{ test: 'card.summary' }, { test: 'env.small', not: true }], text: '{card.summary}', style: { 'font-size': '14px', 'line-height': '1.5', color: '$ink', 'line-clamp': '2' } },
    ] },
  ] };

const seasonTab = tabNode('{card.name}', { test: 'season.on' }, { action: 'select', arg: '{season.pick}' }, { name: 'jt-season-tab', bottom: 0 });

// An extra: a wide tile that plays, or says it is not available yet.
const extraFace = (ready: boolean): Node => ({ type: 'box', when: [{ test: 'extra.ready', not: !ready }], press: { action: 'playExtra', arg: '{extra.id}' }, label: ready ? '{s:playExtra}' : '{s:extraNotAvailable}', disabled: ready ? [] : [{ test: 'extra.ready', not: true }],
  style: { position: 'relative', width: '100%', 'aspect-ratio': '16 / 9', 'border-radius': '6px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '$ink-strong', cursor: ready ? 'pointer' : 'default' },
  hover: { 'box-shadow': '0px 0px 0px 3px $accent' }, focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 3px $accent' }, children: [
    tile('extra.seed'),
    { type: 'box', style: { position: 'relative', width: '48px', height: '48px', 'border-radius': '24px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': ready ? '$accent' : '$raised', opacity: ready ? '1' : '0.6' }, children: [glyph(ready ? 'play-fill' : 'info', 24)] },
  ] } as Node);
const extraCard: Node = { type: 'box', style: col({ width: 'clamp(220px, 18vw, 320px)', 'flex-shrink': '0', gap: '6px' }), small: { width: '52vw' }, children: [
  extraFace(true), extraFace(false),
  { type: 'text', text: '{extra.name}', style: { 'font-size': '13px', 'font-weight': '500', color: '$ink-strong', 'text-align': 'center', 'line-clamp': '1' } },
  { type: 'text', when: [{ test: 'extra.ready', not: true }], text: '{s:notYet}', style: { 'font-size': '12px', color: '$secondary', 'text-align': 'center' } },
] };

const person: Node = { type: 'box', role: 'listitem', style: col({ width: 'clamp(110px, 8.6vw, 160px)', 'flex-shrink': '0', gap: '2px', 'align-items': 'center', 'text-align': 'center' }), small: { width: '26vw' }, children: [
  { type: 'image', when: [{ test: 'person.portrait' }], src: '{person.portrait}', alt: '', style: { width: '100%', 'aspect-ratio': '2 / 3', 'border-radius': '6px', 'object-fit': 'cover', 'margin-bottom': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden' } },
  { type: 'box', when: [{ test: 'person.portrait', not: true }], style: col({ position: 'relative', width: '100%', 'aspect-ratio': '2 / 3', 'border-radius': '6px', 'margin-bottom': '4px', 'align-items': 'center', 'justify-content': 'center', color: '$secondary', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }), children: [
    tile('person.seed'),
    glyph('person', 46, { style: { position: 'relative', width: '46px', height: '46px' }, small: { width: '34px', height: '34px' } }),
  ] },
  { type: 'text', text: '{person.name}', style: { width: '100%', 'font-size': '13px', 'font-weight': '500', color: '$ink-strong', 'line-clamp': '2' } },
  { type: 'text', when: [{ test: 'person.role' }], text: '{person.role}', style: { width: '100%', 'font-size': '12px', color: '$secondary', 'line-clamp': '1' } },
] };

const hscroll = (children: Node[], role?: string): Node => ({ type: 'box', style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }), children: [
  { type: 'box', role, style: row({ gap: '16px', ...side, 'padding-bottom': '6px' }), small: { gap: '10px', ...sideSmall }, children },
] });

const titleRest: Node = { type: 'box', style: col({ 'padding-top': '40px', 'padding-bottom': '56px' }), small: { 'padding-top': '26px' }, children: [
  { type: 'repeat', over: 'detail.upNext', item: { type: 'box', style: col({ gap: '10px', ...side, ...block }), small: { ...sideSmall, 'padding-bottom': '18px' }, children: [
    { type: 'text', text: '{s:nextUp}', role: 'heading', level: 2, style: heading2, small: heading2Small },
    { type: 'box', style: row({ gap: '14px', 'align-items': 'center' }), children: [
      { type: 'use', template: 'upNext' },
      { type: 'box', when: [{ test: 'env.small', not: true }], press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}', style: { ...iconBtn(56), 'background-color': '$raised' }, hover: iconBtnHover, focus: iconBtnFocus, children: [glyph('play-fill', 28)] },
    ] },
  ] } },
  { ...section('detail.seasons', [sectionTitle('{s:seasons}')], undefined), when: [{ test: 'detail.seasonCount', is: 'gt', value: '0' }, { test: 'detail.hasEpisodes', not: true }] } as Node,
  { type: 'box', when: [{ test: 'detail.hasEpisodes' }], style: col({ gap: '4px', ...side, ...block }), small: { ...sideSmall, 'padding-bottom': '18px' }, children: [
    { type: 'text', text: '{s:episodes}', role: 'heading', level: 2, style: { ...heading20, 'padding-bottom': '4px' } },
    { type: 'box', when: [{ test: 'detail.seasonCount', is: 'gt', value: '1' }], role: 'tablist', label: '{s:seasons}', testId: 'season-picker', style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', 'margin-bottom': '8px', ...hairline }), children: [
      { type: 'repeat', over: 'detail.seasons', item: seasonTab },
    ] },
    { type: 'repeat', over: 'detail.episodes', item: episodeRow },
  ] },
  { type: 'box', when: [{ test: 'detail.hasExtras' }], style: col({ gap: '10px', ...block }), small: { 'padding-bottom': '18px' }, children: [
    { type: 'text', text: '{s:specialFeatures}', role: 'heading', level: 2, style: { ...heading2, ...side }, small: { ...heading2Small, ...sideSmall } },
    hscroll([{ type: 'repeat', over: 'detail.extras', item: extraCard }]),
  ] },
  { type: 'box', when: [{ test: 'detail.hasCast' }], style: col({ gap: '10px', ...block }), small: { 'padding-bottom': '18px' }, children: [
    { type: 'text', text: '{s:cast}', role: 'heading', level: 2, style: { ...heading20, ...side }, small: sideSmall },
    hscroll([{ type: 'repeat', over: 'detail.cast', item: person }], 'list'),
  ] },
  { type: 'repeat', over: 'detail.related', item: section('row.items', [sectionTitle('{row.name}', [{ test: 'row.name' }]), sectionTitle('{s:moreLikeThis}', [{ test: 'row.name', not: true }])], { test: 'row.landscape' }) },
] };

const title: Node = { type: 'box', style: col({ position: 'relative', height: '100%', 'min-height': '0px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$page', color: '$ink' }), children: [
  { type: 'box', id: 'back', press: { action: 'back' }, label: '{s:closeTitle}', testId: 'detail-close', style: { position: 'absolute', top: '20px', right: '20px', 'z-index': '10', 'box-sizing': 'border-box', width: '44px', height: '44px', border: '1px solid surface.line', 'border-radius': '22px', padding: '13px', 'background-color': 'surface.glass', 'backdrop-filter': 'blur(20px) saturate(1.3)', color: 'ink.primary' },
    children: [{ type: 'icon', symbol: 'close', style: { width: '19px', height: '19px', 'flex-shrink': '0' } }] },
  { type: 'box', id: '{env.route}-scroll-{env.entry}', role: 'region', label: '{s:titleDetails}', style: col({ flex: '1', 'min-height': '0px', 'overflow-y': 'auto', 'overflow-x': 'hidden', 'font-family': sans }), children: [
    waiting(220, '{s:opening}'),
    failure('{s:titleFailed}'),
    { ...titleTop, when: [ready], motion: 'fadeIn' } as Node,
    { ...titleRest, when: [ready], motion: 'fadeIn' } as Node,
  ] },
] };

export default {
  schema: 1, renderer: 10, id, name: 'Jelly Twin', version,
  tagline: 'A familiar home-media client: near-black, cyan accents, card rows.',
  preview: asset('preview.jpg'), swatches: ['#101010', '#ffffff', '#00a4dc', '#aa5cc3', '#292929'],
  tokens: {
    page: '#101010', header: '#101010f2', drawer: '#1c1c1c', raised: '#292929', 'raised-hover': '#383838', card: '#242424', field: '#292929',
    line: '#ffffff1f', ink: '#ffffffde', 'ink-strong': '#ffffff', secondary: '#ffffff99', quiet: '#ffffff66',
    accent: '#00a4dc', 'accent-soft': '#00a4dc33', violet: '#aa5cc3', hover: '#ffffff14',
    overlay: '#00000099', scrim: '#000000b3', 'scrim-clear': '#10101000', 'scrim-page': '#101010d9',
    track: '#ffffff40', popup: '#202020f7', shadow: '#000000a6',
    'tile-1': '#00455c', 'tile-2': '#44007e', 'tile-3': '#1e5631', 'tile-4': '#6b2c1f', 'tile-5': '#234a7a',
  },
  strings: { en: {
    mainNavigation: 'Main navigation', velaHome: 'Vela home', search: 'Search', profile: 'Profile and appearance', close: 'Close',
    openMenu: 'Open menu', closeMenu: 'Close menu', menu: 'Menu', media: 'Media', user: 'User', sections: 'Sections', liveTv: 'Live TV',
    home: 'Home', appearance: 'Change appearance', install: 'Install Vela', update: 'Update ready, reload', signOut: 'Sign out',
    moreInfo: 'More info', featured: 'Featured titles', featuredOf: 'Featured title {index.label} of {env.heroCount}: {hero.name}', myMedia: 'My Media', searchLibrary: 'Search your library', clearSearch: 'Clear search', loadingMore: 'Loading more…', previousPage: 'Scroll {row.name} back', nextPage: 'Scroll {row.name} forward',
    seasonEpisode: 'S{card.seasonNumberLabel}:E{card.episodeNumberLabel}',
    nothingHere: 'Nothing here yet', noRows: 'Your library hasn\'t offered any rows yet. Titles appear here as your server adds them.',
    play: 'Play', resume: 'Resume', resumeFrom: 'Resume from {detail.resumePosition}', trailer: 'Trailer', watchProgress: 'Watch progress', crew: 'Crew', genres: 'Genres', played: 'Played',
    nextUp: 'Next Up', episodes: 'Episodes', seasons: 'Seasons', specialFeatures: 'Special Features', cast: 'Cast', moreLikeThis: 'More Like This', notYet: 'Not available yet',
    playExtra: 'Play {extra.name}', extraNotAvailable: '{extra.name} · Not available',
    tryAgain: 'Try again', findingTitles: 'Finding titles…', libraryFailed: 'This library couldn\'t be opened. Check your connection and try again.',
    libraryTools: 'Library tools', favourites: 'Favourites', sortBy: 'Sort by', sortOrder: 'Sort order', ascending: 'Ascending', descending: 'Descending', filters: 'Filters',
    status: 'Status', all: 'All', unplayed: 'Unplayed', anyGenre: 'Any genre', libraryEmpty: 'Nothing matches these filters', libraryEmptyHint: 'Try another genre or clear a filter.', showMore: 'Show more', findingEvening: 'Finding your evening…', homeFailed: 'Your library couldn\'t be reached. Check your server connection.', closeTitle: 'Close title', titleDetails: 'Title details', opening: 'Opening title…', quiet: 'Something went quiet', titleFailed: 'This title couldn\'t be opened. It may no longer be available.',
  } },
  keyframes: {
    drawerIn: { '0%': { translate: '-100% 0px' } },
    drawerOut: { '100%': { translate: '-100% 0px' } },
    popIn: { '0%': { opacity: 0, scale: 0.96 } },
  },
  motion: {
    fadeIn: { keyframes: 'dissolve', duration: 260, easing: 'ease-out', fill: 'both' },
    statusIn: { keyframes: 'dissolve', duration: 300, delay: 200, easing: 'ease-out', fill: 'both' },
    spin: { keyframes: 'spin', duration: 900, easing: 'linear', iterations: 'infinite', fill: 'none' },
    menuIn: { keyframes: 'doc:popIn', duration: 200, easing: 'ease-out', fill: 'both', still: { keyframes: 'dissolve', duration: 160 } },
    menuOut: { keyframes: 'vanish', duration: 140, easing: 'ease-in', fill: 'both', still: { keyframes: 'vanish', duration: 100 } },
    scrimIn: { keyframes: 'dissolve', duration: 220, easing: 'ease-out', fill: 'both' },
    scrimOut: { keyframes: 'vanish', duration: 200, easing: 'ease-in', fill: 'both', still: { keyframes: 'vanish', duration: 100 } },
    drawerIn: { keyframes: 'doc:drawerIn', duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both', still: { keyframes: 'dissolve', duration: 160 } },
    drawerOut: { keyframes: 'doc:drawerOut', duration: 200, easing: 'ease-in', fill: 'both', still: { keyframes: 'vanish', duration: 100 } },
  },
  templates: { poster: card(false), wide: card(true), gridPoster: card(false, { style: '100%', small: '100%' }), upNext: card(true, { style: wideW.style, small: '58vw' }) },
  status: true,
  traits: { barMask: false, panSections: true },
  slots: { shell, home },
  routes: { title, library },
  detail: { wide: 'fullscreen', small: 'fullscreen', frame: { flat: true } },
} satisfies SkinDocument;

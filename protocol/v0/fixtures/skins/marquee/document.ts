// Marquee, as a skin document (protocol/v0/skin.ts): a charcoal media-server look with
// amber accents. A left sidebar of Home and the libraries (an icon rail on narrower
// screens, a drawer on phones), a top bar with the wordmark, a centred search and the
// account menu; a featured banner over hubs of posters; flat title pages with the
// poster beside the facts. Every value here follows the compiled original it replaces.
import type { Condition, Node, SkinDocument, Style } from '../../../skin';

const id = 'marquee', version = '1.0.0';
const asset = (file: string) => `/vela/v0/appearance/skins/${id}/${version}/${file}`;

const sans = '"Open Sans", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", sans-serif';
const ease = 'cubic-bezier(0.2, 0, 0, 1)';
// The top bar: 56 px, 52 on phones. Page gutters: 40 px, 14 on phones.
const bar = { normal: 56, small: 52 };
const gutter: Style = { 'padding-left': '40px', 'padding-right': '40px' };
const gutterSmall: Style = { 'padding-left': '14px', 'padding-right': '14px' };
const fill: Style = { position: 'absolute', inset: '0px' };
const px = (n: number) => `${n}px`;
const when = (...c: Condition[]) => c;
const is = (test: string, value: string): Condition => ({ test, is: 'eq', value });
const isnt = (test: string, value: string): Condition => ({ test, is: 'ne', value });
const set = (test: string): Condition => ({ test });
const unset = (test: string): Condition => ({ test, not: true });

// Icons: a platform symbol where one fits, else Marquee's own one-colour line glyph (path
// data in a 24-unit box, even-odd), painted in the current colour like a symbol.
const builtIn: Record<string, string> = { home: 'home', search: 'search', menu: 'menu', close: 'close', check: 'checkmark', info: 'info', signout: 'sign-out', alert: 'alert', live: 'radio', play: 'play-fill', heart: 'heart', sort: 'sort', filter: 'filter', sliders: 'adjust', volume: 'speaker', mute: 'speaker-mute', phone: 'smartphone', star: 'star', rows: 'list', person: 'person', back: 'back', pause: 'pause-fill' };
const glyphs: Record<string, string[]> = {
  'down': ['M4.6 8.6 6 7.2l6 6 6-6 1.4 1.4L12 16z'],
  'expand': ['M3 3h7v2H5v5H3z M14 3h7v7h-2V5h-5z M21 14v7h-7v-2h5v-5z M10 21H3v-7h2v5h5z'],
  'film': ['M3 4h18v16H3z M8 5.6h8v12.8H8z M4.5 6h2v2h-2z M4.5 11h2v2h-2z M4.5 16h2v2h-2z M17.5 6h2v2h-2z M17.5 11h2v2h-2z M17.5 16h2v2h-2z'],
  'grid': ['M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z'],
  'left': ['M15.4 4.6 16.8 6l-6 6 6 6-1.4 1.4L8 12z'],
  'pip': ['M2 4h20v16H2z M3.8 5.8h16.4v12.4H3.8z M11 11h7.2v5.2H11z'],
  'right': ['M8.6 4.6 7.2 6l6 6-6 6 1.4 1.4L16 12z'],
  'skip-back': ['M7.55 5.88A8.4 8.4 0 1 0 16.82 6.12L15.79 7.59A6.6 6.6 0 1 1 8.50 7.40ZM12.00 2.50L8.60 5.50L12.00 8.50Z M8.2 10.2h1.6v5.8H8.2z M11.4 10.2h1.5v5.8h-1.5z M14.4 10.2h1.5v5.8h-1.5z M12.9 10.2h1.5v1.4h-1.5z M12.9 14.6h1.5v1.4h-1.5z'],
  'skip-forward': ['M16.45 5.88A8.4 8.4 0 1 1 7.18 6.12L8.21 7.59A6.6 6.6 0 1 0 15.50 7.40Z M12.00 2.50L15.40 5.50L12.00 8.50Z M8.2 10.2h1.6v5.8H8.2z M11.4 10.2h1.5v5.8h-1.5z M14.4 10.2h1.5v5.8h-1.5z M12.9 10.2h1.5v1.4h-1.5z M12.9 14.6h1.5v1.4h-1.5z'],
  'stack': ['M3.5 9h17v11.5h-17z M5.3 10.8h13.4v7.9H5.3z M6 5.8h12v1.7H6z M8.5 2.8h7v1.7h-7z'],
  'tv': ['M2.5 6.5h19v13h-19z M4.3 8.3h15.4v9.4H4.3z M7.3 3.3l1.2-1.2 4.1 4.1-1.2 1.2z M16.7 3.3l-1.2-1.2-4.1 4.1 1.2 1.2z M8 20.5h8v1.6H8z'],
  'up': ['M4.6 15.4 6 16.8l6-6 6 6 1.4-1.4L12 8z'],

};
const glyph = (name: string, size: number, extra: Partial<Node> = {}): Node => ({ type: 'icon', ...(builtIn[name] ? { symbol: builtIn[name] } : { paths: glyphs[name], viewBox: '0 0 24 24', fillRule: 'evenodd' }), ...extra, style: { width: px(size), height: px(size), 'flex-shrink': '0', ...(extra.style ?? {}) } } as Node);

// The Vela lockup for dark grounds, 2.629:1.
const wordmark = (h: number): Node => ({ type: 'image', src: 'assets/brand/vela-lockup.svg', alt: '', style: { width: `${h * 2.629}px`, height: px(h), 'flex-shrink': '0' } });

// Controls. Hover and press feedback is quick and flat.
const quick = 'background-color 120ms linear, color 120ms linear';
const ring = (c: string) => `0px 0px 0px 2px ${c}`;
const round = (size: number): Pick<Node, 'style' | 'hover' | 'focus'> => ({
  style: { position: 'relative', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', width: px(size), height: px(size), 'border-radius': '999px', 'background-color': 'transparent', color: '$ink-dim', 'flex-shrink': '0', 'pointer-events': 'auto' },
  hover: { 'background-color': '$hover', color: '$ink' }, focus: { 'box-shadow': ring('$amber'), color: '$ink' } });
const primary = (h: number, pad: string): Pick<Node, 'style' | 'hover' | 'focus'> => ({
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '8px', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', height: px(h), padding: pad, 'border-radius': '6px', 'background-color': '$amber', color: '$on-amber', 'font-weight': '700' },
  hover: { 'background-color': '$amber-hover' }, focus: { 'box-shadow': '0px 0px 0px 2px $page, 0px 0px 0px 4px $ink' } });
const secondary = (h: number, pad: string): Pick<Node, 'style' | 'hover' | 'focus'> => ({
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '8px', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', height: px(h), padding: pad, 'border-radius': '6px', 'background-color': '$control', color: '$ink', 'font-weight': '600' },
  hover: { 'background-color': '$control-hover' }, focus: { 'box-shadow': ring('$amber') } });
const avatar = (size: number, font: number): Node => ({ type: 'text', text: '{env.viewerInitial}', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: px(size), height: px(size), 'border-radius': px(size / 2), 'font-size': px(font), 'font-weight': '700', color: '$on-amber', 'background-color': '$amber' } });
const label: Style = { 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.06em', 'text-transform': 'uppercase', color: '$ink-faint' };
const oneLine: Style = { 'white-space': 'nowrap', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'text-overflow': 'ellipsis' };

// ---------------------------------------------------------------- shell
// The sidebar shows full labels from 1100 px and an icon rail below; the menu button flips
// that (`keep-flip`, kept across pages). One element per part, so widths animate.
const flip = set('flag:keep-flip'), narrow: Condition = { test: 'env.width', is: 'lt', value: '1100' }, wideEnough: Condition = { ...narrow, not: true };
type State = { when: Condition[]; style: Style; hover?: Style };
/** The rail's states over `full` (the node's style): slim below 1100 px, the other way round when flipped. */
const rail = (full: Style, slim: Style, extra: Condition[] = [], hover?: Style): State[] => [
  { when: [...extra, flip, narrow], style: full, hover }, { when: [...extra, flip], style: slim, hover }, { when: [...extra, narrow], style: slim, hover },
  ...(extra.length ? [{ when: extra, style: full, hover }] : []),
];
const notSmall = unset('env.small');
const railLayout = '200ms ease-out';

const navRow = (full: boolean, name: string, icon: Node, on: Condition, press: { action: 'home' | 'live' | 'library'; arg?: string }, extraWhen: Condition[] = [], testId = `nav-${name}`): Node => {
  const row = (lit: boolean, slim: boolean): Style => ({ position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '14px', 'align-items': 'center', 'box-sizing': 'border-box', width: '100%', height: '44px', 'border-radius': '6px',
    'justify-content': slim ? 'center' : 'flex-start', padding: slim ? '0px' : '0px 12px', 'background-color': lit ? '$selected' : 'transparent', color: lit ? '$ink' : '$ink-dim', transition: quick });
  const text = (lit: boolean): Style => ({ display: 'block', 'font-size': '15px', 'font-weight': lit ? '700' : '600', ...oneLine, 'min-width': '0px' });
  const litHover: Style = { 'background-color': '$selected', color: '$ink' };
  return { type: 'box', press, label: name, testId, when: extraWhen, style: row(false, false), hover: { 'background-color': '$hover', color: '$ink' }, focus: { 'box-shadow': 'inset 0px 0px 0px 2px $amber' },
    states: full ? [{ when: [on], style: row(true, false), hover: litHover }] : [...rail(row(true, false), row(true, true), [on], litHover), ...rail(row(false, false), row(false, true))],
    a11y: { current: [on], ...(full ? {} : { title: name }) },
    children: [
      { ...icon, states: [{ when: [on], style: { color: '$amber' } }] } as Node,
      { type: 'text', text: name, style: text(false), states: full ? [{ when: [on], style: text(true) }] : [...rail(text(true), { display: 'none' }, [on]), ...rail(text(false), { display: 'none' })] } as Node,
    ] } as Node;
};
// One library: a live library opens the guide (when the server offers live), others their page.
const library = (full: boolean): Node[] => [
  navRow(full, '{dest.name}', glyph('live', 22), is('env.section', 'live'), { action: 'live' }, [is('dest.kind', 'live'), set('env.canLive')], 'nav-{dest.name}'),
  navRow(full, '{dest.name}', glyph('film', 22), set('dest.on'), { action: 'library', arg: '{dest.id}' }, [is('dest.kind', 'movies')], 'nav-{dest.name}'),
  navRow(full, '{dest.name}', glyph('tv', 22), set('dest.on'), { action: 'library', arg: '{dest.id}' }, [is('dest.kind', 'shows')], 'nav-{dest.name}'),
  navRow(full, '{dest.name}', glyph('stack', 22), set('dest.on'), { action: 'library', arg: '{dest.id}' }, [isnt('dest.kind', 'movies'), isnt('dest.kind', 'shows'), isnt('dest.kind', 'live')], 'nav-{dest.name}'),
];
// Home, then the server's libraries in order, then Live when the server offers it without a live library.
const destinations = (full: boolean, extra: Style = {}): Node => {
  const pad = (slim: boolean): Style => ({ display: 'flex', 'flex-direction': 'column', gap: '2px', padding: slim ? '10px 8px' : '10px 10px', ...extra });
  const heading: Style = { display: 'block', ...label, padding: '18px 12px 8px', 'white-space': 'nowrap' };
  const divider: Style = { display: 'flex', height: '1px', margin: '10px 8px', 'background-color': '$line' };
  return { type: 'box', testId: 'marquee-sidebar', style: pad(false), states: full ? [] : rail(pad(false), pad(true)), children: [
    navRow(full, '{s:home}', glyph('home', 22), is('env.section', 'home'), { action: 'home' }, [], 'nav-Home'),
    { type: 'text', text: '{s:libraries}', when: [{ test: 'env.libraryCount', is: 'gt', value: '0' }], style: heading, states: full ? [] : rail(heading, { display: 'none' }) } as Node,
    { type: 'box', when: [{ test: 'env.libraryCount', is: 'gt', value: '0' }], style: { display: 'none' }, states: full ? [] : rail({ display: 'none' }, divider) } as Node,
    { type: 'repeat', over: 'nav.destinations', item: { type: 'box', style: { display: 'flex', 'flex-direction': 'column' }, children: library(full) } },
    navRow(full, '{s:live}', glyph('live', 22), is('env.section', 'live'), { action: 'live' }, [set('env.canLive'), unset('env.hasLiveLibrary')]),
  ] } as Node;
};
const sidebarStyle = (w: number): Style => ({ width: px(w), 'flex-shrink': '0', 'box-sizing': 'border-box', 'padding-top': px(bar.normal), 'background-color': '$chrome', 'overflow-x': 'hidden', 'overflow-y': 'auto', 'scrollbar-width': 'none' });
const sidebar: Node = { type: 'box', role: 'navigation', label: '{s:mainNavigation}', when: [set('env.viewer')], style: sidebarStyle(232), states: rail(sidebarStyle(232), sidebarStyle(72), [notSmall]),
  layoutTransition: railLayout, small: { display: 'none' }, children: [destinations(false)] } as Node;

// The bar's left end: the menu button and the wordmark, as wide as the rail (at least 200).
// The menu button says whether the rail is expanded: open when flipped on a narrow screen or unflipped on a wide one.
const never: Condition[] = [flip, unset('flag:keep-flip')];
const railButton = (cond: Condition[], expanded: boolean): Node => ({ type: 'box', when: [notSmall, ...cond], press: { action: 'toggle', arg: 'keep-flip' }, label: '{s:toggleSidebar}', testId: 'marquee-menu', id: 'marquee-menu-button',
  ...round(44), a11y: { expanded: expanded ? cond : never }, children: [glyph('menu', 22)] } as Node);
const barStartStyle = (w: number): Style => ({ display: 'flex', 'flex-direction': 'row', width: px(w), 'flex-shrink': '0', 'box-sizing': 'border-box', 'padding-left': '12px', gap: '10px', 'align-items': 'center', 'pointer-events': 'auto' });
const barStart: Node = { type: 'box', style: barStartStyle(232), states: rail(barStartStyle(232), barStartStyle(200), [notSmall]), layoutTransition: railLayout,
  small: { width: 'auto', 'padding-left': '4px', gap: '4px' }, children: [
    railButton([flip, narrow], true), railButton([flip, wideEnough], false), railButton([unset('flag:keep-flip'), narrow], false), railButton([unset('flag:keep-flip'), wideEnough], true),
    { type: 'box', when: [set('env.small')], press: { action: 'toggle', arg: 'drawer' }, label: '{s:openNavigation}', testId: 'marquee-menu', id: 'marquee-drawer-button', ...round(44), a11y: { expanded: [set('flag:drawer')] }, children: [glyph('menu', 22)] } as Node,
    { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', style: { position: 'relative', display: 'flex', 'align-items': 'center', padding: '6px 4px', 'border-radius': '4px' }, children: [wordmark(28)] },
  ] } as Node;

const glassBar: Style = { 'background-color': '$chrome-glass', 'backdrop-filter': 'blur(18px)' };
const topBar: Node = { type: 'box', when: [set('env.viewer')], style: { position: 'absolute', top: '0px', left: '0px', right: '0px', height: px(bar.normal), 'z-index': '20', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'box-sizing': 'border-box', 'padding-right': '14px', gap: '12px', 'pointer-events': 'none', ...glassBar },
  // Over a wide home the bar is clear: the page draws its middle, around the live search field.
  states: [{ when: [is('env.section', 'home'), notSmall], style: { 'background-color': '$scrim-clear', 'backdrop-filter': 'none' } }],
  small: { height: px(bar.small), 'padding-right': '6px', gap: '2px' }, children: [
    barStart,
    { type: 'box', style: { display: 'none' }, small: { display: 'flex', flex: '1' } },
    { type: 'box', press: { action: 'search', focus: 'vela-search' }, label: '{s:search}', ...round(44), style: { ...round(44).style, display: 'none' }, small: { display: 'flex' }, children: [glyph('search', 22)] },
    { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', flex: '1', 'min-width': '0px', 'justify-content': 'center' }, small: { display: 'none' }, children: [
      { type: 'box', when: [isnt('env.section', 'home')], press: { action: 'search', focus: 'vela-search' }, label: '{s:searchYourLibrary}', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', width: 'min(560px, 100%)', 'box-sizing': 'border-box', height: '38px', padding: '0px 14px', 'border-radius': '6px', 'background-color': '$field', color: '$ink-faint', cursor: 'text', 'pointer-events': 'auto' },
        hover: { 'background-color': '$field-focus' }, focus: { 'box-shadow': ring('$amber') }, children: [glyph('search', 18), { type: 'text', text: '{s:search}', style: { 'font-size': '15px' } }] },
    ] },
    { type: 'box', press: { action: 'toggle', arg: 'menu' }, label: '{s:profile}', testId: 'profile-menu', id: 'marquee-account', ...round(44), a11y: { expanded: [set('flag:menu')], controls: 'marquee-account-menu' }, children: [avatar(32, 14)] } as Node,
  ] };

const menuRow = (text: string, icon: Node, press: { action: 'openPicker' | 'signOut' }, extra: Partial<Node> = {}): Node => ({ type: 'box', press, label: text, ...extra,
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center', 'box-sizing': 'border-box', width: '100%', height: '42px', padding: '0px 16px', color: '$ink' },
  hover: { 'background-color': '$hover' }, focus: { 'box-shadow': 'inset 0px 0px 0px 2px $amber' }, children: [icon, { type: 'text', text, style: { 'font-size': '14px' } }] } as Node);
const divider: Node = { type: 'box', style: { height: '1px', 'background-color': '$line' } };
const accountMenu: Node = { type: 'box', when: [set('env.viewer'), set('flag:menu')], id: 'marquee-account-menu', motion: 'drop', exit: 'gone100', escape: 'menu', returnFocus: 'marquee-account',
  style: { position: 'absolute', top: px(bar.normal - 4), right: '14px', 'z-index': '30', width: '260px', 'box-sizing': 'border-box', padding: '8px 0px', 'border-radius': '6px', 'background-color': '$menu', 'box-shadow': '0px 12px 40px $shadow, 0px 0px 0px 1px $line' },
  small: { top: px(bar.small - 4), right: '8px' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center', padding: '10px 16px 14px' }, children: [
      avatar(36, 16),
      { type: 'text', text: '{env.viewer}', style: { 'font-size': '15px', 'font-weight': '700', flex: '1', 'min-width': '0px', 'line-clamp': '1' } },
    ] },
    divider,
    menuRow('{s:changeAppearance}', glyph('grid', 18), { action: 'openPicker' }, { testId: 'skin-picker', when: [{ test: 'env.skinCount', is: 'gt', value: '1' }], a11y: { haspopup: 'dialog' } } as Partial<Node>),
    { type: 'box', style: { padding: '0px 16px' }, children: [
      { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
      { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
    ] },
    divider,
    menuRow('{s:signOut}', glyph('signout', 18), { action: 'signOut' }),
  ] } as Node;

// Phones: the sidebar is a drawer behind the menu button.
const drawerOpen = [set('env.viewer'), set('env.small'), set('flag:drawer')];
const drawer: Node[] = [
  { type: 'box', when: drawerOpen, press: { action: 'close', arg: 'drawer', focus: 'marquee-drawer-button' }, label: '{s:closeNavigation}', motion: 'fade', exit: 'gone120', style: { ...fill, 'z-index': '40', 'background-color': '$scrim' } } as Node,
  { type: 'box', when: drawerOpen, role: 'navigation', label: '{s:mainNavigation}', motion: 'slide', exit: 'gone120', escape: 'drawer', returnFocus: 'marquee-drawer-button',
    style: { position: 'absolute', top: '0px', left: '0px', bottom: '0px', 'z-index': '41', width: 'min(300px, 84vw)', 'box-sizing': 'border-box', display: 'flex', 'flex-direction': 'column', 'background-color': '$chrome', 'box-shadow': '12px 0px 40px $shadow' }, children: [
      { type: 'box', style: { display: 'flex', 'flex-direction': 'row', height: px(bar.small), 'align-items': 'center', gap: '4px', 'padding-left': '4px', 'padding-right': '4px', 'flex-shrink': '0' }, children: [
        { type: 'box', press: { action: 'close', arg: 'drawer', focus: 'marquee-drawer-button' }, label: '{s:closeNavigation}', ...round(44), children: [glyph('close', 22)] },
        wordmark(28),
      ] },
      destinations(true, { flex: '1', 'min-height': '0px', 'overflow-y': 'auto' }),
    ] } as Node,
];

const shell: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', height: '100%', 'min-height': '0px', 'background-color': '$page', color: '$ink', 'color-scheme': 'dark', 'font-family': sans }, children: [
  sidebar,
  { type: 'slot', slot: 'children', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', flex: '1', 'min-width': '0px', 'min-height': '0px' }, inner: { display: 'flex', 'flex-direction': 'column', 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' } },
  topBar,
  accountMenu,
  ...drawer,
] };

// ---------------------------------------------------------------- cards and hubs
const art = (src: string): Node => ({ type: 'image', src, alt: '', fade: true, style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover', transition: 'opacity 260ms linear' } });
const progress = (h: number, pct: string, show: Condition[]): Node => ({ type: 'box', when: show, style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: px(h), 'background-color': '$scrim' }, children: [
  { type: 'box', style: { height: px(h), width: `${pct}%`, 'background-color': '$amber' } },
] });
// Hover or focus: a faint scrim and an amber ring over the artwork.
const heat: Node[] = [
  { type: 'box', style: { ...fill, 'background-color': '$scrim-faint', opacity: '0', transition: 'opacity 120ms linear' }, groupHover: { opacity: '1' }, groupFocus: { opacity: '1' } } as Node,
  { type: 'box', style: { ...fill, 'border-radius': '4px', 'box-shadow': 'inset 0px 0px 0px 3px $amber', opacity: '0', transition: 'opacity 120ms linear' }, groupHover: { opacity: '1' }, groupFocus: { opacity: '1' } } as Node,
];
// An unwatched film or episode carries an amber corner.
const corner = (size: number, sizeSmall = size): Node => ({ type: 'box', when: [set('card.unwatched')],
  style: { position: 'absolute', top: '0px', right: '0px', width: px(size), height: px(size), 'background-image': 'linear-gradient(225deg, $amber 50%, transparent 50%)' }, small: { width: px(sizeSmall), height: px(sizeSmall) } });
// Artwork is absent: the kind's icon and the title on a quiet panel.
const placeholder: Node = { type: 'box', when: [unset('card.poster')], style: { ...fill, display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', gap: '10px', padding: '12px', 'box-sizing': 'border-box', 'background-image': 'linear-gradient(160deg, $raised 0%, $chrome 100%)', color: '$ink-faint' }, children: [
  glyph('film', 32, { when: [is('card.kind', 'movie')], small: { width: '26px', height: '26px' } }),
  glyph('live', 32, { when: [is('card.kind', 'channel')], small: { width: '26px', height: '26px' } }),
  glyph('stack', 32, { when: [is('card.kind', 'collection')], small: { width: '26px', height: '26px' } }),
  glyph('tv', 32, { when: [isnt('card.kind', 'movie'), isnt('card.kind', 'channel'), isnt('card.kind', 'collection')], small: { width: '26px', height: '26px' } }),
  { type: 'text', text: '{card.name}', style: { 'font-size': '13px', 'font-weight': '600', color: '$ink-dim', 'text-align': 'center', 'line-clamp': '3' }, small: { 'font-size': '12px' } },
] };
// The line under a card: S·E for a numbered episode, else the year.
const episodeNumbered = [is('card.kind', 'episode'), { test: 'card.episodeNumber', is: 'gt', value: '0' } as Condition];
const subLine = (style: Style, small: Style, suffix = ''): Node[] => [
  { type: 'text', when: [...episodeNumbered, { test: 'card.seasonNumber', is: 'gt', value: '0' }], text: `{s:seasonEpisode}${suffix}`, style, small },
  { type: 'text', when: [...episodeNumbered, { test: 'card.seasonNumber', is: 'gt', value: '0', not: true }], text: `{s:episodeNumber}${suffix}`, style, small },
  { type: 'text', when: [{ test: 'card.kind', is: 'ne', value: 'episode' }, set('card.yearLabel')], text: `{card.yearLabel}${suffix}`, style, small },
  { type: 'text', when: [is('card.kind', 'episode'), { test: 'card.episodeNumber', is: 'gt', value: '0', not: true }, set('card.yearLabel')], text: `{card.yearLabel}${suffix}`, style, small },
];
const caption: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px', 'padding-top': '8px', width: '100%', 'min-width': '0px' }, children: [
  { type: 'text', text: '{card.name}', style: { 'font-size': '14px', 'font-weight': '600', color: '$ink', ...oneLine, transition: 'color 120ms linear' }, small: { 'font-size': '13px' }, groupHover: { color: '$amber' }, groupFocus: { color: '$amber' } } as Node,
  ...subLine({ 'font-size': '13px', color: '$ink-faint', 'font-variant-numeric': 'tabular-nums', ...oneLine }, { 'font-size': '12px' }),
] };
const cardShell = (w: number, wSmall: number, ratio: string, artwork: Node[]): Node => ({ type: 'box', group: true, press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'align-items': 'stretch', 'flex-shrink': '0', 'box-sizing': 'border-box', width: px(w), 'border-radius': '4px', color: '$ink' }, small: { width: px(wSmall) }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': ratio, 'border-radius': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised', 'box-shadow': '0px 4px 12px $scrim-faint' }, children: [
      ...artwork,
      progress(4, '{card.progressPct}', [set('card.hasProgress')]),
      ...heat,
    ] },
    caption,
  ] });
const card = cardShell(152, 112, '2 / 3', [
  { ...art('{card.poster}'), when: [set('card.poster')] }, placeholder, corner(22, 18),
]);
// A landscape still, for hubs of part-watched titles.
const wideCard = cardShell(300, 224, '16 / 9', [
  { ...art('{card.backdrop}'), when: [set('card.backdrop')] },
  { type: 'image', when: [unset('card.backdrop'), set('card.poster')], src: '{card.poster}', alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover', filter: 'blur(18px) brightness(0.6)', scale: '1.2' } },
  { type: 'image', when: [unset('card.backdrop'), set('card.poster')], src: '{card.poster}', alt: '', style: { position: 'absolute', top: '8%', bottom: '8%', left: '50%', translate: '-50% 0px', height: '84%', 'aspect-ratio': '2 / 3', 'object-fit': 'cover', 'border-radius': '3px' } },
  { ...placeholder, when: [unset('card.backdrop'), unset('card.poster')] },
]);
// A ranked hub: the server's position as a large numeral the poster overlaps.
const rankedCard: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-end', 'flex-shrink': '0' }, children: [
  { type: 'text', text: '{index.label}', style: { 'font-size': '150px', 'font-weight': '800', 'line-height': '0.8', 'letter-spacing': '-0.08em', color: '$raised', 'margin-right': '-22px', 'padding-bottom': '40px' }, small: { 'font-size': '96px', 'margin-right': '-14px', 'padding-bottom': '34px' } },
  { type: 'use', template: 'card' },
] };

// A hub: its heading over a shelf of cards in server order.
const row: Node = { type: 'box', role: 'group', label: '{row.name}', style: { display: 'flex', 'flex-direction': 'column', gap: '8px', 'padding-bottom': '30px' }, small: { gap: '6px', 'padding-bottom': '20px' }, children: [
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '8px', 'min-height': '32px', 'padding-left': '40px', 'padding-right': '28px' }, small: gutterSmall, children: [
    { type: 'text', text: '{row.name}', role: 'heading', level: 2, style: { 'font-size': '19px', 'font-weight': '700', color: '$ink', flex: '1', 'min-width': '0px', ...oneLine }, small: { 'font-size': '17px' } },
  ] },
  // A shelf scrolls sideways: it takes its width from the page, never from its cards.
  { type: 'box', style: { display: 'flex', width: '0px', 'min-width': '100%', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '16px', 'align-items': 'flex-start', 'padding-top': '4px', 'padding-bottom': '4px', ...gutter }, small: { gap: '10px', ...gutterSmall }, children: [
      { type: 'repeat', over: 'row.items', when: [isnt('row.presentation', 'ranked'), unset('row.resume')], item: { type: 'use', template: 'card' } },
      { type: 'repeat', over: 'row.items', when: [isnt('row.presentation', 'ranked'), set('row.resume')], item: { type: 'use', template: 'wideCard' } },
      { type: 'repeat', over: 'row.items', when: [is('row.presentation', 'ranked')], item: { type: 'use', template: 'rankedCard' } },
    ] },
  ] },
] };

// ---------------------------------------------------------------- home
const heroCopy: Node = { type: 'box', style: { position: 'absolute', left: '0px', bottom: '0px', 'box-sizing': 'border-box', width: 'min(620px, 62%)', padding: '0px 36px 32px', display: 'flex', 'flex-direction': 'column', gap: '10px' },
  small: { position: 'relative', width: '100%', padding: '0px 16px 16px', gap: '8px' }, children: [
    { type: 'text', when: [set('heroAct.reasonLabel')], text: '{heroAct.reasonLabel}', style: { 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.08em', 'text-transform': 'uppercase', color: '$amber' } },
    { type: 'text', when: [unset('heroAct.reasonLabel')], text: '{s:featured}', style: { 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.08em', 'text-transform': 'uppercase', color: '$amber' } },
    { type: 'text', text: '{hero.name}', role: 'heading', level: 2, style: { 'font-size': '34px', 'font-weight': '700', 'line-height': '1.1', 'letter-spacing': '-0.01em', 'line-clamp': '2' }, small: { 'font-size': '22px' } },
    { type: 'text', text: '{hero.metaLine}', style: { 'font-size': '14px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' }, small: { 'font-size': '13px' } },
    { type: 'text', when: [set('hero.summary')], text: '{hero.summary}', style: { 'font-size': '15px', color: '$ink', 'line-height': '1.5', 'line-clamp': '2', 'text-shadow': '0px 1px 8px $shadow' }, small: { display: 'none' } },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', 'margin-top': '8px', 'flex-wrap': 'wrap' }, small: { 'margin-top': '4px' }, children: [
      // The server's predicted action (play, resume, next episode) in amber, then More info.
      { type: 'box', when: [set('heroAct.playable')], press: { action: 'play', arg: '{hero.id}' }, label: '{heroAct.actionLabel}', testId: 'hero-primary', ...primary(40, '0px 20px'), small: { height: '38px' }, children: [
        glyph('play', 16), { type: 'text', text: '{heroAct.actionLabel}', style: { 'font-size': '15px' } },
        { type: 'text', when: [set('heroAct.actionDetail')], text: '{heroAct.actionDetail}', style: { 'font-size': '13px', 'font-weight': '600', opacity: '0.7' }, small: { display: 'none' } },
      ] },
      { type: 'box', when: [set('heroAct.playable')], press: { action: 'select', arg: '{hero.kindId}' }, label: '{hero.label}', ...secondary(40, '0px 18px'), small: { height: '38px' }, children: [glyph('info', 18), { type: 'text', text: '{s:moreInfo}', style: { 'font-size': '15px' } }] },
      { type: 'box', when: [unset('heroAct.playable')], press: { action: 'select', arg: '{hero.kindId}' }, label: '{hero.label}', ...primary(40, '0px 20px'), small: { height: '38px' }, children: [glyph('info', 18), { type: 'text', text: '{s:moreInfo}', style: { 'font-size': '15px' } }] },
    ] },
  ] };
const dot: Node = { type: 'box', press: { action: 'pickHero', arg: '{index}' }, label: '{s:featuredNumber}', a11y: { current: [set('index.current')] }, layoutTransition: '200ms ease-out',
  style: { position: 'relative', width: '8px', height: '8px', 'border-radius': '4px', 'background-color': '$track' }, states: [{ when: [set('index.current')], style: { position: 'relative', width: '22px', height: '8px', 'border-radius': '4px', 'background-color': '$amber' } }], focus: { 'box-shadow': ring('$ink') } } as Node;
const spotlight: Node = { type: 'repeat', over: 'home.hero', when: [unset('env.searching')], item: { type: 'box', motion: 'arrive',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'margin-left': '40px', 'margin-right': '40px', 'margin-bottom': '30px', height: 'clamp(280px, 30vw, 380px)', 'min-height': '280px', 'border-radius': '6px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised' },
  small: { 'margin-left': '14px', 'margin-right': '14px', 'margin-bottom': '20px', height: 'auto', 'min-height': '0px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
    { type: 'box', style: { display: 'none' }, small: { position: 'relative', display: 'flex', width: '100%', 'aspect-ratio': '16 / 9' }, children: [
      { ...art('{hero.backdrop}'), when: [set('hero.backdrop')] },
      { type: 'box', style: { ...fill, 'background-image': 'linear-gradient(0deg, $raised 0%, $scrim-clear 55%)' } },
    ] },
    { ...art('{hero.backdrop}'), when: [set('hero.backdrop')], small: { display: 'none' } },
    { type: 'box', style: { ...fill, 'background-image': 'linear-gradient(90deg, $scrim 0%, $scrim 30%, $scrim-soft 55%, $scrim-clear 78%), linear-gradient(0deg, $scrim 0%, $scrim-clear 55%)' }, small: { display: 'none' } },
    heroCopy,
    { type: 'box', role: 'group', label: '{s:featuredTitles}', when: [{ test: 'env.heroCount', is: 'gt', value: '1' }], style: { position: 'absolute', right: '24px', bottom: '24px', display: 'flex', 'flex-direction': 'row', gap: '6px' }, small: { right: '14px', top: '12px', bottom: 'auto' }, children: [
      { type: 'repeat', over: 'home.heroes', item: dot },
    ] },
  ] } };

const empty = (icon: string, title: string, message: string, extra: Partial<Node> = {}): Node => ({ type: 'box', role: 'status', ...extra, style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'text-align': 'center', gap: '10px', padding: '64px 24px' }, children: [
  glyph(icon, 44, { style: { color: '$ink-faint', 'margin-bottom': '6px' } }),
  { type: 'text', text: title, style: { 'font-size': '20px', 'font-weight': '700' } },
  { type: 'text', text: message, style: { 'font-size': '15px', color: '$ink-dim', 'line-height': '1.5', 'max-width': '30rem' } },
] } as Node);

const home: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column' }, children: [
  // Phones: the field sits under the bar. Wide: a sticky strip at the top of the page, in the bar's colour.
  { type: 'slot', slot: 'searchField', style: { position: 'sticky', top: '0px', 'z-index': '16', 'flex-shrink': '0', height: px(bar.normal), 'box-sizing': 'border-box', padding: '0px 76px 0px 24px', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$chrome-glass', 'backdrop-filter': 'blur(18px)' } as Style,
    small: { position: 'relative', top: 'auto', height: 'auto', 'margin-top': px(bar.small), padding: '10px 14px 16px', 'background-color': 'transparent', 'backdrop-filter': 'none' } as Style, inner: { width: '100%', 'max-width': '560px' } },
  { type: 'box', style: { display: 'flex', 'flex-direction': 'column', 'padding-top': '24px', 'padding-bottom': '48px' }, small: { 'padding-top': '0px' }, states: [{ when: [set('env.searching')], style: { display: 'flex', 'flex-direction': 'column', 'padding-top': '0px', 'padding-bottom': '0px' } }], children: [
    spotlight,
    { type: 'repeat', over: 'home.rows', when: [unset('env.searching')], item: { type: 'box', motion: 'arrive', stagger: { step: 40, cap: 5 }, children: [{ type: 'use', template: 'row' }] } },
    empty('stack', '{s:nothingHereYet}', '{s:noRowsYet}', { when: [unset('env.searching'), is('env.rowCount', '0'), is('env.heroCount', '0')] }),
  ] },
] };

// ---------------------------------------------------------------- title page
const heading2: Style = { 'font-size': '19px', 'font-weight': '700', ...gutter };
const heading2Small: Style = { 'font-size': '17px', ...gutterSmall };
const section = (show: Condition[], title: string, body: Node, pad = { normal: '30px', small: '20px' }): Node => ({ type: 'box', when: show, style: { display: 'flex', 'flex-direction': 'column', gap: '14px', 'padding-bottom': pad.normal }, small: { gap: '10px', 'padding-bottom': pad.small }, children: [
  { type: 'text', text: title, role: 'heading', level: 2, style: heading2, small: heading2Small }, body,
] });
const shelf = (gap: number, gapSmall: number, item: Node, over: string, track: Partial<Node> = {}, top = '0px'): Node => ({ type: 'box', style: { display: 'flex', width: '0px', 'min-width': '100%', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
  { type: 'box', ...track, style: { display: 'flex', 'flex-direction': 'row', gap: px(gap), ...gutter, 'padding-top': top, 'padding-bottom': '4px' }, small: { gap: px(gapSmall), ...gutterSmall }, children: [{ type: 'repeat', over, item }] } as Node,
] });

const poster: Node = { type: 'box', style: { position: 'relative', width: 'clamp(220px, 21vw, 300px)', 'flex-shrink': '0', 'aspect-ratio': '2 / 3', 'border-radius': '6px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised', 'box-shadow': '0px 18px 50px $shadow' }, small: { width: '38%' }, children: [
  { ...art('{detail.poster}'), when: [set('detail.poster')] },
  { type: 'box', when: [unset('detail.poster')], style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '$ink-faint' }, children: [
    glyph('film', 40, { when: [is('detail.kind', 'movie')] }), glyph('tv', 40, { when: [isnt('detail.kind', 'movie')] }),
  ] },
  { type: 'box', when: [set('detail.hasProgress')], style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '5px', 'background-color': '$scrim' }, children: [
    { type: 'box', style: { height: '5px', width: '{detail.progressPct}%', 'background-color': '$amber' } },
  ] },
] };
const bigButton = (extra: Partial<Node>, children: Node[]): Node => ({ type: 'box', testId: 'detail-play', ...primary(48, '0px 26px'), style: { ...primary(48, '0px 26px').style, gap: '10px' }, small: { height: '46px', 'flex-grow': '1' }, ...extra, children } as Node);
const playText = (text: string, when: Condition[] = []): Node => ({ type: 'text', when, text, style: { 'font-size': '16px' } });
// A playable title: Play, or Resume from where it was left.
const playButton = bigButton({ when: [set('detail.canPlay')], press: { action: 'play', arg: '{detail.id}' }, label: '{detail.playLabel}' }, [
  glyph('play', 18), playText('{s:resumeFrom}', [set('detail.hasResume')]), playText('{s:play}', [unset('detail.hasResume')]),
]);
// A show or season: the first episode not yet watched, by its number.
const upNextFor = (resumed: boolean): Node => bigButton({ when: [{ test: 'card.hasProgress', not: !resumed }], press: { action: 'play', arg: '{card.id}' }, label: resumed ? '{s:resumeTitle}' : '{s:playTitle}' }, [
  glyph('play', 18), ...subLine({ 'font-size': '16px' }, {}, '').map(n => ({ ...n, text: `{s:play} ${(n as { text: string }).text}` }) as Node),
  playText('{s:play}', [is('card.kind', 'episode'), { test: 'card.episodeNumber', is: 'gt', value: '0', not: true }, unset('card.yearLabel')]),
]);
const upNextButton: Node = { type: 'repeat', over: 'detail.upNext', when: [unset('detail.canPlay')], item: { type: 'box', style: { display: 'flex' }, small: { 'flex-grow': '1' }, children: [upNextFor(true), upNextFor(false)] } };
const trailerButton: Node = { type: 'repeat', over: 'detail.trailers', limit: 1, item: { type: 'box', press: { action: 'playExtra', arg: '{extra.id}' }, label: '{s:watchTrailer}', ...secondary(48, '0px 20px'), small: { height: '46px' }, children: [
  glyph('film', 18), { type: 'text', text: '{s:watchTrailer}', style: { 'font-size': '15px' } },
] } as Node };
// Rating and running time (wide), and whether it has been watched.
const factRow: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', 'flex-wrap': 'wrap' }, small: { display: 'none' }, states: [{ when: [set('detail.played')], style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', 'flex-wrap': 'wrap' } }], children: [
  { type: 'text', when: [set('detail.rating')], text: '{detail.rating}', style: { 'font-size': '12px', 'font-weight': '700', padding: '2px 6px', border: '1px solid $ink-faint', 'border-radius': '3px', color: '$ink-dim' }, small: { display: 'none' } },
  { type: 'text', when: [set('detail.durationLabel')], text: '{detail.durationLabel}', style: { 'font-size': '15px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' }, small: { display: 'none' } },
  { type: 'box', when: [set('detail.played')], style: { display: 'flex', 'flex-direction': 'row', gap: '6px', 'align-items': 'center', color: '$ink-dim' }, children: [glyph('check', 16), { type: 'text', text: '{s:watched}', style: { 'font-size': '14px' } }] },
] } as Node;
const facts: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '16px' }, small: { gap: '14px' }, children: [
  factRow,
  { type: 'box', role: 'list', label: '{s:genres}', when: [set('detail.genresLine')], style: { display: 'flex', 'flex-direction': 'row', gap: '8px', 'flex-wrap': 'wrap' }, children: [
    { type: 'repeat', over: 'detail.genres', item: { type: 'text', role: 'listitem', text: '{genre.text}', style: { 'font-size': '13px', 'font-weight': '600', padding: '5px 12px', 'border-radius': '999px', 'background-color': '$control', color: '$ink' } } },
  ] },
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', 'flex-wrap': 'wrap', 'margin-top': '4px' }, children: [playButton, upNextButton, trailerButton] },
  { type: 'box', when: [set('detail.hasResume')], role: 'progressbar', label: '{s:watchProgress}', style: { width: '280px', height: '4px', 'border-radius': '2px', 'background-color': '$track', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, small: { width: '100%' }, children: [
    { type: 'box', style: { height: '4px', width: '{detail.resumePct}%', 'background-color': '$amber' } },
  ] },
  { type: 'text', when: [set('detail.summary')], text: '{detail.summary}', style: { 'font-size': '16px', 'line-height': '1.6', color: '$ink', 'max-width': '52rem' }, small: { 'font-size': '15px' } },
  { type: 'box', when: [set('detail.hasMediaFacts')], style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'baseline', 'flex-wrap': 'wrap' }, children: [
    { type: 'text', text: '{s:media}', style: label },
    { type: 'repeat', over: 'detail.mediaFacts', item: { type: 'text', text: '{fact.text}', style: { 'font-size': '13px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' } } },
  ] },
] };
const kindLine: Style = { ...label, 'font-size': '13px', color: '$amber' };

const seasonCard: Node = { type: 'box', press: { action: 'select', arg: '{season.pick}' }, label: '{card.name}', testId: 'season-{card.id}', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'flex-shrink': '0', width: '140px', 'border-radius': '4px', color: '$ink' }, small: { width: '104px' },
  hover: { opacity: '0.9' }, focus: { 'box-shadow': ring('$amber') }, children: [
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '2 / 3', 'border-radius': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised' }, children: [
      { ...art('{card.poster}'), when: [set('card.poster')] },
      { type: 'box', when: [unset('card.poster')], style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '$ink-faint' }, children: [glyph('tv', 28)] },
      { type: 'box', when: [set('season.on')], style: { ...fill, 'border-radius': '4px', 'box-shadow': 'inset 0px 0px 0px 3px $amber' } },
      { type: 'box', when: [unset('season.on')], style: { ...fill, 'border-radius': '4px', 'box-shadow': 'inset 0px 0px 0px 1px $line' } },
    ] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px', 'padding-top': '8px' }, children: [
      { type: 'text', when: [set('season.on')], text: '{card.name}', style: { 'font-size': '14px', 'font-weight': '700', color: '$amber', ...oneLine }, small: { 'font-size': '13px' } },
      { type: 'text', when: [unset('season.on')], text: '{card.name}', style: { 'font-size': '14px', 'font-weight': '600', color: '$ink', ...oneLine }, small: { 'font-size': '13px' } },
      { type: 'text', when: [set('card.yearLabel')], text: '{card.yearLabel}', style: { 'font-size': '13px', color: '$ink-faint', 'font-variant-numeric': 'tabular-nums' } },
    ] },
  ] };

// An episode: its still plays it (hover or focus shows the amber play); its title opens it.
const still = (resumed: boolean): Node => ({ type: 'box', group: true, when: [{ test: 'card.hasProgress', not: !resumed }], press: { action: 'play', arg: '{card.id}' }, label: resumed ? '{s:resumeTitle}' : '{s:playTitle}', testId: 'episode-{card.id}',
  style: { position: 'relative', width: '100%', 'flex-shrink': '0', 'aspect-ratio': '16 / 9', 'border-radius': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised' }, small: { width: '148px' }, children: [
    { ...art('{card.backdrop}'), when: [set('card.backdrop')] },
    { type: 'box', when: [unset('card.backdrop')], style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '$ink-faint' }, children: [glyph('tv', 28)] },
    corner(20),
    progress(4, '{card.progressPct}', [set('card.hasProgress')]),
    { type: 'box', style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$scrim-soft', opacity: '0', transition: 'opacity 120ms linear' }, groupHover: { opacity: '1' }, groupFocus: { opacity: '1' }, children: [
      { type: 'box', style: { display: 'flex', width: '50px', height: '50px', 'border-radius': '999px', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$amber', color: '$on-amber', 'padding-left': '3px', 'box-sizing': 'border-box' }, small: { width: '38px', height: '38px' }, children: [
        glyph('play', 22, { small: { width: '18px', height: '18px' } }),
      ] },
    ] } as Node,
    { type: 'box', style: { ...fill, 'border-radius': '4px', 'box-shadow': 'inset 0px 0px 0px 3px $amber', opacity: '0' }, groupHover: { opacity: '1' }, groupFocus: { opacity: '1' } } as Node,
  ] } as Node);
// Number and running time: "S1 · E2 · 3 min".
const metaStyle: Style = { 'font-size': '13px', color: '$ink-faint', 'font-variant-numeric': 'tabular-nums' };
const noSubLine: Condition[][] = [[isnt('card.kind', 'episode'), unset('card.yearLabel')], [is('card.kind', 'episode'), { test: 'card.episodeNumber', is: 'gt', value: '0', not: true }, unset('card.yearLabel')]];
const episodeMeta: Node[] = [
  ...subLine(metaStyle, {}, ' · {card.durationLabel}').map(n => ({ ...n, when: [...(n.when ?? []), set('card.durationLabel')] }) as Node),
  ...subLine(metaStyle, {}).map(n => ({ ...n, when: [...(n.when ?? []), unset('card.durationLabel')] }) as Node),
  ...noSubLine.map((w): Node => ({ type: 'text', when: [...w, set('card.durationLabel')], text: '{card.durationLabel}', style: metaStyle })),
];
const episodeCard: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '10px', 'align-items': 'stretch' }, small: { 'flex-direction': 'row', gap: '12px', 'align-items': 'flex-start' }, children: [
  still(true), still(false),
  { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '3px', 'min-width': '0px', flex: '1' }, children: [
    { type: 'box', press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', style: { position: 'relative', color: '$ink' }, hover: { color: '$amber' }, focus: { 'box-shadow': ring('$amber') }, children: [
      { type: 'text', text: '{card.name}', style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '1' }, small: { 'font-size': '14px', 'line-clamp': '2' } },
    ] },
    ...episodeMeta,
    { type: 'text', when: [set('card.summary')], text: '{card.summary}', style: { 'font-size': '13px', color: '$ink-dim', 'line-height': '1.5', 'line-clamp': '2', 'margin-top': '2px' }, small: { display: 'none' } },
  ] },
] };

const extraCard: Node = { type: 'box', press: { action: 'playExtra', arg: '{extra.id}' }, label: '{extra.name}', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'flex-shrink': '0', width: '260px', color: '$ink' }, small: { width: '200px' },
  hover: { color: '$amber' }, focus: { 'box-shadow': ring('$amber') }, children: [
    { type: 'box', style: { position: 'relative', display: 'flex', width: '100%', 'aspect-ratio': '16 / 9', 'border-radius': '4px', 'align-items': 'center', 'justify-content': 'center', 'background-image': 'linear-gradient(160deg, $raised 0%, $chrome 100%)' }, children: [
      { type: 'box', when: [set('extra.ready')], style: { display: 'flex', width: '44px', height: '44px', 'border-radius': '999px', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$control', 'padding-left': '3px', 'box-sizing': 'border-box', color: '$ink' }, children: [glyph('play', 20)] },
      glyph('film', 28, { when: [unset('extra.ready')], style: { color: '$ink-faint' } }),
    ] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px', 'padding-top': '8px' }, children: [
      { type: 'text', text: '{extra.name}', style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1' } },
      // The extra's kind. (The compiled original fell through to "Collection" here; this is the intended label.)
      ...([['trailer', '{s:trailer}'], ['clip', '{s:clip}'], ['featurette', '{s:featurette}'], ['other', '{s:extra}']] as const).map(([kind, text]): Node =>
        ({ type: 'text', when: [set('extra.ready'), is('extra.kind', kind)], text, style: { 'font-size': '13px', color: '$ink-faint' } })),
      { type: 'text', when: [unset('extra.ready')], text: '{s:notAvailableYet}', style: { 'font-size': '13px', color: '$ink-faint' } },
    ] },
  ] };

const person: Node = { type: 'box', role: 'listitem', style: { display: 'flex', 'flex-direction': 'column', width: '110px', 'align-items': 'center', gap: '8px', 'text-align': 'center', 'flex-shrink': '0' }, small: { width: '84px' }, children: [
  { type: 'box', style: { position: 'relative', display: 'flex', width: '96px', height: '96px', 'border-radius': '999px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'align-items': 'center', 'justify-content': 'center', 'background-image': 'linear-gradient(150deg, $raised 0%, $chrome 100%)', 'box-shadow': 'inset 0px 0px 0px 1px $line' }, small: { width: '72px', height: '72px' }, children: [
    { type: 'text', text: '{person.initials}', style: { 'font-size': '28px', 'font-weight': '700', color: '$ink-dim' }, small: { 'font-size': '22px' } },
    { ...art('{person.portrait}'), when: [set('person.portrait')] },
  ] },
  { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px', width: '100%' }, children: [
    { type: 'text', text: '{person.name}', style: { 'font-size': '13px', 'font-weight': '600', 'line-clamp': '2' } },
    { type: 'text', when: [set('person.role')], text: '{person.role}', style: { 'font-size': '12px', color: '$ink-faint', 'line-clamp': '2' } },
  ] },
] };

// Wide: the poster beside the facts. Phones: the poster beside the name, the facts below.
const kindText = (size: string): Node => ({ type: 'text', text: '{detail.kindLabel}', style: { ...label, 'font-size': size, color: '$amber' } });
const titleHead: Node = { type: 'box', motion: 'arrive', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '44px', 'align-items': 'flex-start', padding: '96px 48px 12px' },
  small: { display: 'none' }, children: [
    poster,
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-width': '0px', gap: '14px', 'max-width': '62rem', 'padding-top': '6px' }, children: [
      kindText('13px'),
      { type: 'text', text: '{detail.name}', role: 'heading', level: 1, style: { 'font-size': '36px', 'font-weight': '700', 'line-height': '1.12', 'letter-spacing': '-0.01em' } },
      { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '14px', 'align-items': 'center', 'flex-wrap': 'wrap' }, children: [
        { type: 'text', when: [{ test: 'detail.year', is: 'gt', value: '0' }], text: '{detail.yearLabel}', style: { 'font-size': '20px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' } },
        { type: 'text', when: [is('detail.kind', 'episode'), { test: 'detail.episodeNumber', is: 'gt', value: '0' }, set('detail.seasonNumberLabel')], text: '{s:detailSeasonEpisode}', style: { 'font-size': '16px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' } },
        { type: 'text', when: [is('detail.kind', 'episode'), { test: 'detail.episodeNumber', is: 'gt', value: '0' }, unset('detail.seasonNumberLabel')], text: '{s:detailEpisodeNumber}', style: { 'font-size': '16px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' } },
      ] },
      facts,
    ] },
  ] };
const titleHeadSmall: Node = { type: 'box', motion: 'arrive', style: { display: 'none' }, small: { position: 'relative', display: 'flex', 'flex-direction': 'column', gap: '16px', padding: '76px 16px 8px' }, children: [
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '16px', 'align-items': 'flex-end' }, children: [
    poster,
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-width': '0px', gap: '6px', 'padding-bottom': '4px' }, children: [
      kindText('12px'),
      { type: 'text', text: '{detail.name}', role: 'heading', level: 1, style: { 'font-size': '24px', 'font-weight': '700', 'line-height': '1.15' } },
      { type: 'text', when: [set('detail.facts')], text: '{detail.facts}', style: { 'font-size': '14px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' } },
    ] },
  ] },
  facts,
] };

// A loading block in the shape of what is coming, with a passing sheen.
const block = (w: string, h: string, radius: number, extra: Partial<Node> = {}): Node => ({ type: 'box', ...extra, style: { width: w, height: h, 'flex-shrink': '0', 'border-radius': px(radius), 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$skeleton', ...(extra.style ?? {}) }, children: [
  { type: 'box', when: [unset('env.still')], motion: 'sheen', style: { width: '100%', height: '100%', 'background-image': 'linear-gradient(90deg, transparent 0%, $skeleton-sheen 50%, transparent 100%)' } },
] } as Node);
const detailLoading: Node = { type: 'box', role: 'status', label: '{s:openingTitle}', when: [is('env.load', 'loading')], style: { display: 'flex', 'flex-direction': 'row', gap: '36px', padding: '48px 48px', 'align-items': 'flex-start' }, small: { padding: '24px 16px' }, children: [
  block('260px', '390px', 4, { small: { display: 'none' } }),
  { type: 'box', style: { display: 'flex', 'flex-direction': 'column', flex: '1', gap: '16px' }, children: [block('60%', '34px', 4), block('30%', '16px', 3), block('200px', '44px', 6), block('100%', '72px', 4)] },
] };

// The title page scrolls in its own box (navigation restores it); the close button stays put.
const title: Node = { type: 'box', style: { position: 'relative', height: '100%', 'min-height': '0px', display: 'flex', 'flex-direction': 'column', 'background-color': '$page', color: '$ink', 'font-family': sans }, children: [
  { type: 'box', press: { action: 'back' }, label: '{s:closeTitle}', testId: 'detail-close', style: { position: 'absolute', top: '20px', right: '20px', 'z-index': '10', display: 'flex', 'box-sizing': 'border-box', width: '44px', height: '44px', border: '1px solid $close-line', 'border-radius': '22px', padding: '13px', 'background-color': '$close-glass', 'backdrop-filter': 'blur(20px) saturate(1.3)', color: '$close-ink' }, children: [
    { type: 'icon', symbol: 'close', style: { width: '16px', height: '16px' } },
  ] },
  { type: 'box', id: '{env.route}-scroll-{env.entry}', role: 'region', label: '{s:titleDetails}', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px', 'overflow-x': 'hidden', 'overflow-y': 'auto', 'padding-bottom': '60px' }, children: [
    detailLoading,
    { type: 'box', when: [is('env.load', 'failed')], style: { display: 'flex', 'flex-direction': 'column', gap: '4px' }, children: [
      empty('alert', '{s:somethingWentQuiet}', '{s:titleFailed}'),
      { type: 'box', when: [set('env.canRetry')], style: { display: 'flex', 'flex-direction': 'row', 'justify-content': 'center' }, children: [
        { type: 'box', press: { action: 'retry' }, label: '{s:tryAgain}', ...primary(40, '0px 22px'), children: [{ type: 'text', text: '{s:tryAgain}' }] },
      ] },
    ] },
    { type: 'box', when: [is('env.load', 'ready')], style: { position: 'absolute', top: '0px', left: '0px', right: '0px', height: '100vh', 'max-height': '900px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'pointer-events': 'none' }, small: { height: '420px', 'max-height': 'none' }, children: [
      { ...art('{detail.backdrop}'), when: [set('detail.backdrop')] },
      { type: 'box', style: { ...fill, 'background-image': 'linear-gradient(180deg, $page-veil 0%, $page-veil 45%, $page 100%), linear-gradient(90deg, $page-veil 0%, $page-clear 100%)' } },
    ] },
    { ...titleHead, when: [is('env.load', 'ready')] },
    { ...titleHeadSmall, when: [is('env.load', 'ready')] },
    { type: 'box', when: [is('env.load', 'ready')], style: { position: 'relative', display: 'flex', 'flex-direction': 'column', gap: '14px', 'padding-top': '28px', 'flex-shrink': '0' }, small: { gap: '8px', 'padding-top': '16px' }, children: [
      section([{ test: 'detail.seasonCount', is: 'gt', value: '0' }], '{s:seasons}', shelf(16, 10, seasonCard, 'detail.seasons', { role: 'group', label: '{s:season}', testId: 'season-picker' }, '4px'), { normal: '24px', small: '16px' }),
      section([set('detail.hasEpisodes')], '{detail.seasonName}', { type: 'box', style: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(260px, 1fr))', gap: '26px 20px', ...gutter }, small: { 'grid-template-columns': '1fr', gap: '14px 20px', ...gutterSmall }, children: [
        { type: 'repeat', over: 'detail.episodes', item: episodeCard },
      ] }),
      section([set('detail.hasExtras')], '{s:extras}', shelf(16, 16, extraCard, 'detail.extras')),
      section([set('detail.hasCast')], '{s:cast}', shelf(22, 14, person, 'detail.cast', { role: 'list' })),
      { type: 'box', when: [set('detail.crewLine')], style: { display: 'flex', 'flex-direction': 'column', gap: '6px', ...gutter, 'padding-bottom': '30px', 'max-width': '60rem' }, small: { ...gutterSmall, 'padding-bottom': '20px' }, children: [
        { type: 'repeat', over: 'detail.crew', item: { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'baseline' }, children: [
          { type: 'text', text: '{person.name}', style: { 'font-size': '14px', 'font-weight': '600' } },
          { type: 'text', when: [set('person.role')], text: '{person.role}', style: { 'font-size': '14px', color: '$ink-faint' } },
        ] } },
      ] },
      { type: 'repeat', over: 'detail.related', item: { type: 'use', template: 'row' } },
    ] },
  ] },
] };

const rise = { keyframes: 'doc:rise', duration: 420, easing: ease, fill: 'both' as const, still: { keyframes: 'dissolve', duration: 160 } };

export default {
  schema: 1, renderer: 4, id, name: 'Marquee', version,
  tagline: 'Your media server at home: charcoal hubs, a sidebar and amber accents.',
  preview: asset('preview.jpg'), swatches: ['#1f2023', '#eeeeee', '#e9a31b', '#121315', '#2c2e32'],
  tokens: {
    page: '#1f2023', chrome: '#121315', 'chrome-glass': '#121315f2', raised: '#2c2e32',
    control: '#ffffff1a', 'control-hover': '#ffffff2b', hover: '#ffffff14', selected: '#ffffff1f', line: '#ffffff12', 'line-strong': '#ffffff29',
    field: '#ffffff14', 'field-focus': '#ffffff21',
    ink: '#eeeeee', 'ink-dim': '#a7a9ad', 'ink-faint': '#74777c',
    amber: '#e9a31b', 'amber-hover': '#f5b638', 'on-amber': '#1a1a1a', track: '#ffffff33',
    scrim: '#000000b8', 'scrim-soft': '#00000066', 'scrim-faint': '#00000033', 'scrim-clear': '#00000000',
    'page-clear': '#1f202300', 'page-veil': '#1f2023c4', shadow: '#00000099', menu: '#2a2c30',
    // The title page's close button, as the app draws it for every flat title page.
    'close-line': '#ffffff24', 'close-glass': '#1b2028dd', 'close-ink': '#f5f1e9', skeleton: '#ffffff0d', 'skeleton-sheen': '#ffffff0f',
  },
  strings: { en: {
    mainNavigation: 'Main navigation', velaHome: 'Vela home', home: 'Home', libraries: 'Libraries', live: 'Live TV',
    toggleSidebar: 'Collapse or expand the sidebar', openNavigation: 'Open navigation', closeNavigation: 'Close navigation',
    search: 'Search', searchYourLibrary: 'Search your library', profile: 'Profile and appearance', changeAppearance: 'Change appearance',
    install: 'Install Vela', update: 'Update ready, reload', signOut: 'Sign out',
    featured: 'FEATURED', featuredTitles: 'Featured titles', featuredNumber: 'Featured title {index.label} of {env.heroCount}', moreInfo: 'More info',
    episodeNumber: 'Episode {card.episodeNumberLabel}', seasonEpisode: 'S{card.seasonNumberLabel} · E{card.episodeNumberLabel}',
    detailSeasonEpisode: 'S{detail.seasonNumberLabel} · E{detail.episodeNumberLabel}', detailEpisodeNumber: 'Episode {detail.episodeNumberLabel}',
    resumeFrom: 'Resume from {detail.resumePosition}', resumeTitle: 'Resume {card.name}', playTitle: 'Play {card.name}', watchTrailer: 'Watch trailer', watchProgress: 'Watch progress', watched: 'Watched', genres: 'Genres', nothingHereYet: 'Nothing here yet', noRowsYet: "Your library hasn't offered any rows yet. Titles appear here as your server adds them.",
    closeTitle: 'Close title', titleDetails: 'Title details', openingTitle: 'Opening title…', somethingWentQuiet: 'Something went quiet', tryAgain: 'Try again', titleFailed: "This title couldn't be opened. It may no longer be available.",
    season: 'Season', seasons: 'Seasons', episodes: 'Episodes', extras: 'Extras', cast: 'Cast', media: 'Media', play: 'Play', trailer: 'Trailer', clip: 'Clip', featurette: 'Featurette', extra: 'Extra', notAvailableYet: 'Not available yet',
  } },
  motion: {
    arrive: rise,
    drop: { keyframes: 'doc:drop', duration: 180, easing: ease, still: { keyframes: 'dissolve', duration: 120 } },
    gone100: { keyframes: 'vanish', duration: 100, easing: 'linear' },
    gone120: { keyframes: 'vanish', duration: 120, easing: 'linear' },
    fade: { keyframes: 'dissolve', duration: 160, easing: 'linear' },
    sheen: { keyframes: 'shimmer', duration: 1500, easing: 'ease-in-out', iterations: 'infinite', fill: 'none' },
    slide: { keyframes: 'doc:slide', duration: 220, easing: ease, still: { keyframes: 'dissolve', duration: 120 } },
  },
  // Marquee's own motion: a short rise, a drop from above, the drawer sliding in from the left.
  keyframes: {
    rise: { '0%': { opacity: 0, translate: '0px 10px' } },
    drop: { '0%': { opacity: 0, translate: '0px -6px' } },
    slide: { '0%': { translate: '-100% 0px' } },
  },
  templates: { card, wideCard, rankedCard, row },
  slots: { shell, home },
  routes: { title },
  detail: { wide: 'fullscreen', small: 'fullscreen' },
} satisfies SkinDocument;

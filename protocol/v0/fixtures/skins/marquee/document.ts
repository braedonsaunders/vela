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

// Icons: a platform symbol where one fits, else Marquee's own one-colour line glyph.
const builtIn: Record<string, string> = { home: 'home', search: 'search', menu: 'menu', close: 'close', check: 'checkmark', info: 'info', signout: 'sign-out', alert: 'alert', live: 'radio', play: 'play-fill' };
const glyph = (name: string, size: number, extra: Partial<Node> = {}): Node => ({ type: 'icon', symbol: builtIn[name] ?? `icon.marquee-${name}`, ...extra, style: { width: px(size), height: px(size), 'flex-shrink': '0', ...(extra.style ?? {}) } } as Node);

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
// The sidebar is an icon rail below 1200 px and full labels from there; the menu button
// flips it (`flip`). `mode` says which width this copy draws below/at 1200 px.
type Mode = 'slimFirst' | 'fullFirst' | 'full';
const by = (mode: Mode, slim: Style, full: Style): Pick<Node, 'style' | 'wide'> =>
  mode === 'full' ? { style: full } : mode === 'slimFirst' ? { style: slim, wide: full } : { style: full, wide: slim };

const navRow = (mode: Mode, name: string, icon: Node, on: Condition[], press: { action: 'home' | 'live' | 'library'; arg?: string }, extraWhen: Condition[] = [], testId = `nav-${name}`): Node[] => [false, true].map(lit => ({
  type: 'box', press, label: name, testId, when: [...extraWhen, ...(lit ? on : on.map(c => ({ ...c, not: !c.not })))].filter(Boolean),
  ...by(mode,
    { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '14px', 'align-items': 'center', 'box-sizing': 'border-box', width: '100%', height: '44px', 'border-radius': '6px', 'justify-content': 'center', padding: '0px', 'background-color': lit ? '$selected' : 'transparent', color: lit ? '$ink' : '$ink-dim', transition: quick },
    { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '14px', 'align-items': 'center', 'box-sizing': 'border-box', width: '100%', height: '44px', 'border-radius': '6px', 'justify-content': 'flex-start', padding: '0px 12px', 'background-color': lit ? '$selected' : 'transparent', color: lit ? '$ink' : '$ink-dim', transition: quick }),
  hover: { 'background-color': lit ? '$selected' : '$hover', color: '$ink' }, focus: { 'box-shadow': 'inset 0px 0px 0px 2px $amber' },
  children: [
    { ...icon, style: { ...icon.style, color: lit ? '$amber' : 'currentcolor' } } as Node,
    { type: 'text', text: name, ...by(mode, { display: 'none' }, { display: 'block', 'font-size': '15px', 'font-weight': lit ? '700' : '600', ...oneLine, 'min-width': '0px' }) },
  ] } as Node));
// One library: a live library opens the guide (when the server offers live), others their page.
const library = (mode: Mode): Node[] => [
  ...navRow(mode, '{dest.name}', glyph('live', 22), [is('env.section', 'live')], { action: 'live' }, [is('dest.kind', 'live'), set('env.canLive')], 'nav-{dest.name}'),
  ...navRow(mode, '{dest.name}', glyph('film', 22), [set('dest.on')], { action: 'library', arg: '{dest.id}' }, [is('dest.kind', 'movies')], 'nav-{dest.name}'),
  ...navRow(mode, '{dest.name}', glyph('tv', 22), [set('dest.on')], { action: 'library', arg: '{dest.id}' }, [is('dest.kind', 'shows')], 'nav-{dest.name}'),
  ...navRow(mode, '{dest.name}', glyph('stack', 22), [set('dest.on')], { action: 'library', arg: '{dest.id}' }, [isnt('dest.kind', 'movies'), isnt('dest.kind', 'shows'), isnt('dest.kind', 'live')], 'nav-{dest.name}'),
];
const destinations = (mode: Mode, extra: Style = {}): Node => ({ type: 'box', testId: 'marquee-sidebar',
  ...by(mode, { display: 'flex', 'flex-direction': 'column', gap: '2px', padding: '10px 8px', ...extra }, { display: 'flex', 'flex-direction': 'column', gap: '2px', padding: '10px 10px', ...extra }), children: [
    ...navRow(mode, '{s:home}', glyph('home', 22), [is('env.section', 'home')], { action: 'home' }, [], 'nav-Home'),
    { type: 'text', text: '{s:libraries}', ...by(mode, { display: 'none' }, { display: 'block', ...label, padding: '18px 12px 8px', 'white-space': 'nowrap' }) },
    { type: 'box', ...by(mode, { display: 'flex', height: '1px', margin: '10px 8px', 'background-color': '$line' }, { display: 'none' }) },
    { type: 'repeat', over: 'nav.destinations', item: { type: 'box', style: { display: 'flex', 'flex-direction': 'column' }, children: library(mode) } },
  ] });
const sidebar = (mode: Exclude<Mode, 'full'>): Node => ({ type: 'box', role: 'navigation', label: '{s:mainNavigation}', when: when(set('env.viewer'), mode === 'slimFirst' ? unset('flag:flip') : set('flag:flip')),
  ...by(mode, { width: '72px', 'flex-shrink': '0', 'box-sizing': 'border-box', 'padding-top': px(bar.normal), 'background-color': '$chrome', 'overflow-x': 'hidden', 'overflow-y': 'auto', 'scrollbar-width': 'none' },
    { width: '232px', 'flex-shrink': '0', 'box-sizing': 'border-box', 'padding-top': px(bar.normal), 'background-color': '$chrome', 'overflow-x': 'hidden', 'overflow-y': 'auto', 'scrollbar-width': 'none' }),
  small: { display: 'none' }, children: [destinations(mode)] });

// The bar's left end: the menu button and the wordmark, as wide as the rail (at least 200).
const barStart = (mode: Exclude<Mode, 'full'>): Node => ({ type: 'box', when: [mode === 'slimFirst' ? unset('flag:flip') : set('flag:flip')],
  ...by(mode, { display: 'flex', 'flex-direction': 'row', width: '200px', 'flex-shrink': '0', 'box-sizing': 'border-box', 'padding-left': '12px', gap: '10px', 'align-items': 'center', 'pointer-events': 'auto' },
    { display: 'flex', 'flex-direction': 'row', width: '232px', 'flex-shrink': '0', 'box-sizing': 'border-box', 'padding-left': '12px', gap: '10px', 'align-items': 'center', 'pointer-events': 'auto' }),
  small: { width: 'auto', 'padding-left': '4px', gap: '4px' }, children: [
    { type: 'box', press: { action: 'toggle', arg: 'flip' }, label: '{s:toggleSidebar}', testId: 'marquee-menu', ...round(44), small: { display: 'none' }, children: [glyph('menu', 22)] },
    { type: 'box', press: { action: 'toggle', arg: 'drawer' }, label: '{s:openNavigation}', testId: 'marquee-menu', ...round(44), style: { ...round(44).style, display: 'none' }, small: { display: 'flex' }, children: [glyph('menu', 22)] },
    { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', style: { position: 'relative', display: 'flex', 'align-items': 'center', padding: '6px 4px', 'border-radius': '4px' }, children: [wordmark(28)] },
  ] });

const topBar: Node = { type: 'box', when: [set('env.viewer')], style: { position: 'absolute', top: '0px', left: '0px', right: '0px', height: px(bar.normal), 'z-index': '20', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'box-sizing': 'border-box', 'padding-right': '14px', gap: '12px', 'pointer-events': 'none' },
  small: { height: px(bar.small), 'padding-right': '6px', gap: '2px' }, children: [
    // The bar's ground: glass, except over a wide home, which draws its middle itself.
    { type: 'box', when: [isnt('env.section', 'home')], style: { ...fill, 'background-color': '$chrome-glass', 'backdrop-filter': 'blur(18px)' } },
    { type: 'box', when: [is('env.section', 'home')], style: { display: 'none' }, small: { display: 'flex', ...fill, 'background-color': '$chrome-glass', 'backdrop-filter': 'blur(18px)' } },
    barStart('slimFirst'), barStart('fullFirst'),
    { type: 'box', style: { display: 'none' }, small: { display: 'flex', flex: '1' } },
    { type: 'box', press: { action: 'search' }, label: '{s:search}', ...round(44), style: { ...round(44).style, display: 'none' }, small: { display: 'flex' }, children: [glyph('search', 22)] },
    { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', flex: '1', 'min-width': '0px', 'justify-content': 'center' }, small: { display: 'none' }, children: [
      { type: 'box', when: [isnt('env.section', 'home')], press: { action: 'search' }, label: '{s:searchYourLibrary}', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', width: 'min(560px, 100%)', 'box-sizing': 'border-box', height: '38px', padding: '0px 14px', 'border-radius': '6px', 'background-color': '$field', color: '$ink-faint', cursor: 'text', 'pointer-events': 'auto' },
        hover: { 'background-color': '$field-focus' }, focus: { 'box-shadow': ring('$amber') }, children: [glyph('search', 18), { type: 'text', text: '{s:search}', style: { 'font-size': '15px' } }] },
    ] },
    { type: 'box', press: { action: 'toggle', arg: 'menu' }, label: '{s:profile}', testId: 'profile-menu', ...round(44), children: [avatar(32, 14)] },
  ] };

const menuRow = (text: string, icon: Node, press: { action: 'openPicker' | 'signOut' }, testId?: string): Node => ({ type: 'box', press, label: text, testId,
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center', 'box-sizing': 'border-box', width: '100%', height: '42px', padding: '0px 16px', color: '$ink' },
  hover: { 'background-color': '$hover' }, focus: { 'box-shadow': 'inset 0px 0px 0px 2px $amber' }, children: [icon, { type: 'text', text, style: { 'font-size': '14px' } }] });
const divider: Node = { type: 'box', style: { height: '1px', 'background-color': '$line' } };
const accountMenu: Node = { type: 'box', when: [set('env.viewer'), set('flag:menu')], motion: 'drop',
  style: { position: 'absolute', top: px(bar.normal - 4), right: '14px', 'z-index': '30', width: '260px', 'box-sizing': 'border-box', padding: '8px 0px', 'border-radius': '6px', 'background-color': '$menu', 'box-shadow': '0px 12px 40px $shadow, 0px 0px 0px 1px $line' },
  small: { top: px(bar.small - 4), right: '8px' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center', padding: '10px 16px 14px' }, children: [
      avatar(36, 16),
      { type: 'text', text: '{env.viewer}', style: { 'font-size': '15px', 'font-weight': '700', flex: '1', 'min-width': '0px', 'line-clamp': '1' } },
    ] },
    divider,
    menuRow('{s:changeAppearance}', glyph('grid', 18), { action: 'openPicker' }, 'skin-picker'),
    { type: 'box', style: { padding: '0px 16px' }, children: [
      { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
      { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
    ] },
    divider,
    menuRow('{s:signOut}', glyph('signout', 18), { action: 'signOut' }),
  ] };

// Phones: the sidebar is a drawer behind the menu button.
const drawer: Node[] = [
  { type: 'box', when: [set('env.viewer'), set('env.small'), set('flag:drawer')], press: { action: 'close', arg: 'drawer' }, label: '{s:closeNavigation}', motion: 'fade', style: { ...fill, 'z-index': '40', 'background-color': '$scrim' } },
  { type: 'box', when: [set('env.viewer'), set('env.small'), set('flag:drawer')], role: 'navigation', label: '{s:mainNavigation}', motion: 'slide',
    style: { position: 'absolute', top: '0px', left: '0px', bottom: '0px', 'z-index': '41', width: 'min(300px, 84vw)', 'box-sizing': 'border-box', display: 'flex', 'flex-direction': 'column', 'background-color': '$chrome', 'box-shadow': '12px 0px 40px $shadow' }, children: [
      { type: 'box', style: { display: 'flex', 'flex-direction': 'row', height: px(bar.small), 'align-items': 'center', gap: '4px', 'padding-left': '4px', 'padding-right': '4px', 'flex-shrink': '0' }, children: [
        { type: 'box', press: { action: 'close', arg: 'drawer' }, label: '{s:closeNavigation}', ...round(44), children: [glyph('close', 22)] },
        wordmark(28),
      ] },
      destinations('full', { flex: '1', 'min-height': '0px', 'overflow-y': 'auto' }),
    ] },
];

const shell: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', height: '100%', 'min-height': '0px', 'background-color': '$page', color: '$ink', 'font-family': sans }, children: [
  sidebar('slimFirst'), sidebar('fullFirst'),
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
  { type: 'box', style: { ...fill, 'background-color': '$scrim-faint', opacity: '0', transition: 'opacity 120ms linear' }, groupHover: { opacity: '1' } },
  { type: 'box', style: { ...fill, 'border-radius': '4px', 'box-shadow': 'inset 0px 0px 0px 3px $amber', opacity: '0', transition: 'opacity 120ms linear' }, groupHover: { opacity: '1' } },
];
// An unwatched film or episode carries an amber corner.
const corner = (kind: string, size: number, sizeSmall = size): Node => ({ type: 'box', when: [is('card.kind', kind), unset('card.played'), unset('card.hasProgress')],
  style: { position: 'absolute', top: '0px', right: '0px', width: px(size), height: px(size), 'background-image': 'linear-gradient(225deg, $amber 50%, transparent 50%)' }, small: { width: px(sizeSmall), height: px(sizeSmall) } });
// Artwork is absent: the kind's icon and the title on a quiet panel.
const placeholder: Node = { type: 'box', when: [unset('card.poster')], style: { ...fill, display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', gap: '10px', padding: '12px', 'box-sizing': 'border-box', 'background-image': 'linear-gradient(160deg, $raised 0%, $chrome 100%)', color: '$ink-faint' }, children: [
  glyph('film', 32, { when: [is('card.kind', 'movie')], small: { width: '26px', height: '26px' } }),
  glyph('live', 32, { when: [is('card.kind', 'channel')], small: { width: '26px', height: '26px' } }),
  glyph('stack', 32, { when: [is('card.kind', 'collection')], small: { width: '26px', height: '26px' } }),
  glyph('tv', 32, { when: [isnt('card.kind', 'movie'), isnt('card.kind', 'channel'), isnt('card.kind', 'collection')], small: { width: '26px', height: '26px' } }),
  { type: 'text', text: '{card.name}', style: { 'font-size': '13px', 'font-weight': '600', color: '$ink-dim', 'text-align': 'center', 'line-clamp': '3' }, small: { 'font-size': '12px' } },
] };
// The line under a card: S·E for an episode, else the year.
const caption: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px', 'padding-top': '8px', width: '100%', 'min-width': '0px' }, children: [
  { type: 'text', text: '{card.name}', style: { 'font-size': '14px', 'font-weight': '600', color: '$ink', ...oneLine, transition: 'color 120ms linear' }, small: { 'font-size': '13px' }, groupHover: { color: '$amber' } },
  { type: 'text', when: [is('card.kind', 'episode'), set('card.episodeNumberLabel')], text: '{s:episodeNumber}', style: { 'font-size': '13px', color: '$ink-faint', 'font-variant-numeric': 'tabular-nums', ...oneLine }, small: { 'font-size': '12px' } },
  { type: 'text', when: [isnt('card.kind', 'episode'), set('card.yearLabel')], text: '{card.yearLabel}', style: { 'font-size': '13px', color: '$ink-faint', 'font-variant-numeric': 'tabular-nums', ...oneLine }, small: { 'font-size': '12px' } },
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
  { ...art('{card.poster}'), when: [set('card.poster')] }, placeholder, corner('movie', 22, 18), corner('episode', 22, 18),
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
  { type: 'box', style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '16px', 'align-items': 'flex-start', 'padding-top': '4px', 'padding-bottom': '4px', ...gutter }, small: { gap: '10px', ...gutterSmall }, children: [
      { type: 'repeat', over: 'row.items', when: [isnt('row.presentation', 'ranked')], item: { type: 'use', template: 'card' } },
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
    { type: 'text', text: '{hero.factsLine}', style: { 'font-size': '14px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' }, small: { 'font-size': '13px' } },
    { type: 'text', when: [set('hero.summary')], text: '{hero.summary}', style: { 'font-size': '15px', color: '$ink', 'line-height': '1.5', 'line-clamp': '2', 'text-shadow': '0px 1px 8px $shadow' }, small: { display: 'none' } },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', 'margin-top': '8px', 'flex-wrap': 'wrap' }, small: { 'margin-top': '4px' }, children: [
      // The server's predicted action (play, resume, next episode) in amber, then More info.
      { type: 'box', when: [set('heroAct.playable')], press: { action: 'play', arg: '{hero.id}' }, label: '{heroAct.actionLabel}', testId: 'hero-primary', ...primary(40, '0px 20px'), small: { height: '38px' }, children: [
        glyph('play', 16), { type: 'text', text: '{heroAct.actionLabel}', style: { 'font-size': '15px' } },
        { type: 'text', when: [set('heroAct.actionDetail')], text: '{heroAct.actionDetail}', style: { 'font-size': '13px', 'font-weight': '600', opacity: '0.7' }, small: { display: 'none' } },
      ] },
      { type: 'box', when: [set('heroAct.playable')], press: { action: 'select', arg: '{hero.kindId}' }, label: '{hero.name}', ...secondary(40, '0px 18px'), small: { height: '38px' }, children: [glyph('info', 18), { type: 'text', text: '{s:moreInfo}', style: { 'font-size': '15px' } }] },
      { type: 'box', when: [unset('heroAct.playable')], press: { action: 'select', arg: '{hero.kindId}' }, label: '{hero.name}', ...primary(40, '0px 20px'), small: { height: '38px' }, children: [glyph('info', 18), { type: 'text', text: '{s:moreInfo}', style: { 'font-size': '15px' } }] },
    ] },
  ] };
const dot = (current: boolean): Node => ({ type: 'box', when: [{ test: 'index.current', not: !current }], press: { action: 'pickHero', arg: '{index}' }, label: '{s:featuredNumber}',
  style: { position: 'relative', width: current ? '22px' : '8px', height: '8px', 'border-radius': '4px', 'background-color': current ? '$amber' : '$track' }, focus: { 'box-shadow': ring('$ink') } });
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
      { type: 'repeat', over: 'home.heroes', item: { type: 'box', style: { display: 'flex' }, children: [dot(true), dot(false)] } },
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
  { type: 'box', style: { display: 'flex', 'flex-direction': 'column', 'padding-top': '24px', 'padding-bottom': '48px' }, small: { 'padding-top': '0px' }, children: [
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
const shelf = (gap: number, gapSmall: number, item: Node, over: string): Node => ({ type: 'box', style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: px(gap), ...gutter, 'padding-top': '4px', 'padding-bottom': '4px' }, small: { gap: px(gapSmall), ...gutterSmall }, children: [{ type: 'repeat', over, item }] },
] });

const poster: Node = { type: 'box', style: { position: 'relative', width: 'clamp(220px, 21vw, 300px)', 'flex-shrink': '0', 'aspect-ratio': '2 / 3', 'border-radius': '6px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised', 'box-shadow': '0px 18px 50px $shadow' }, small: { width: '38%' }, children: [
  { ...art('{detail.poster}'), when: [set('detail.poster')] },
  { type: 'box', when: [unset('detail.poster')], style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '$ink-faint' }, children: [
    glyph('film', 40, { when: [is('detail.kind', 'movie')] }), glyph('tv', 40, { when: [isnt('detail.kind', 'movie')] }),
  ] },
] };
const playButton: Node = { type: 'box', when: [set('detail.canPlay')], press: { action: 'play', arg: '{detail.id}' }, label: '{detail.playLabel}', testId: 'detail-play', ...primary(48, '0px 26px'), style: { ...primary(48, '0px 26px').style, gap: '10px' }, small: { height: '46px', 'flex-grow': '1' }, children: [
  glyph('play', 18), { type: 'text', text: '{detail.playLabel}', style: { 'font-size': '16px' } },
] };
const upNextButton: Node = { type: 'repeat', over: 'detail.upNext', when: [unset('detail.canPlay')], item: { type: 'box', press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}', testId: 'detail-play', ...primary(48, '0px 26px'), style: { ...primary(48, '0px 26px').style, gap: '10px' }, small: { height: '46px', 'flex-grow': '1' }, children: [
  glyph('play', 18), { type: 'text', text: '{s:play}', style: { 'font-size': '16px' } },
] } };
const facts: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '16px' }, small: { gap: '14px' }, children: [
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', 'flex-wrap': 'wrap', 'margin-top': '4px' }, children: [playButton, upNextButton] },
  { type: 'box', when: [set('detail.hasResume')], style: { width: '280px', height: '4px', 'border-radius': '2px', 'background-color': '$track', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, small: { width: '100%' }, children: [
    { type: 'box', style: { height: '4px', width: '{detail.resumePct}%', 'background-color': '$amber' } },
  ] },
  { type: 'text', when: [set('detail.summary')], text: '{detail.summary}', style: { 'font-size': '16px', 'line-height': '1.6', color: '$ink', 'max-width': '52rem' }, small: { 'font-size': '15px' } },
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'baseline', 'flex-wrap': 'wrap' }, children: [
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

const episodeCard: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '10px', 'align-items': 'stretch' }, small: { 'flex-direction': 'row', gap: '12px', 'align-items': 'flex-start' }, children: [
  { type: 'box', group: true, press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}', testId: 'episode-{card.id}', style: { position: 'relative', width: '100%', 'flex-shrink': '0', 'aspect-ratio': '16 / 9', 'border-radius': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised' }, small: { width: '148px' }, children: [
    { ...art('{card.backdrop}'), when: [set('card.backdrop')] },
    { type: 'box', when: [unset('card.backdrop')], style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '$ink-faint' }, children: [glyph('tv', 28)] },
    corner('episode', 20),
    progress(4, '{card.progressPct}', [set('card.hasProgress')]),
    { type: 'box', style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$scrim-soft', opacity: '0', transition: 'opacity 120ms linear' }, groupHover: { opacity: '1' }, children: [
      { type: 'box', style: { display: 'flex', width: '50px', height: '50px', 'border-radius': '999px', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$amber', color: '$on-amber', 'padding-left': '3px', 'box-sizing': 'border-box' }, small: { width: '38px', height: '38px' }, children: [
        glyph('play', 22, { small: { width: '18px', height: '18px' } }),
      ] },
    ] },
    { type: 'box', style: { ...fill, 'border-radius': '4px', 'box-shadow': 'inset 0px 0px 0px 3px $amber', opacity: '0' }, groupHover: { opacity: '1' } },
  ] },
  { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '3px', 'min-width': '0px', flex: '1' }, children: [
    { type: 'box', press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', style: { position: 'relative', color: '$ink' }, hover: { color: '$amber' }, focus: { 'box-shadow': ring('$amber') }, children: [
      { type: 'text', text: '{card.name}', style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '1' }, small: { 'font-size': '14px', 'line-clamp': '2' } },
    ] },
    { type: 'text', text: '{card.facts}', style: { 'font-size': '13px', color: '$ink-faint', 'font-variant-numeric': 'tabular-nums' } },
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
      { type: 'text', when: [set('extra.ready')], text: '{s:collection}', style: { 'font-size': '13px', color: '$ink-faint' } },
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
        { type: 'text', when: [set('detail.facts')], text: '{detail.facts}', style: { 'font-size': '20px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' } },
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
    { type: 'icon', symbol: 'close', style: { width: '18px', height: '18px' } },
  ] },
  { type: 'box', id: '{env.route}-scroll-{env.entry}', role: 'region', label: '{s:titleDetails}', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px', 'overflow-x': 'hidden', 'overflow-y': 'auto', 'padding-bottom': '60px' }, children: [
    detailLoading,
    empty('alert', '{s:somethingWentQuiet}', '{s:titleFailed}', { when: [is('env.load', 'failed')] }),
    { type: 'box', when: [is('env.load', 'ready')], style: { position: 'absolute', top: '0px', left: '0px', right: '0px', height: '100vh', 'max-height': '900px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'pointer-events': 'none' }, small: { height: '420px', 'max-height': 'none' }, children: [
      { ...art('{detail.backdrop}'), when: [set('detail.backdrop')] },
      { type: 'box', style: { ...fill, 'background-image': 'linear-gradient(180deg, $page-veil 0%, $page-veil 45%, $page 100%), linear-gradient(90deg, $page-veil 0%, $page-clear 100%)' } },
    ] },
    { ...titleHead, when: [is('env.load', 'ready')] },
    { ...titleHeadSmall, when: [is('env.load', 'ready')] },
    { type: 'box', when: [is('env.load', 'ready')], style: { position: 'relative', display: 'flex', 'flex-direction': 'column', gap: '14px', 'padding-top': '28px', 'flex-shrink': '0' }, small: { gap: '8px', 'padding-top': '16px' }, children: [
      section([set('detail.hasSeasons')], '{s:seasons}', shelf(16, 10, seasonCard, 'detail.seasons'), { normal: '24px', small: '16px' }),
      section([set('detail.hasEpisodes')], '{s:episodes}', { type: 'box', style: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(260px, 1fr))', gap: '26px 20px', ...gutter }, small: { 'grid-template-columns': '1fr', gap: '14px 20px', ...gutterSmall }, children: [
        { type: 'repeat', over: 'detail.episodes', item: episodeCard },
      ] }),
      section([set('detail.hasExtras')], '{s:extras}', shelf(16, 16, extraCard, 'detail.extras')),
      section([set('detail.hasCast')], '{s:cast}', shelf(22, 14, person, 'detail.cast')),
      { type: 'repeat', over: 'detail.related', item: { type: 'use', template: 'row' } },
    ] },
  ] },
] };

const rise = { keyframes: 'rise', duration: 420, easing: ease, fill: 'both' as const, still: { keyframes: 'dissolve', duration: 160 } };

export default {
  schema: 1, renderer: 2, id, name: 'Marquee', version,
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
    episodeNumber: 'Episode {card.episodeNumberLabel}', nothingHereYet: 'Nothing here yet', noRowsYet: "Your library hasn't offered any rows yet. Titles appear here as your server adds them.",
    closeTitle: 'Close title', titleDetails: 'Title details', openingTitle: 'Opening title…', somethingWentQuiet: 'Something went quiet', titleFailed: "This title couldn't be opened. It may no longer be available.",
    seasons: 'Seasons', episodes: 'Episodes', extras: 'Extras', cast: 'Cast', media: 'Media', play: 'Play', collection: 'Collection', notAvailableYet: 'Not available yet',
  } },
  motion: {
    arrive: rise,
    drop: { keyframes: 'pop', duration: 180, easing: ease, still: { keyframes: 'dissolve', duration: 120 } },
    fade: { keyframes: 'dissolve', duration: 160, easing: 'linear' },
    sheen: { keyframes: 'shimmer', duration: 1500, easing: 'ease-in-out', iterations: 'infinite', fill: 'none' },
    slide: { keyframes: 'slideIn', duration: 220, easing: ease, still: { keyframes: 'dissolve', duration: 120 } },
  },
  templates: { card, wideCard, rankedCard, row },
  slots: { shell, home },
  routes: { title },
  detail: { wide: 'fullscreen', small: 'fullscreen' },
} satisfies SkinDocument;

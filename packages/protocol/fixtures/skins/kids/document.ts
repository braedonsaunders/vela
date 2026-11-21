import { episodePage } from '../../../episode-page';
// Kids, a skin document (protocol/v0/skin.ts, docs/skin-schema.md): a bright, friendly
// family skin. Big rounded sticker tiles over a daylight sky, three-way navigation
// (Watch, Shows, Movies), very little text, gentle bouncy motion that goes calm under
// reduced motion, and a grown-ups corner behind a two-question gate so settings and
// sign-out stay out of small hands. Assets are this document's own, served beside it
// from kids/assets/; licences in kids/licences/ (Nunito is OFL, the art is drawn for Vela).
import type { BoxNode, Node, SkinDocument, Style } from '../../../skin';

const version = '1.2.16';
const art = (file: string) => `/vela/v0/appearance/skins/kids/${version}/${file}`;

const rounded = '"Kids Nunito", ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Quicksand", system-ui, -apple-system, "Segoe UI", sans-serif';
const bouncy = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const soft = 'cubic-bezier(0.16, 1, 0.3, 1)';
const gutter = { 'padding-left': 'max(24px, 4vw)', 'padding-right': 'max(24px, 4vw)' } as Style;
const gutterSmall = { 'padding-left': '16px', 'padding-right': '16px' } as Style;
// A raised, toy-like button: a flat ledge under a soft drop.
const ledge = (tint: string) => `0px 6px 0px ${tint}, 0px 16px 28px -12px rgba(27, 37, 80, 0.35)`;
const lift = { translate: '0px -3px', transition: `translate 380ms ${bouncy}, scale 380ms ${bouncy}, background-color 160ms linear` } as Style;
// Keyboard and remote focus: a thick sky ring outside a white gap, readable on any ground.
const ring = '0px 0px 0px 4px #FFFFFF, 0px 0px 0px 8px #3FA9F5';
const ringed = (shadow: string): Style => ({ ...lift, 'box-shadow': `${ring}, ${shadow}` } as Style);

// ---------------------------------------------------------------- shell

// Library icons by kind: shows, movies, and anything else (mixed) as the toy box.
const kindIcon = (size: number): Node[] => [
  { type: 'image', when: [{ test: 'dest.kind', is: 'eq', value: 'shows' }], src: art('shows.svg'), alt: '', style: { width: `${size}px`, height: `${size}px`, position: 'relative' } },
  { type: 'image', when: [{ test: 'dest.kind', is: 'eq', value: 'movies' }], src: art('movies.svg'), alt: '', style: { width: `${size}px`, height: `${size}px`, position: 'relative' } },
  { type: 'image', when: [{ test: 'dest.kind', is: 'ne', value: 'shows' }, { test: 'dest.kind', is: 'ne', value: 'movies' }], src: art('toys.svg'), alt: '', style: { width: `${size}px`, height: `${size}px`, position: 'relative' } },
];
const kindFill = (on: Style): Node[] => [
  { type: 'box', when: [{ test: 'dest.on' }, { test: 'dest.kind', is: 'eq', value: 'shows' }], style: { ...on, 'background-color': '$sky' } },
  { type: 'box', when: [{ test: 'dest.on' }, { test: 'dest.kind', is: 'eq', value: 'movies' }], style: { ...on, 'background-color': '$coral' } },
  { type: 'box', when: [{ test: 'dest.on' }, { test: 'dest.kind', is: 'ne', value: 'shows' }, { test: 'dest.kind', is: 'ne', value: 'movies' }], style: { ...on, 'background-color': '$grape' } },
];
const pillFill: Style = { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'border-radius': '999px' };
const pill: Style = { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '10px', height: '60px', 'box-sizing': 'border-box', padding: '0px 24px 0px 10px',
  'border-radius': '999px', 'background-color': '$card', 'box-shadow': ledge('rgba(27, 37, 80, 0.10)'), 'font-size': '19px', 'font-weight': '800', 'white-space': 'nowrap', 'flex-shrink': '0',
  translate: '0px 0px', scale: '1', transition: `translate 380ms ${bouncy}, scale 380ms ${bouncy}` };
const pillText: Style = { position: 'relative', 'line-clamp': '1', 'max-width': '14rem' };

// Watch is home; Shows and Movies are the server's libraries, each drawn by kind. Live TV stays out.
const navWatch: Node = { type: 'box', press: { action: 'home' }, label: '{s:watch}', a11y: { current: [{ test: 'env.section', is: 'eq', value: 'home' }] }, testId: 'kids-nav-watch', style: pill, hover: lift, focus: ringed(ledge('rgba(27, 37, 80, 0.10)')), children: [
  { type: 'box', when: [{ test: 'env.section', is: 'eq', value: 'home' }], style: { ...pillFill, 'background-color': '$sun' } },
  { type: 'image', src: art('watch.svg'), alt: '', style: { width: '40px', height: '40px', position: 'relative' } },
  { type: 'text', text: '{s:watch}', style: pillText },
] };
const navLibrary: Node = { type: 'repeat', over: 'nav.destinations', when: [{ test: 'dest.kind', is: 'ne', value: 'live' }], item: { type: 'box', press: { action: 'library', arg: '{dest.id}' }, label: '{dest.name}', a11y: { current: [{ test: 'dest.on' }] }, testId: 'kids-nav-{dest.id}', style: pill, hover: lift, focus: ringed(ledge('rgba(27, 37, 80, 0.10)')), children: [
  ...kindFill(pillFill), ...kindIcon(40), { type: 'text', text: '{dest.name}', style: pillText },
] } };

// The phone dock: the same three ways in, as big thumb targets along the bottom.
const dockItem: Style = { position: 'relative', display: 'flex', 'flex-direction': 'column', 'border-radius': '22px', 'align-items': 'center', gap: '4px', flex: '1', 'min-width': '0px', 'padding-top': '10px', 'font-size': '12px', 'font-weight': '800' };
const dockBubble: Style = { position: 'absolute', top: '4px', left: '50%', width: '60px', height: '52px', 'margin-left': '-30px', 'border-radius': '20px' };
const dockText: Style = { position: 'relative', 'line-clamp': '1', 'max-width': '100%', 'text-align': 'center' };
const dock: Node = { type: 'box', role: 'navigation', label: '{s:mainNav}', when: [{ test: 'env.viewer' }, { test: 'env.small' }], style: { color: '$ink', position: 'absolute', left: '10px', right: '10px', bottom: 'calc(10px + env(safe-area-inset-bottom))', 'z-index': '20', display: 'flex', 'flex-direction': 'row', height: '76px', 'box-sizing': 'border-box', padding: '0px 6px',
  'border-radius': '30px', 'background-color': '$card', 'box-shadow': '0px 6px 0px rgba(27, 37, 80, 0.08), 0px 18px 40px -12px rgba(27, 37, 80, 0.4)' }, children: [
  { type: 'box', press: { action: 'home' }, label: '{s:watch}', a11y: { current: [{ test: 'env.section', is: 'eq', value: 'home' }] }, style: dockItem, focus: { 'background-color': '$sky-soft' }, children: [
    { type: 'box', when: [{ test: 'env.section', is: 'eq', value: 'home' }], style: { ...dockBubble, 'background-color': '$sun' } },
    { type: 'image', src: art('watch.svg'), alt: '', style: { width: '34px', height: '34px', position: 'relative' } },
    { type: 'text', text: '{s:watch}', style: dockText },
  ] },
  { type: 'repeat', over: 'nav.destinations', when: [{ test: 'dest.kind', is: 'ne', value: 'live' }], item: { type: 'box', press: { action: 'library', arg: '{dest.id}' }, label: '{dest.name}', a11y: { current: [{ test: 'dest.on' }] }, style: dockItem, focus: { 'background-color': '$sky-soft' }, children: [
    ...kindFill(dockBubble), ...kindIcon(34), { type: 'text', text: '{dest.name}', style: dockText },
  ] } },
] };

const roundButton = (size: number): Style => ({ position: 'relative', display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: `${size}px`, height: `${size}px`, 'border-radius': '999px', 'flex-shrink': '0',
  'background-color': '$card', 'box-shadow': ledge('rgba(27, 37, 80, 0.10)'), translate: '0px 0px', scale: '1', transition: `translate 380ms ${bouncy}, scale 380ms ${bouncy}` } as Style);

const bar: Node = { type: 'box', role: 'navigation', label: '{s:mainNav}', when: [{ test: 'env.viewer' }], style: { color: '$ink', position: 'absolute', top: '0px', left: '0px', right: '0px', 'z-index': '20', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '14px', height: '100px', 'box-sizing': 'border-box', ...gutter },
  small: { height: '68px', ...gutterSmall, gap: '10px' }, children: [
  // A soft frosted band, so rows scrolling under the bar stay quiet behind it.
  { type: 'box', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'pointer-events': 'none', 'background-color': 'rgba(255, 248, 238, 0.86)', 'backdrop-filter': 'blur(14px)' } },
  { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', style: { position: 'relative', display: 'flex', 'align-items': 'center', height: '60px', 'justify-content': 'center', padding: '0px 10px', 'margin-right': '8px', 'flex-shrink': '0' },
    small: { height: '44px', padding: '0px 4px', 'margin-right': '0px' }, children: [
    { type: 'image', src: 'assets/brand/vela-lockup-paper.svg', alt: '', style: { width: '74px', height: '28px' }, small: { width: '63px', height: '24px' } },
  ] },
  // Centred while it fits; when it doesn't, the auto margins collapse and the row scrolls from Watch.
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', flex: '1', 'min-width': '0px', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', padding: '6px 4px 14px 4px', 'margin-bottom': '-8px',
    'mask-image': 'linear-gradient(90deg, transparent 0px, black 6px, black calc(100% - 36px), transparent 100%)' },
    small: { display: 'none' }, children: [
      { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '14px', 'margin-left': 'auto', 'margin-right': 'auto', 'flex-shrink': '0' }, children: [navWatch, navLibrary] }] },
  { type: 'box', when: [{ test: 'env.small' }], style: { flex: '1' } },
  { type: 'box', press: { action: 'search' }, label: '{s:search}', testId: 'kids-search', style: roundButton(60), hover: lift, focus: ringed(ledge('rgba(27, 37, 80, 0.10)')), small: { width: '48px', height: '48px' }, children: [
    { type: 'icon', symbol: 'search', style: { width: '26px', height: '26px', color: '$ink' }, small: { width: '22px', height: '22px' } },
  ] },
  // The grown-ups corner: small and quiet, behind a gate.
  { type: 'box', press: { action: 'open', arg: 'gate' }, label: '{s:grownUps}', a11y: { haspopup: 'dialog' }, testId: 'kids-grown-ups', style: { position: 'relative', display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: '44px', height: '44px', 'border-radius': '999px', 'flex-shrink': '0', opacity: '0.5', 'background-color': 'rgba(255, 255, 255, 0.5)', transition: 'opacity 160ms linear' },
    hover: { opacity: '1' }, focus: { opacity: '1', 'box-shadow': ring }, children: [
    { type: 'icon', symbol: 'lock', style: { width: '18px', height: '18px', color: '$ink' } },
  ] },
] };

// The gate: two sums a grown-up answers at a glance. A wrong answer closes it.
const answer = (n: number, right: boolean, step: 1 | 2): Node => ({ type: 'box', press: right ? { action: 'open', arg: step === 1 ? 'g2' : 'parent' } : step === 1 ? { action: 'close', arg: 'gate' } : { action: 'reset' },
  label: String(n), testId: right ? `kids-gate-${step}` : undefined,
  style: { position: 'relative', display: 'flex', 'align-items': 'center', 'justify-content': 'center', height: '64px', 'border-radius': '20px', 'background-color': '$cream', 'font-size': '26px', 'font-weight': '800', 'font-variant-numeric': 'tabular-nums',
    'box-shadow': '0px 5px 0px rgba(27, 37, 80, 0.10)', translate: '0px 0px', transition: `translate 300ms ${bouncy}, background-color 160ms linear` },
  hover: { 'background-color': '$sun-soft', translate: '0px -2px' }, focus: { 'background-color': '$sun-soft', 'box-shadow': ring }, children: [{ type: 'text', text: String(n) }] });
const question = (step: 1 | 2, prompt: string, options: number[], right: number): Node => ({ type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '18px', width: '100%' }, children: [
  { type: 'text', text: prompt, style: { 'font-size': '20px', 'font-weight': '700', 'text-align': 'center', color: '$ink-soft' } },
  { type: 'box', role: 'group', label: prompt, style: { display: 'grid', 'grid-template-columns': '1fr 1fr 1fr', gap: '12px' }, children: options.map(n => answer(n, n === right, step)) },
] });
const menuRow = (press: BoxNode['press'], label: string, symbol: string, testId: string): Node => ({ type: 'box', press, label, testId,
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '14px', height: '60px', 'margin-bottom': '10px', padding: '0px 18px', 'border-radius': '20px', 'background-color': '$cream', 'font-size': '18px', 'font-weight': '700' },
  hover: { 'background-color': '$sun-soft' }, focus: { 'background-color': '$sun-soft', 'box-shadow': ring }, children: [
    { type: 'icon', symbol, style: { width: '22px', height: '22px' } },
    { type: 'text', text: label, style: { flex: '1' } },
  ] });
const gate: Node = { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:gate' }], style: { color: '$ink', position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'z-index': '40', display: 'flex', 'align-items': 'center', 'justify-content': 'center', padding: '16px' }, children: [
  { type: 'box', press: { action: 'reset' }, label: '{s:close}', motion: 'fade', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'background-color': 'rgba(27, 37, 80, 0.42)', 'backdrop-filter': 'blur(8px)' } },
  { type: 'box', role: 'dialog', label: '{s:grownUps}', motion: 'popIn', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '18px', width: '100%', 'max-width': '440px', 'box-sizing': 'border-box', padding: '34px 30px 30px 30px',
    'border-radius': '36px', 'background-color': '$card', 'box-shadow': '0px 10px 0px rgba(27, 37, 80, 0.12), 0px 40px 90px -20px rgba(27, 37, 80, 0.55)' }, small: { padding: '28px 20px 22px 20px' }, children: [
    { type: 'box', press: { action: 'close', arg: 'gate' }, label: '{s:close}', testId: 'kids-gate-close', when: [{ test: 'flag:g2', not: true }], style: { position: 'absolute', top: '14px', right: '14px', width: '44px', height: '44px', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$cream' }, children: [
      { type: 'icon', symbol: 'close', style: { width: '18px', height: '18px' } }] },
    { type: 'box', press: { action: 'reset' }, label: '{s:close}', when: [{ test: 'flag:g2' }], style: { position: 'absolute', top: '14px', right: '14px', width: '44px', height: '44px', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$cream' }, children: [
      { type: 'icon', symbol: 'close', style: { width: '18px', height: '18px' } }] },
    { type: 'box', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: '72px', height: '72px', 'border-radius': '26px', 'background-color': '$sun', 'box-shadow': '0px 5px 0px #E8A419' }, children: [
      { type: 'icon', symbol: 'lock', style: { width: '32px', height: '32px', color: '$ink' } }] },
    { type: 'text', text: '{s:grownUps}', role: 'heading', level: 2, style: { 'font-size': '28px', 'font-weight': '800', 'text-align': 'center' } },
    { ...question(1, '{s:gateOne}', [12, 15, 18, 16, 9, 21], 18), when: [{ test: 'flag:g2', not: true }] },
    { ...question(2, '{s:gateTwo}', [4, 7, 5, 9, 6, 8], 6), when: [{ test: 'flag:g2' }, { test: 'flag:parent', not: true }] },
    { type: 'box', when: [{ test: 'flag:parent' }], style: { display: 'flex', 'flex-direction': 'column', width: '100%' }, children: [
      { type: 'text', text: '{s:signedInAs} {env.viewer}', style: { 'font-size': '16px', 'font-weight': '600', 'text-align': 'center', color: '$ink-soft', 'padding-bottom': '16px' } },
      { ...menuRow({ action: 'switchProfile' }, '{s:switchProfile}', 'person', 'switch-profile'), when: [{ test: 'env.canSwitchProfile' }] },
      { ...menuRow({ action: 'playlists' }, 'Playlists', 'layers', 'kids-playlists'), when: [{ test: 'env.canPlaylists' }] },
      menuRow({ action: 'openPicker' }, '{s:changeLook}', 'sparkles', 'skin-picker'),
      { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
      { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
      menuRow({ action: 'signOut' }, '{s:signOut}', 'sign-out', 'kids-sign-out'),
      { type: 'box', press: { action: 'reset' }, label: '{s:backToWatching}', style: { position: 'relative', display: 'flex', 'align-items': 'center', 'justify-content': 'center', height: '60px', 'margin-top': '6px', 'border-radius': '999px', 'background-color': '$sun', 'box-shadow': '0px 5px 0px #E8A419', 'font-size': '19px', 'font-weight': '800' },
        hover: lift, focus: ringed('0px 5px 0px #E8A419'), children: [{ type: 'text', text: '{s:backToWatching}' }] },
    ] },
  ] },
] };

// The shell sets no ground or ink of its own: routes this document does not draw yet
// (sign-in, title, libraries) keep their built-in look, and Home draws the daylight.
const shell: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', height: '100%', 'min-height': '0px', 'font-family': rounded }, children: [
  bar, dock,
  { type: 'slot', slot: 'children', style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px' },
    inner: { display: 'flex', 'flex-direction': 'column', 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' } as Style },
  gate,
] };

// ---------------------------------------------------------------- home

// Daylight behind the hero: the sky, two drifting clouds and a couple of twinkles.
const sky: Node = { type: 'box', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', height: '820px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'pointer-events': 'none', 'mask-image': 'linear-gradient(180deg, black 0%, black 72%, transparent 100%)' }, small: { height: '640px' }, children: [
  { type: 'image', src: art('sky.svg'), alt: '', style: { position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
  { type: 'image', src: art('cloud.svg'), alt: '', motion: 'floatSlow', style: { position: 'absolute', top: '128px', left: '-40px', width: '220px', height: '121px', opacity: '0.9' }, small: { top: '76px', width: '140px', height: '77px' } },
  { type: 'image', src: art('cloud.svg'), alt: '', motion: 'floatLate', style: { position: 'absolute', top: '84px', right: '9%', width: '150px', height: '83px', opacity: '0.8' }, small: { display: 'none' } },
  { type: 'image', src: art('sparkle.svg'), alt: '', motion: 'twinkle', style: { position: 'absolute', top: '146px', right: '24%', width: '26px', height: '26px' }, small: { display: 'none' } },
  { type: 'image', src: art('sparkle.svg'), alt: '', motion: 'twinkleLate', style: { position: 'absolute', top: '220px', left: '30%', width: '18px', height: '18px' } },
] };

const playButton: Node = { type: 'box', press: { action: 'play', arg: '{hero.id}' }, label: '{heroAct.actionLabel}', testId: 'hero-primary', when: [{ test: 'heroAct.playable' }],
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '14px', height: '84px', 'box-sizing': 'border-box', padding: '0px 34px 0px 10px', 'border-radius': '999px', 'background-color': '$sun', color: '$ink',
    'box-shadow': '0px 7px 0px #E8A419, 0px 22px 40px -14px rgba(10, 20, 50, 0.6)', scale: '1', translate: '0px 0px', transition: `scale 420ms ${bouncy}, translate 420ms ${bouncy}` },
  small: { height: '68px', padding: '0px 26px 0px 8px', gap: '10px' }, hover: { scale: '1.06', translate: '0px -3px' }, focus: { scale: '1.06', translate: '0px -3px', 'box-shadow': `${ring}, 0px 7px 0px #E8A419` }, children: [
    { type: 'box', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: '64px', height: '64px', 'border-radius': '999px', 'background-color': '$card' }, small: { width: '52px', height: '52px' }, children: [
      { type: 'icon', symbol: 'play-fill', style: { width: '28px', height: '28px', 'margin-left': '4px', color: '$ink' }, small: { width: '22px', height: '22px' } }] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '6px', 'align-items': 'flex-start' }, children: [
      { type: 'text', text: '{heroAct.actionLabel}', style: { 'font-size': '26px', 'font-weight': '800', 'line-height': '1' }, small: { 'font-size': '22px' } },
      { type: 'box', when: [{ test: 'heroAct.hasProgress' }], style: { width: '76px', height: '8px', 'border-radius': '4px', 'background-color': 'rgba(27, 37, 80, 0.18)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
        { type: 'box', style: { height: '8px', width: '{heroAct.progressPct}%', 'border-radius': '4px', 'background-color': '$ink' } }] },
    ] },
  ] };
const infoButton = (alone: boolean): Node => ({ type: 'box', press: { action: 'select', arg: '{hero.kindId}' }, label: '{s:moreInfo}', testId: 'hero-more', when: [{ test: 'heroAct.playable', not: alone }],
  style: { ...roundButton(alone ? 84 : 72), 'box-shadow': '0px 6px 0px rgba(27, 37, 80, 0.16), 0px 20px 36px -14px rgba(10, 20, 50, 0.6)' }, small: { width: alone ? '68px' : '60px', height: alone ? '68px' : '60px' }, hover: { scale: '1.08', translate: '0px -3px' }, focus: { scale: '1.08', 'box-shadow': ring }, children: [
    { type: 'icon', symbol: 'info', style: { width: '30px', height: '30px', color: '$ink' }, small: { width: '26px', height: '26px' } }] });

// Today's pick: a big rounded window onto the featured title, with a star sticker on its corner.
const hero: Node = { type: 'repeat', over: 'home.hero', when: [{ test: 'env.searching', not: true }], item: { type: 'box', motion: 'rise', style: { position: 'relative', ...gutter, 'padding-top': '112px' }, small: { ...gutterSmall, 'padding-top': '78px' }, children: [
  { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
  { type: 'box', style: { position: 'relative', height: 'clamp(340px, 54vh, 600px)', 'box-sizing': 'border-box', border: '8px solid #FFFFFF', 'border-radius': '48px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$sky',
    'box-shadow': '0px 12px 0px rgba(27, 37, 80, 0.07), 0px 40px 70px -28px rgba(27, 37, 80, 0.45)' }, small: { height: '440px', 'border-radius': '36px', border: '6px solid #FFFFFF' }, children: [
    { type: 'box', when: [{ test: 'hero.backdrop' }], motion: 'drift', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'transform-origin': '60% 40%' }, small: { display: 'none' }, children: [
      { type: 'image', src: '{hero.backdrop}', alt: '', fade: true, style: { position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', 'object-fit': 'cover', transition: `opacity 420ms ${soft}` } }] },
    // On a phone the window is tall: the poster fills it better than a cropped backdrop.
    { type: 'image', when: [{ test: 'env.small' }, { test: 'hero.poster' }], src: '{hero.poster}', alt: '', fade: true, style: { position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
    { type: 'image', when: [{ test: 'env.small', not: true }, { test: 'hero.backdrop', not: true }, { test: 'hero.poster' }], src: '{hero.poster}', alt: '', style: { position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', 'object-fit': 'cover', filter: 'blur(60px) saturate(1.5)' } },
    { type: 'box', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'background-image': 'linear-gradient(0deg, rgba(12, 20, 52, 0.78) 0%, rgba(12, 20, 52, 0.34) 30%, rgba(12, 20, 52, 0) 58%), linear-gradient(90deg, rgba(12, 20, 52, 0.42) 0%, rgba(12, 20, 52, 0) 50%)' } },
    { type: 'box', style: { position: 'absolute', left: '40px', right: '40px', bottom: '36px', display: 'flex', 'flex-direction': 'column', gap: '22px', 'align-items': 'flex-start' }, small: { left: '20px', right: '20px', bottom: '22px', gap: '16px' }, children: [
      { type: 'image', when: [{ test: 'hero.logo' }], src: '{hero.logo}', alt: '{hero.name}', role: 'heading', level: 1, motion: 'zoomIn', style: { height: '132px', width: 'min(460px, 80%)', 'max-width': 'min(460px, 80%)', 'object-fit': 'contain' }, small: { height: '84px' } },
      { type: 'text', when: [{ test: 'hero.logo', not: true }], text: '{hero.name}', role: 'heading', level: 1, motion: 'zoomIn', style: { 'font-size': '60px', 'font-weight': '800', 'line-height': '1', 'letter-spacing': '-0.01em', color: '#FFFFFF', 'text-shadow': '0px 4px 0px rgba(12, 20, 52, 0.35)', 'line-clamp': '2', 'max-width': '40rem' }, small: { 'font-size': '38px' } },
      // On a phone a resume title's three actions wrap rather than run out of the window.
      { type: 'box', motion: 'zoomLate', style: { display: 'flex', 'flex-direction': 'row', gap: '16px', 'align-items': 'center' }, small: { 'flex-wrap': 'wrap', gap: '12px' }, children: [playButton, infoButton(false), infoButton(true)] },
    ] },
  ] },
  { type: 'image', src: art('star.svg'), alt: '', motion: 'wobble', style: { position: 'absolute', top: '84px', right: 'calc(max(24px, 4vw) - 22px)', width: '96px', height: '96px', rotate: '12' }, small: { top: '58px', right: '2px', width: '64px', height: '64px' } },
] } };

const dotFill: Style = { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'border-radius': '8px', 'background-color': '$sun' };
const dotShape = (current: boolean): Node => ({
  type: 'box', when: [{ test: 'index.current', not: !current }],
  style: { position: 'relative', width: current ? '44px' : '16px', height: '16px', 'border-radius': '8px', 'overflow-x': 'hidden', 'overflow-y': 'hidden',
    'background-color': current ? 'rgba(27, 37, 80, 0.16)' : '$card',
    'box-shadow': current ? 'none' : 'inset 0px 0px 0px 2px rgba(27, 37, 80, 0.16)', transition: `background-color 200ms linear` },
  groupHover: { 'background-color': '$sun-soft' }, groupFocus: { 'background-color': '$sun-soft', 'box-shadow': ring },
  children: current ? [
    { type: 'box', when: [{ test: 'env.rotating' }], motion: 'heroFill', style: dotFill },
    { type: 'box', when: [{ test: 'env.rotating', not: true }], style: dotFill },
  ] : [],
});
const dot: Node = { type: 'box', group: true, press: { action: 'pickHero', arg: '{index}' }, label: '{hero.name}', a11y: { current: [{ test: 'index.current' }] },
  style: { position: 'relative', width: '44px', height: '44px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' },
  children: [dotShape(true), dotShape(false)] };
const dots: Node = { type: 'box', role: 'group', label: '{s:featured}', when: [{ test: 'env.searching', not: true }, { test: 'env.heroCount', is: 'gt', value: '1' }],
  style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'justify-content': 'center', 'padding-top': '26px' }, children: [
    { type: 'repeat', over: 'home.heroes', item: dot }] };

// A tile is a sticker: a poster in a thick white frame on a coloured block that shows as it lifts.
const tileRadius = '30px';
// The coloured block under each sticker cycles the palette along the row.
const ledges: Node[] = ['$sun', '$sky', '$coral', '$mint', '$grape'].map((colour, r) => ({ type: 'box', when: [{ test: 'index', is: 'mod', value: `5:${r}` }],
  style: { position: 'absolute', top: '10px', left: '0px', right: '0px', bottom: '-10px', 'border-radius': tileRadius, 'background-color': colour } }));
const card: Node = { type: 'box', group: true, press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', width: 'clamp(168px, 13.6vw, 264px)', 'flex-shrink': '0', gap: '16px' }, small: { width: '142px', gap: '12px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '2 / 3' }, children: [
      ...ledges,
      { type: 'box', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'box-sizing': 'border-box', border: '6px solid #FFFFFF', 'border-radius': tileRadius, 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$sky-soft',
        'box-shadow': '0px 14px 30px -16px rgba(27, 37, 80, 0.5)', scale: '1', translate: '0px 0px', rotate: '0', transition: `scale 460ms ${bouncy}, translate 460ms ${bouncy}, rotate 460ms ${bouncy}, box-shadow 300ms ${soft}` },
        small: { border: '5px solid #FFFFFF', 'border-radius': '24px' },
        groupHover: { scale: '1.04', translate: '0px -10px', rotate: '-2', 'box-shadow': '0px 26px 40px -16px rgba(27, 37, 80, 0.55)' },
        groupFocus: { scale: '1.04', translate: '0px -10px', rotate: '-2', 'box-shadow': `${ring}, 0px 26px 40px -16px rgba(27, 37, 80, 0.55)` }, children: [
          { type: 'image', when: [{ test: 'card.poster' }], src: '{card.poster}', alt: '', fade: true, style: { position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', 'object-fit': 'cover', transition: `opacity 420ms ${soft}` } },
          // No poster: the landscape art (an episode's still) cropped to the portrait frame.
          { type: 'image', when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop' }], src: '{card.backdrop}', alt: '', fade: true, style: { position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', 'object-fit': 'cover', transition: `opacity 420ms ${soft}` } },
          { type: 'box', when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop', not: true }], style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', padding: '16px', 'background-image': 'linear-gradient(160deg, #FFE59A 0%, #FFB3C7 100%)' }, children: [
            { type: 'text', text: '{card.name}', style: { 'font-size': '24px', 'font-weight': '800', 'text-align': 'center', 'line-clamp': '4', 'line-height': '1.05' }, small: { 'font-size': '19px' } }] },
          { type: 'box', when: [{ test: 'card.hasProgress' }, { test: 'card.played', not: true }], style: { position: 'absolute', left: '10px', right: '10px', bottom: '10px', height: '12px', 'border-radius': '6px', 'background-color': 'rgba(255, 255, 255, 0.88)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'box-shadow': '0px 2px 8px rgba(12, 20, 52, 0.35)' }, children: [
            { type: 'box', style: { height: '12px', width: '{card.progressPct}%', 'border-radius': '6px', 'background-color': '$coral' } }] },
          { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '10px', right: '10px', width: '36px', height: '36px', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$mint', 'box-shadow': '0px 3px 0px #22B07E' }, children: [
            { type: 'icon', symbol: 'checkmark', style: { width: '18px', height: '18px', color: '#FFFFFF' } }] },
          { type: 'box', when: [{ test: 'row.presentation', is: 'eq', value: 'ranked' }], style: { position: 'absolute', top: '10px', left: '10px', 'min-width': '44px', height: '44px', 'box-sizing': 'border-box', padding: '0px 10px', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$sun', 'box-shadow': '0px 3px 0px #E8A419', 'font-size': '22px', 'font-weight': '800', color: '$ink' }, children: [
            { type: 'text', text: '{index.label}' }] },
        ] },
    ] },
    { type: 'text', text: '{card.name}', style: { 'font-size': '17px', 'font-weight': '800', 'line-clamp': '1', 'text-align': 'center', padding: '0px 4px' }, small: { 'font-size': '15px' } },
  ] };

const rowPage = (direction: 'pagePrev' | 'pageNext'): Node => ({ type: 'box', press: { action: direction, arg: '{row.id}' },
  label: direction === 'pagePrev' ? '{t:ui.scrollBack}' : '{t:ui.scrollOn}',
  disabled: [{ test: direction === 'pagePrev' ? 'pager.atStart' : 'pager.atEnd' }],
  style: { position: 'absolute', top: '48%', [direction === 'pagePrev' ? 'left' : 'right']: 'max(8px, 1.2vw)', 'z-index': '12',
    display: 'flex', width: '50px', height: '64px', 'align-items': 'center', 'justify-content': 'center', 'border-radius': '999px',
    'background-color': '$card', 'box-shadow': ledge('rgba(27, 37, 80, 0.18)'), color: '$ink' },
  hover: lift, focus: ringed(ledge('rgba(27, 37, 80, 0.18)')), disabledStyle: { opacity: '0' }, children: [
    { type: 'icon', symbol: 'forward-chevron', style: { width: '24px', height: '24px', ...(direction === 'pagePrev' ? { rotate: '180deg' } : {}) } },
  ] });
const row: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'padding-bottom': '14px' }, children: [
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '12px', ...gutter }, small: { ...gutterSmall, gap: '10px' }, children: [
    { type: 'image', src: art('sparkle.svg'), alt: '', style: { width: '26px', height: '26px', 'flex-shrink': '0' }, small: { width: '20px', height: '20px' } },
    { type: 'text', text: '{row.name}', role: 'heading', level: 2, style: { 'font-size': '28px', 'font-weight': '800', 'letter-spacing': '-0.01em', 'line-clamp': '1' }, small: { 'font-size': '21px' } },
  ] },
  { type: 'box', pager: { inset: 24, peek: 72 }, style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '28px', 'align-items': 'flex-start', 'padding-top': '22px', 'padding-bottom': '30px', ...gutter }, small: { gap: '16px', 'padding-top': '16px', 'padding-bottom': '24px', ...gutterSmall }, children: [
      { type: 'repeat', over: 'row.items', item: { type: 'use', template: 'card', motion: 'tileIn', stagger: { step: 55, cap: 8 } } },
    ] },
  ] },
  { ...rowPage('pagePrev'), when: [{ test: 'env.small', not: true }, { test: 'pager.overflows' }] },
  { ...rowPage('pageNext'), when: [{ test: 'env.small', not: true }, { test: 'pager.overflows' }] },
] };

const home: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'min-height': '100%', 'padding-bottom': '56px', 'background-color': '$page', color: '$ink' },
  // Room under the last row for the phone dock.
  small: { 'padding-bottom': 'calc(110px + env(safe-area-inset-bottom))' }, children: [
  sky,
  hero,
  dots,
  { type: 'slot', slot: 'searchField', states: [
    { when: [{ test: 'env.heroCount', is: 'eq', value: '0' }], style: { 'padding-top': '112px' } },
    { when: [{ test: 'env.searching' }], style: { 'padding-top': '112px' } },
  ], style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'padding-top': '30px', 'padding-bottom': '10px', 'padding-left': 'max(24px, 4vw)', 'padding-right': 'max(24px, 4vw)' } as Style,
    small: { 'padding-top': '22px', 'padding-left': '16px', 'padding-right': '16px' } as Style, inner: { width: '100%', 'max-width': '640px' } },
  { type: 'box', when: [{ test: 'env.searching', not: true }], style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'padding-top': '22px' }, children: [
    { type: 'repeat', over: 'home.rows', item: { type: 'use', template: 'row', motion: 'rowIn', stagger: { step: 90, cap: 4 } } },
  ] },
] };

// ---------------------------------------------------------------- title

// A friendly full-page state: an illustration, one line, and a way back.
const restState = (load: string, picture: string, line: string, alert: boolean, more: Node[] = []): Node => ({ type: 'box', when: [{ test: 'env.load', is: 'eq', value: load }], role: alert ? 'alert' : undefined,
  style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', gap: '22px', 'min-height': '70vh', padding: '40px 24px', 'text-align': 'center' }, children: [
    { type: 'image', src: art(picture), alt: '', motion: load === 'loading' ? 'hop' : 'floatSlow', style: { width: load === 'loading' ? '96px' : '220px', height: load === 'loading' ? '96px' : '156px' } },
    { type: 'text', text: line, style: { 'font-size': '24px', 'font-weight': '800', 'max-width': '24rem' } },
    ...more,
  ] });

const backButton: Node = { type: 'box', press: { action: 'back' }, label: '{s:back}', testId: 'detail-close', style: { ...roundButton(64), position: 'absolute', top: 'calc(24px + env(safe-area-inset-top))', left: 'max(24px, 4vw)', 'z-index': '10' },
  small: { width: '52px', height: '52px', top: 'calc(14px + env(safe-area-inset-top))', left: '14px' }, hover: lift, focus: ringed(ledge('rgba(27, 37, 80, 0.10)')), children: [
    { type: 'icon', symbol: 'back', style: { width: '26px', height: '26px', color: '$ink' }, small: { width: '22px', height: '22px' } }] };

// A show plays its next episode: the first one not yet watched, with its number and name.
const upNext: Node = { type: 'repeat', over: 'detail.upNext', when: [{ test: 'detail.canPlay', not: true }], item: { type: 'box', press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}: {episode.numberTitle}', testId: 'detail-up-next',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '14px', 'align-self': 'flex-start', 'min-height': '84px', 'max-width': '30rem', 'box-sizing': 'border-box', padding: '10px 36px 10px 10px', 'border-radius': '999px', 'background-color': '$sun',
    'box-shadow': '0px 7px 0px #E8A419, 0px 22px 40px -16px rgba(27, 37, 80, 0.45)', scale: '1', translate: '0px 0px', transition: `scale 420ms ${bouncy}, translate 420ms ${bouncy}` },
  small: { 'align-self': 'stretch', 'max-width': 'none' }, hover: { scale: '1.04', translate: '0px -3px' }, focus: { scale: '1.04', 'box-shadow': `${ring}, 0px 7px 0px #E8A419` }, children: [
    { type: 'box', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: '64px', height: '64px', 'flex-shrink': '0', 'border-radius': '999px', 'background-color': '$card' }, small: { width: '54px', height: '54px' }, children: [
      { type: 'icon', symbol: 'play-fill', style: { width: '28px', height: '28px', 'margin-left': '4px', color: '$ink' } }] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '4px', 'min-width': '0px' }, children: [
      { type: 'text', text: '{episode.playLabel}', style: { 'font-size': '22px', 'font-weight': '800', 'line-height': '1.05' }, small: { 'font-size': '20px' } },
      { type: 'text', text: '{episode.numberTitle}', style: { 'font-size': '15px', 'font-weight': '700', 'line-clamp': '1', opacity: '0.8' } },
    ] },
  ] } };

const titlePlay: Node = { type: 'box', when: [{ test: 'detail.canPlay' }], press: { action: 'play', arg: '{detail.id}' }, label: '{detail.playLabel}', testId: 'detail-play',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '14px', 'align-self': 'flex-start', height: '84px', 'box-sizing': 'border-box', padding: '0px 36px 0px 10px', 'border-radius': '999px', 'background-color': '$sun',
    'box-shadow': '0px 7px 0px #E8A419, 0px 22px 40px -16px rgba(27, 37, 80, 0.45)', scale: '1', translate: '0px 0px', transition: `scale 420ms ${bouncy}, translate 420ms ${bouncy}` },
  small: { height: '72px', 'align-self': 'stretch' }, hover: { scale: '1.05', translate: '0px -3px' }, focus: { scale: '1.05', 'box-shadow': `${ring}, 0px 7px 0px #E8A419` }, children: [
    { type: 'box', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: '64px', height: '64px', 'border-radius': '999px', 'background-color': '$card' }, small: { width: '54px', height: '54px' }, children: [
      { type: 'icon', symbol: 'play-fill', style: { width: '28px', height: '28px', 'margin-left': '4px', color: '$ink' } }] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '7px', 'align-items': 'flex-start' }, children: [
      { type: 'text', text: '{detail.playLabel}', style: { 'font-size': '24px', 'font-weight': '800', 'line-height': '1' }, small: { 'font-size': '21px' } },
      { type: 'box', when: [{ test: 'detail.hasResume' }], style: { width: '96px', height: '8px', 'border-radius': '4px', 'background-color': 'rgba(27, 37, 80, 0.18)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
        { type: 'box', style: { height: '8px', width: '{detail.resumePct}%', 'border-radius': '4px', 'background-color': '$ink' } }] },
    ] },
  ] };

// Seasons as big round chips; the chosen one is sunny.
const seasonChip: Node = { type: 'repeat', over: 'detail.seasons', item: { type: 'box', press: { action: 'select', arg: '{season.pick}' }, label: '{card.name}', a11y: { selected: [{ test: 'season.on' }] }, style: { ...pill, padding: '0px 26px', height: '56px', 'font-size': '18px' },
  hover: lift, focus: ringed(ledge('rgba(27, 37, 80, 0.10)')), children: [
    { type: 'box', when: [{ test: 'season.on' }], style: { ...pillFill, 'background-color': '$sun' } },
    { type: 'text', text: '{card.name}', style: pillText },
  ] } };

// An episode is a wide sticker: its picture, a big number badge and a progress bar.
const episode: Node = { type: 'box', group: true, press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}: {episode.numberTitle}', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', gap: '12px' }, children: [
  { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '16 / 9', 'box-sizing': 'border-box', border: '6px solid #FFFFFF', 'border-radius': '28px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$sky-soft',
    'box-shadow': '0px 8px 0px rgba(27, 37, 80, 0.07), 0px 18px 30px -18px rgba(27, 37, 80, 0.5)', scale: '1', translate: '0px 0px', transition: `scale 460ms ${bouncy}, translate 460ms ${bouncy}` },
    groupHover: { scale: '1.03', translate: '0px -6px', 'box-shadow': '0px 8px 0px rgba(27, 37, 80, 0.07), 0px 22px 36px -18px rgba(27, 37, 80, 0.55)' },
    groupFocus: { scale: '1.03', translate: '0px -6px', 'box-shadow': `${ring}, 0px 22px 36px -18px rgba(27, 37, 80, 0.55)` }, children: [
      { type: 'image', when: [{ test: 'card.backdrop' }], src: '{card.backdrop}', alt: '', fade: true, style: { position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
      { type: 'image', when: [{ test: 'card.backdrop', not: true }, { test: 'card.poster' }], src: '{card.poster}', alt: '', fade: true, style: { position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
      { type: 'box', when: [{ test: 'card.episodeNumberLabel' }], style: { position: 'absolute', top: '10px', left: '10px', 'min-width': '44px', height: '44px', 'box-sizing': 'border-box', padding: '0px 10px', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$sun', 'box-shadow': '0px 3px 0px #E8A419', 'font-size': '20px', 'font-weight': '800' }, children: [
        { type: 'text', text: '{card.episodeNumberLabel}' }] },
      { type: 'box', style: { position: 'absolute', right: '12px', bottom: '12px', width: '48px', height: '48px', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$card', opacity: '0.94', 'box-shadow': '0px 4px 12px rgba(12, 20, 52, 0.3)' }, children: [
        { type: 'icon', symbol: 'play-fill', style: { width: '20px', height: '20px', 'margin-left': '3px', color: '$ink' } }] },
      { type: 'box', when: [{ test: 'card.hasProgress' }, { test: 'card.played', not: true }], style: { position: 'absolute', left: '12px', right: '72px', bottom: '28px', height: '12px', 'border-radius': '6px', 'background-color': 'rgba(255, 255, 255, 0.88)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
        { type: 'box', style: { height: '12px', width: '{card.progressPct}%', 'border-radius': '6px', 'background-color': '$coral' } }] },
      { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '10px', right: '10px', width: '36px', height: '36px', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$mint', 'box-shadow': '0px 3px 0px #22B07E' }, children: [
        { type: 'icon', symbol: 'checkmark', style: { width: '18px', height: '18px', color: '#FFFFFF' } }] },
    ] },
  { type: 'text', text: '{card.name}', style: { 'font-size': '18px', 'font-weight': '800', 'line-clamp': '1', padding: '0px 6px' }, small: { 'font-size': '16px' } },
] };

const sectionTitle = (text: string): Node => ({ type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '12px' }, children: [
  { type: 'image', src: art('sparkle.svg'), alt: '', style: { width: '24px', height: '24px', 'flex-shrink': '0' } },
  { type: 'text', text, role: 'heading', level: 2, style: { 'font-size': '28px', 'font-weight': '800' }, small: { 'font-size': '22px' } },
] });

const titleReady: Node = { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'ready' }], style: { position: 'relative', display: 'flex', 'flex-direction': 'column', gap: '34px', ...gutter, 'padding-top': '108px', 'padding-bottom': '72px' },
  small: { ...gutterSmall, 'padding-top': '78px', gap: '26px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{detail.receipt}' } },
    // The window onto the title, the same sticker frame as home's.
    { type: 'box', motion: 'rise', style: { position: 'relative' }, children: [
      { type: 'box', style: { position: 'relative', height: 'clamp(300px, 50vh, 560px)', 'box-sizing': 'border-box', border: '8px solid #FFFFFF', 'border-radius': '48px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$sky',
        'box-shadow': '0px 12px 0px rgba(27, 37, 80, 0.07), 0px 40px 70px -28px rgba(27, 37, 80, 0.45)' }, small: { height: '300px', 'border-radius': '34px', border: '6px solid #FFFFFF' }, children: [
        { type: 'image', when: [{ test: 'detail.backdrop' }], src: '{detail.backdrop}', alt: '', fade: true, style: { position: 'absolute', top: '0px', left: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'image', when: [{ test: 'detail.backdrop', not: true }, { test: 'detail.poster' }], src: '{detail.poster}', alt: '', style: { position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', 'object-fit': 'cover', filter: 'blur(60px) saturate(1.5)' } },
        { type: 'box', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'background-image': 'linear-gradient(0deg, rgba(12, 20, 52, 0.72) 0%, rgba(12, 20, 52, 0) 52%)' } },
        { type: 'box', style: { position: 'absolute', left: '40px', right: '40px', bottom: '34px', display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' }, small: { left: '20px', right: '20px', bottom: '20px' }, children: [
          { type: 'image', when: [{ test: 'detail.logo' }], src: '{detail.logo}', alt: '{detail.name}', role: 'heading', level: 1, motion: 'zoomIn', style: { height: '128px', width: '80%', 'max-width': 'min(460px, 80%)', 'object-fit': 'contain' }, small: { height: '76px' } },
          { type: 'text', when: [{ test: 'detail.logo', not: true }], text: '{detail.name}', role: 'heading', level: 1, motion: 'zoomIn', style: { 'font-size': '60px', 'font-weight': '800', 'line-height': '1', color: '#FFFFFF', 'text-shadow': '0px 4px 0px rgba(12, 20, 52, 0.35)', 'line-clamp': '2' }, small: { 'font-size': '34px' } },
        { type: 'use', template: 'velaEpisodeContext' },
        ] },
      ] },
      { type: 'image', src: art('star.svg'), alt: '', motion: 'wobble', style: { position: 'absolute', top: '-26px', right: '-22px', width: '96px', height: '96px' }, small: { top: '-18px', right: '-8px', width: '60px', height: '60px' } },
    ] },
    // Play first; then a little for the grown-ups: facts and two lines of story.
    { type: 'box', motion: 'zoomLate', style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '26px', 'align-items': 'center' }, small: { 'flex-direction': 'column', 'align-items': 'stretch', gap: '18px' }, children: [
      { type: 'box', style: { 'flex-direction': 'row', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '14px' }, children: [
        titlePlay, upNext, { type: 'widget', widget: 'titleActions' },
      ] },
      { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '8px', flex: '1', 'min-width': '16rem', 'max-width': '44rem' }, small: { 'min-width': '0px' }, children: [
        { type: 'text', text: '{detail.factsLine}', style: { 'font-size': '15px', 'font-weight': '700', color: '$ink-soft' } },

      ] },
    ] },
    { type: 'box', when: [{ test: 'detail.hasEpisodes' }], style: { display: 'flex', 'flex-direction': 'column', gap: '22px' }, children: [
      sectionTitle('{s:episodes}'),
      { type: 'box', when: [{ test: 'detail.hasSeasons' }], role: 'group', label: '{s:seasons}', style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '14px' }, children: [seasonChip] },
      { type: 'box', style: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(300px, 1fr))', gap: '30px' }, small: { 'grid-template-columns': '1fr', gap: '22px' }, children: [
        { type: 'repeat', over: 'detail.episodes', item: { ...episode, motion: 'tileIn', stagger: { step: 45, cap: 10 } } },
      ] },
    ] },
    { type: 'box', when: [{ test: 'detail.hasMediaFacts' }], style: { display: 'flex', 'flex-direction': 'column', gap: '14px' }, children: [
      sectionTitle('{s:details}'),
      { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '10px' }, children: [
        { type: 'repeat', over: 'detail.mediaFacts', item: { type: 'text', text: '{fact.text}', style: { padding: '8px 14px', 'border-radius': '999px', 'background-color': '$card', 'font-weight': '800' } } },
      ] },
    ] },
    { type: 'box', when: [{ test: 'detail.summary' }], style: { display: 'flex', 'flex-direction': 'column', gap: '12px' }, children: [
      sectionTitle('{s:behindStory}'), { type: 'use', template: 'velaSummary', style: { 'font-size': '17px', 'font-weight': '700', 'line-height': '1.5', color: '$ink-soft' } },
      { type: 'text', when: [{ test: 'detail.crewLine' }], text: '{detail.crewLine}', style: { 'font-size': '15px', 'font-weight': '700', color: '$ink-soft' } },
    ] },
    { type: 'box', when: [{ test: 'detail.hasCast' }], style: { display: 'flex', 'flex-direction': 'column', gap: '16px' }, children: [
      sectionTitle('{s:cast}'),
      { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '16px', 'overflow-x': 'auto', 'overflow-y': 'hidden', padding: '6px' }, children: [
        { type: 'repeat', over: 'detail.cast', item: { type: 'box', press: { action: 'person', arg: '{person.name}' }, label: '{person.name}', focus: { 'box-shadow': '0px 0px 0px 4px $ui.accent' },  style: { width: '120px', 'flex-shrink': '0', display: 'flex', 'flex-direction': 'column', gap: '8px' }, children: [
          { type: 'box', style: { position: 'relative', width: '96px', height: '96px', 'border-radius': '48px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$sky-soft', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }, children: [
            { type: 'image', when: [{ test: 'person.portrait' }], src: '{person.portrait}', alt: '', style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
            { type: 'text', when: [{ test: 'person.portrait', not: true }], text: '{person.initials}', style: { 'font-size': '26px', 'font-weight': '800' } },
          ] },
          { type: 'text', text: '{person.name}', style: { 'font-weight': '800' } }, { type: 'text', when: [{ test: 'person.role' }], text: '{person.role}', style: { color: '$ink-soft' } },
        ] } },
      ] },
    ] },
    { type: 'box', when: [{ test: 'detail.hasExtras' }], style: { display: 'flex', 'flex-direction': 'column', gap: '16px' }, children: [
      sectionTitle('{s:extras}'), { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '14px', 'overflow-x': 'auto', 'overflow-y': 'hidden' }, children: [
        { type: 'repeat', over: 'detail.extras', item: { type: 'box', style: { 'flex-shrink': '0' }, children: [
          { type: 'box', press: { action: 'playExtra', arg: '{extra.id}' }, when: [{ test: 'extra.ready' }], label: '{extra.name}', style: { padding: '18px 24px', 'border-radius': '24px', 'background-color': '$sun' }, children: [{ type: 'text', text: '{extra.name}', style: { 'font-weight': '800' } }] },
          { type: 'text', when: [{ test: 'extra.ready', not: true }], text: '{extra.name}', style: { padding: '18px 24px', 'border-radius': '24px', 'background-color': '$card', color: '$ink-soft', 'font-weight': '800' } },
        ] } },
      ] },
    ] },
    { type: 'box', when: [{ test: 'detail.hasRelated' }], style: { display: 'flex', 'flex-direction': 'column', gap: '4px', margin: '0px calc(-1 * max(24px, 4vw))' }, small: { margin: '0px -16px' }, children: [
      { type: 'box', style: { ...gutter }, small: { ...gutterSmall }, children: [sectionTitle('{s:moreLikeThis}')] },
      { type: 'box', style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
        { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '28px', 'align-items': 'flex-start', 'padding-top': '22px', 'padding-bottom': '30px', ...gutter }, small: { gap: '16px', ...gutterSmall }, children: [
          { type: 'repeat', over: 'detail.related', item: { type: 'use', template: 'card', motion: 'tileIn', stagger: { step: 55, cap: 8 } } },
        ] },
      ] },
    ] },
  ] };

const title: Node = { type: 'box', style: { position: 'absolute', inset: '0px', display: 'flex', 'flex-direction': 'column', 'background-color': '$page', color: '$ink', 'font-family': rounded }, children: [
  backButton,
  { type: 'box', id: '{env.route}-scroll-{env.entry}', role: 'region', label: '{detail.name}', style: { position: 'relative', flex: '1', 'min-height': '0px', 'overflow-y': 'auto', 'overflow-x': 'hidden' }, children: [
    { type: 'image', src: art('sky.svg'), alt: '', style: { position: 'absolute', top: '0px', left: '0px', width: '100%', height: '560px', 'object-fit': 'cover', 'pointer-events': 'none', 'mask-image': 'linear-gradient(180deg, black 0%, black 60%, transparent 100%)' } },
    restState('loading', 'star.svg', '{s:opening}', false),
    restState('failed', 'sleepy.svg', '{env.loadMessage}', true, [
      { type: 'box', when: [{ test: 'env.canRetry' }], press: { action: 'retry' }, label: '{s:tryAgain}', style: { position: 'relative', display: 'flex', 'align-items': 'center', height: '60px', padding: '0px 30px', 'border-radius': '999px', 'background-color': '$sun', 'box-shadow': '0px 5px 0px #E8A419', 'font-size': '19px', 'font-weight': '800' },
        hover: lift, focus: ringed('0px 5px 0px #E8A419'), children: [{ type: 'text', text: '{s:tryAgain}' }] }]),
    titleReady,
  ] },
] };

const calm = { keyframes: 'dissolve', duration: 220 };
const kids: SkinDocument = {
  schema: 1, renderer: 16, id: 'kids', name: 'Kids', version, tagline: 'Big bright tiles, three simple ways in, and a grown-ups corner.',
  preview: art('preview.jpg'), swatches: ['#FFF8EE', '#1B2550', '#FFC93C', '#3FA9F5', '#FF6B57'],
  // Kids' cream, navy ink and a deep sky accent (readable as text on cream; the sun stays a fill),
  // for the routes it inherits (search, library, collection, sign-in).
  ui: {
    page: '#fff8ee', raised: '#ffffff', ink: '#1b2550', inkSecondary: '#4a5580', inkQuiet: '#6e78a0',
    inkInverse: '#ffffff', inkHover: '#2b3a78', accent: '#1f7fc4', onAccent: '#ffffff', control: '#fff3df',
    controlHover: '#ffe59a', glass: '#ffffffd9', glassEdge: '#1b25501f', glassEdgeStrong: '#1b255038',
    popover: '#fffffff7', scrim: '#1b255080', track: '#1b25501f', trackStrong: '#1b255038',
    focusHalo: '#3fa9f540', shadow: '#1b255029', skeleton: '#fff3df', skeletonLight: '#ffffff',
    alert: '#ff6b5726', live: '#ff6b57',
    font: '"Kids Nunito", ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif',
    fontDisplay: '"Kids Nunito", ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif',
    radiusControl: 999, radiusCard: 20, radiusPanel: 28,
  },
  tokens: {
    page: '#FFF8EE', card: '#FFFFFF', cream: '#FFF3DF', ink: '#1B2550', 'ink-soft': '#4A5580',
    sun: '#FFC93C', 'sun-soft': '#FFE59A', sky: '#3FA9F5', 'sky-soft': '#D6EEFF', coral: '#FF6B57', mint: '#3DD6A0', grape: '#9B82FF',
  },
  fonts: { rounded: { family: 'Kids Nunito', files: [{ url: art('nunito.woff2'), weight: '200 1000', style: 'normal' }] } },
  strings: { en: {
    velaHome: 'Vela home', mainNav: 'Main', watch: 'Watch', search: 'Search', grownUps: 'Grown-ups', tryAgain: 'Try again', close: 'Close',
    gateOne: 'What is 6 × 3?', gateTwo: 'And 14 − 8?', signedInAs: 'Watching as', changeLook: 'Change the look',
    install: 'Install Vela', update: 'Update ready, reload', switchProfile: 'Switch profile', signOut: 'Sign out', backToWatching: 'Back to watching',
    moreInfo: 'More info', featured: 'Featured', back: 'Back', opening: 'Getting it ready…', failed: 'Oops, this one won’t open right now.',
    episodes: 'Episodes', seasons: 'Seasons', details: 'Details', behindStory: 'Behind the story', cast: 'Cast', extras: 'Extras', moreLikeThis: 'More like this',
  } },
  motion: {
    rise: { keyframes: 'rise', duration: 700, easing: soft, fill: 'both', still: calm },
    rowIn: { keyframes: 'rise', duration: 640, delay: 260, easing: soft, fill: 'both', still: calm },
    tileIn: { keyframes: 'zoom', duration: 560, delay: 320, easing: bouncy, fill: 'both', still: calm },
    zoomIn: { keyframes: 'zoom', duration: 620, delay: 240, easing: bouncy, fill: 'both', still: calm },
    zoomLate: { keyframes: 'zoom', duration: 620, delay: 380, easing: bouncy, fill: 'both', still: calm },
    popIn: { keyframes: 'zoom', duration: 480, easing: bouncy, fill: 'both', still: { keyframes: 'dissolve', duration: 160 } },
    fade: { keyframes: 'dissolve', duration: 220, easing: 'ease-out', still: { keyframes: 'dissolve', duration: 120 } },
    drift: { keyframes: 'drift', duration: 30000, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', iterations: 'infinite', direction: 'alternate', fill: 'none', still: { keyframes: 'none', duration: 0 } },
    heroFill: { keyframes: 'fill', duration: 9000, easing: 'linear', still: { keyframes: 'none', duration: 0 } },
    floatSlow: { keyframes: 'float', duration: 7000, easing: 'ease-in-out', iterations: 'infinite', fill: 'none', still: { keyframes: 'none', duration: 0 } },
    floatLate: { keyframes: 'float', duration: 9000, delay: 1400, easing: 'ease-in-out', iterations: 'infinite', fill: 'none', still: { keyframes: 'none', duration: 0 } },
    twinkle: { keyframes: 'twinkle', duration: 2600, easing: 'ease-in-out', iterations: 'infinite', fill: 'none', still: { keyframes: 'none', duration: 0 } },
    twinkleLate: { keyframes: 'twinkle', duration: 3400, delay: 900, easing: 'ease-in-out', iterations: 'infinite', fill: 'none', still: { keyframes: 'none', duration: 0 } },
    hop: { keyframes: 'bounce', duration: 1100, easing: 'ease-in-out', iterations: 'infinite', fill: 'none', still: { keyframes: 'breathe', duration: 2400 } },
    wobble: { keyframes: 'wiggle', duration: 5200, delay: 1200, easing: 'ease-in-out', iterations: 'infinite', fill: 'none', still: { keyframes: 'none', duration: 0 } },
  },
  templates: { card, row },
  slots: { shell, home },
  routes: { title: episodePage(title) },
  detail: { wide: 'fullscreen', small: 'fullscreen' },
};
export default kids;

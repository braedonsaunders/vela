// Jelly Twin as a skin document (protocol/v0/skin.ts): a familiar home-media client,
// near-black with cyan accents and card rows. It reproduces the compiled skin it replaces
// node for node: the header with section tabs and a slide-in drawer, the featured banner,
// My Media tiles, poster and wide-thumbnail rows, and the flat title page.
import type { Action, Condition, Node, SkinDocument, Style } from '../../../skin';

type Press = { action: Action; arg?: string };

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
// A solid border on every side. The top and bottom are written out too: the renderer binds them
// separately, and an unset side would reset to the browser default instead of following `border`.
const edge = (width: string, color: string): Style => ({ border: `${width} solid ${color}`, 'border-top-width': width, 'border-top-color': color, 'border-bottom-width': width, 'border-bottom-color': color });
// A bottom hairline (the other sides stay unbordered).
const hairline: Style = { 'border-width': '0px', 'border-style': 'solid', 'border-top-width': '0px', 'border-bottom-width': '1px', 'border-bottom-color': '$line' };

// Glyphs: platform symbols, and the skin's own line icons for kinds and transport.
const glyph = (symbol: string, size: number, extra: Partial<Node> = {}): Node => ({ type: 'icon', symbol, style: { width: `${size}px`, height: `${size}px`, 'flex-shrink': '0' }, ...extra } as Node);
const jelly = (name: string) => `icon.jelly-${name}`;
// A library or title kind's glyph, one icon node per kind (only the matching one shows).
const kindGlyphs = (key: string, size: number, style: Style = {}): Node[] => [
  { ...glyph(jelly('film'), size), when: [{ test: key, is: 'eq', value: 'movies' }] },
  { ...glyph(jelly('film'), size), when: [{ test: key, is: 'eq', value: 'movie' }] },
  ...['shows', 'show', 'season', 'episode'].map(k => ({ ...glyph(jelly('tv'), size), when: [{ test: key, is: 'eq', value: k }] } as Node)),
  { ...glyph(jelly('live'), size), when: [{ test: key, is: 'eq', value: 'live' }] },
  { ...glyph(jelly('folder'), size), when: ['movies', 'movie', 'shows', 'show', 'season', 'episode', 'live'].map(k => ({ test: key, is: 'ne' as const, value: k })) },
].map(n => ({ ...n, style: { ...n.style, ...style } } as Node));

// The placeholder tile colour, stable per identity (id length mod 5).
const tile = (seed: string, extra: Style = {}): Node[] => [1, 2, 3, 4, 5].map(i => ({ type: 'box', when: [{ test: seed, is: 'mod', value: `5:${i - 1}` }], style: { ...fill, 'background-color': `$tile-${i}`, ...extra } } as Node));

// The shared control looks (look.contract).
const iconBtn = (size: number): Style => ({ position: 'relative', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', 'flex-shrink': '0', width: `${size}px`, height: `${size}px`, padding: '0px', 'border-radius': '999px', 'background-color': 'transparent', color: '$ink-strong', cursor: 'pointer', transition: 'background-color 160ms linear, color 160ms linear' });
const iconBtnHover: Style = { color: '$accent', 'background-color': '$accent-soft' };
const menuRow: Style = { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '14px', 'box-sizing': 'border-box', width: '100%', 'min-height': '44px', padding: '0px 16px', 'border-radius': '4px', 'background-color': 'transparent', color: '$ink-strong', 'font-size': '15px', 'text-align': 'left', cursor: 'pointer' };
const submit: Style = { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'justify-content': 'center', gap: '10px', 'box-sizing': 'border-box', height: '46px', padding: '0px 20px', 'border-radius': '4px', 'background-color': '$accent', color: '$ink-strong', 'font-size': '15px', 'font-weight': '600', cursor: 'pointer' };
const submitFocus: Style = { 'box-shadow': '0px 0px 0px 2px $page, 0px 0px 0px 4px $accent' };
const tab: Style = { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'box-sizing': 'border-box', height: '40px', padding: '0px 14px', 'background-color': 'transparent', color: '$ink', 'font-size': '15px', 'white-space': 'nowrap', 'flex-shrink': '0', cursor: 'pointer' };
const sheet: Style = { 'box-sizing': 'border-box', padding: '8px 0px', 'border-radius': '6px', 'background-color': '$popup', color: '$ink-strong', 'box-shadow': '0px 12px 40px $shadow' };
const initial = (size: number, font: number): Node => ({ type: 'text', text: '{env.viewerInitial}', style: { width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-size': `${font}px`, 'font-weight': '600', color: '$ink-strong', 'background-image': gradient, 'flex-shrink': '0' } });
const wordmark: Node = { type: 'image', src: 'assets/brand/vela-lockup.svg', alt: '', style: { width: `${28 * 2.629}px`, height: '28px', 'flex-shrink': '0' } };
const underline = (bottom: number): Node => ({ type: 'box', style: { position: 'absolute', left: '12px', right: '12px', bottom: `${bottom}px`, height: '3px', 'border-radius': '2px', 'background-image': gradient } });
// The indeterminate spinner: an accent arc turning on a faint ring.
const spinner = (size: number, extra: Partial<Node> = {}): Node => ({ type: 'box', motion: 'spin', style: { width: `${size}px`, height: `${size}px`, 'box-sizing': 'border-box', 'flex-shrink': '0', 'border-radius': '999px', ...edge('3px', '$track'), 'border-top-color': '$accent' }, ...extra } as Node);

// ---------------------------------------------------------------- Shell

// A section tab in the header: Home, each library, Live TV.
const sectionTab = (label: string, on: Condition, press: Press, when: Condition[] = []): Node => ({
  type: 'box', press, label, role: 'tab', testId: `nav-${label}`, when,
  style: tab, hover: { color: '$accent' }, focus: { color: '$accent' },
  children: [
    // The selected tab: accent and semibold, with the gradient bar.
    { type: 'text', text: label, when: [on], style: { color: '$accent', 'font-weight': '600' } },
    { type: 'text', text: label, when: [{ ...on, not: true }] },
    { ...underline(2), when: [on] },
  ] });
// The tab list scrolls sideways when it overflows; spacers centre it when it does not.
const sections = (style: Style, small: Style | undefined): Node => ({ type: 'box', role: 'tablist', label: '{s:sections}', style: row({ 'align-items': 'center', 'min-width': '0px', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', ...style }), small, children: [
  { type: 'box', style: { flex: '1' } },
  sectionTab('{s:home}', { test: 'env.section', is: 'eq', value: 'home' }, { action: 'home' }),
  { type: 'repeat', over: 'nav.destinations', item: { type: 'box', style: row({ 'flex-shrink': '0' }), children: [
    sectionTab('{dest.name}', { test: 'env.section', is: 'eq', value: 'live' }, { action: 'live' }, [{ test: 'dest.kind', is: 'eq', value: 'live' }, { test: 'env.canLive' }]),
    sectionTab('{dest.name}', { test: 'dest.on' }, { action: 'library', arg: '{dest.id}' }, [{ test: 'dest.kind', is: 'ne', value: 'live' }]),
  ] } },
  { type: 'box', style: { flex: '1' } },
] });

const header: Node = { type: 'box', role: 'navigation', label: '{s:mainNavigation}', when: [{ test: 'env.viewer' }],
  style: col({ position: 'relative', 'flex-shrink': '0', 'z-index': '20', 'background-color': '$header', 'backdrop-filter': 'blur(12px)', 'box-shadow': '0px 2px 6px $shadow' }), children: [
    { type: 'box', style: row({ height: '58px', 'box-sizing': 'border-box', 'padding-left': '10px', 'padding-right': '14px', 'align-items': 'center', gap: '6px' }),
      small: { height: '52px', 'padding-left': '4px', 'padding-right': '6px', gap: '2px' }, children: [
        { type: 'box', press: { action: 'open', arg: 'drawer' }, label: '{s:openMenu}', testId: 'jt-menu', style: iconBtn(44), hover: iconBtnHover, focus: iconBtnHover, children: [glyph('menu', 24)] },
        { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', style: { position: 'relative', padding: '0px 8px', 'flex-shrink': '0', color: '$ink-strong' }, children: [wordmark] },
        sections({ flex: '1' }, { display: 'none' }),
        { type: 'box', style: { display: 'none' }, small: { display: 'flex', flex: '1' } },
        { type: 'box', press: { action: 'search' }, label: '{s:search}', testId: 'jt-search-button', style: iconBtn(44), hover: iconBtnHover, focus: iconBtnHover, children: [glyph('search', 23)] },
        { type: 'box', press: { action: 'toggle', arg: 'menu' }, label: '{s:profile}', testId: 'profile-menu', style: iconBtn(44), hover: iconBtnHover, focus: iconBtnHover, children: [initial(30, 14)] },
      ] },
    // On a phone the tabs take their own line under the bar, centred.
    sections({ display: 'none' }, { display: 'flex', 'padding-left': '6px', 'padding-right': '6px' }),
  ] };

const userMenu: Node[] = [
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:menu' }], press: { action: 'close', arg: 'menu' }, label: '{s:close}', style: { ...fill, 'z-index': '29', 'background-color': 'transparent' } },
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:menu' }], role: 'dialog', label: '{s:profile}', motion: 'pop',
    style: { ...sheet, ...col({ position: 'absolute', top: '56px', right: '14px', 'z-index': '30', width: '260px', padding: '8px', gap: '4px', 'transform-origin': 'top right' }) }, small: { top: '50px', right: '8px' }, children: [
      { type: 'box', style: row({ gap: '12px', 'align-items': 'center', padding: '10px 12px 12px' }), children: [
        initial(40, 17),
        { type: 'text', text: '{env.viewer}', style: { 'font-size': '16px', 'font-weight': '600', flex: '1', 'min-width': '0px', 'line-clamp': '1' } },
      ] },
      { type: 'box', style: { height: '1px', 'background-color': '$line', margin: '0px 8px 6px' } },
      { type: 'box', press: { action: 'openPicker' }, label: '{s:appearance}', testId: 'skin-picker', style: menuRow, hover: { 'background-color': '$hover' }, focus: { 'background-color': '$hover' }, children: [
        glyph('sparkles', 20), { type: 'text', text: '{s:appearance}' },
      ] },
      { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
      { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
      { type: 'box', press: { action: 'signOut' }, label: '{s:signOut}', style: menuRow, hover: { 'background-color': '$hover' }, focus: { 'background-color': '$hover' }, children: [
        glyph('sign-out', 20), { type: 'text', text: '{s:signOut}' },
      ] },
    ] },
];

// A drawer entry: its glyph and name, accent on a soft accent ground when current.
const drawerItem = (label: string, glyphs: Node[], on: Condition | undefined, press: Press, when: Condition[] = []): Node => {
  const content = (color: string, when: Condition[]): Node => ({ type: 'box', when, style: row({ position: 'relative', 'align-items': 'center', gap: '18px', color, 'min-width': '0px' }), children: [...glyphs, { type: 'text', text: label, style: { 'font-size': '15px', 'line-clamp': '1' } }] });
  return { type: 'box', press, label, when, style: { ...menuRow, 'border-radius': '0px', padding: '0px 20px', 'min-height': '48px', gap: '18px' },
    hover: { 'background-color': '$hover' }, focus: { 'background-color': '$hover' },
    children: on ? [{ type: 'box', when: [on], style: { ...fill, 'background-color': '$accent-soft' } }, content('$accent', [on]), content('$ink-strong', [{ ...on, not: true }])] : [content('$ink-strong', [])] };
};
const drawerHeading = (text: string, when: Condition[] = []): Node => ({ type: 'text', text, when, style: { 'font-size': '13px', 'font-weight': '600', color: '$secondary', padding: '16px 20px 6px' } });

const drawer: Node[] = [
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:drawer' }], press: { action: 'close', arg: 'drawer' }, label: '{s:closeMenu}', motion: 'scrimIn', style: { ...fill, 'z-index': '40', 'background-color': '$overlay' } },
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:drawer' }], role: 'dialog', label: '{s:menu}', motion: 'drawerIn',
    style: col({ position: 'absolute', top: '0px', left: '0px', bottom: '0px', 'z-index': '40', width: '300px', 'overflow-y': 'auto', 'overflow-x': 'hidden', 'background-color': '$drawer', 'box-shadow': '4px 0px 24px $shadow' }), small: { width: 'min(300px, 84vw)' }, children: [
      { type: 'box', style: col({ 'padding-bottom': '24px' }), children: [
        { type: 'box', style: row({ height: '58px', 'align-items': 'center', 'padding-left': '18px', gap: '10px', ...hairline, 'margin-bottom': '8px', 'flex-shrink': '0' }), small: { height: '52px' }, children: [wordmark] },
        drawerItem('{s:home}', [glyph('home', 22)], { test: 'env.section', is: 'eq', value: 'home' }, { action: 'home' }),
        drawerHeading('{s:media}'),
        { type: 'repeat', over: 'nav.destinations', item: { type: 'box', style: col(), children: [
          drawerItem('{dest.name}', [glyph(jelly('live'), 22)], { test: 'env.section', is: 'eq', value: 'live' }, { action: 'live' }, [{ test: 'dest.kind', is: 'eq', value: 'live' }, { test: 'env.canLive' }]),
          drawerItem('{dest.name}', kindGlyphs('dest.kind', 22), { test: 'dest.on' }, { action: 'library', arg: '{dest.id}' }, [{ test: 'dest.kind', is: 'ne', value: 'live' }]),
        ] } },
        drawerHeading('{s:user}'),
        { type: 'box', style: row({ gap: '12px', 'align-items': 'center', padding: '6px 20px 10px' }), children: [
          glyph('person', 22), { type: 'text', text: '{env.viewer}', style: { 'font-size': '15px', 'line-clamp': '1' } },
        ] },
        drawerItem('{s:appearance}', [glyph('sparkles', 22)], undefined, { action: 'openPicker' }),
        drawerItem('{s:signOut}', [glyph('sign-out', 22)], undefined, { action: 'signOut' }),
      ] },
    ] },
];

const shell: Node = { type: 'box', style: col({ height: '100%', 'min-height': '0px', 'background-color': '$page', color: '$ink', 'font-family': sans }), children: [
  header,
  { type: 'slot', slot: 'children', style: col({ flex: '1', 'min-height': '0px' }), inner: col({ 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' }) },
  ...userMenu,
  ...drawer,
] };

// ---------------------------------------------------------------- Cards and rows

// The card every row draws: artwork with the played mark and progress, the name and its subline.
const card = (wide: boolean): Node => {
  const art = wide ? ['card.backdrop', 'card.poster'] : ['card.poster', 'card.backdrop'];
  const noArt = [{ test: 'card.poster', not: true }, { test: 'card.backdrop', not: true }];
  return { type: 'box', style: col({ position: 'relative', width: wide ? 'clamp(240px, 21.5vw, 400px)' : 'clamp(128px, 11.6vw, 220px)', 'flex-shrink': '0', gap: '1px', 'align-items': 'center', 'text-align': 'center' }),
    small: { width: wide ? '62vw' : '31vw' }, children: [
      { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
      { type: 'box', group: true, press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
        style: { position: 'relative', width: '100%', 'aspect-ratio': wide ? '16 / 9' : '2 / 3', 'border-radius': '5px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', color: '$ink-strong', cursor: 'pointer', 'background-color': '$card', 'box-shadow': '0px 2px 6px $shadow', filter: 'none', transition: 'box-shadow 140ms linear' },
        groupHover: { 'box-shadow': '0px 0px 0px 3px $accent', filter: 'brightness(0.75)' }, children: [
          ...tile('card.id', { 'z-index': '0' }).map(t => ({ ...t, when: [...(t.when ?? []), ...noArt] } as Node)),
          { type: 'image', when: [{ test: art[0] }], src: `{${art[0]}}`, alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
          { type: 'image', when: [{ test: art[0], not: true }, { test: art[1] }], src: `{${art[1]}}`, alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
          { type: 'box', when: noArt, style: { position: 'absolute', top: '34%', left: '34%', width: '32%', height: '32%', color: '$secondary' }, children: kindGlyphs('card.kind', 0, { width: '100%', height: '100%' }) },
          { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '6px', right: '6px', width: '24px', height: '24px', 'border-radius': '12px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$accent', color: '$ink-strong' }, children: [glyph('checkmark', 14)] },
          { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '5px', 'background-color': '$overlay', 'background-image': 'linear-gradient(90deg, $accent {card.progressPct}%, transparent 0%)' } },
        ] },
      { type: 'text', text: '{card.name}', style: { width: '100%', 'margin-top': '6px', 'font-size': '14px', 'font-weight': '500', color: '$ink-strong', 'line-clamp': '1' } },
      // The year, else the facts.
      { type: 'text', when: [{ test: 'card.yearLabel' }], text: '{card.yearLabel}', style: subline },
      { type: 'text', when: [{ test: 'card.yearLabel', not: true }], text: '{card.facts}', style: subline },
    ] };
};
const subline: Style = { width: '100%', 'min-height': '1.3em', 'font-size': '13px', color: '$secondary', 'line-clamp': '1', 'font-variant-numeric': 'tabular-nums' };

// A section: its heading, then one line of cards.
const section = (items: string, heading: Node): Node => ({ type: 'box', style: col({ gap: '8px', 'padding-bottom': '26px' }), small: { gap: '6px', 'padding-bottom': '18px' }, children: [
  { type: 'box', style: row({ 'align-items': 'center', gap: '8px', ...side, 'min-height': '40px' }), small: sideSmall, children: [heading] },
  { type: 'box', style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }), children: [
    { type: 'box', style: row({ gap: '16px', 'align-items': 'flex-start', 'padding-top': '4px', 'padding-bottom': '6px', ...side }), small: { gap: '10px', ...sideSmall }, children: [
      { type: 'repeat', over: items, item: { type: 'use', template: 'poster' } },
    ] },
  ] },
] });
const sectionTitle = (text: string): Node => ({ type: 'text', text, role: 'heading', level: 2, style: { flex: '1', 'min-width': '0px', 'font-size': '20px', 'font-weight': '600', color: '$ink-strong', 'line-clamp': '1' } });

// ---------------------------------------------------------------- Home

// The featured banner: full-bleed artwork, the logo or name, facts, the overview and dots.
const mediaBar: Node = { type: 'repeat', over: 'home.hero', when: [{ test: 'env.searching', not: true }], item: {
  type: 'box', motion: 'fadeIn', style: col({ position: 'relative', height: 'min(54vh, 500px)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'margin-bottom': '22px', 'flex-shrink': '0' }),
  small: { height: '300px', 'margin-bottom': '14px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
    { type: 'image', when: [{ test: 'hero.backdrop' }], src: '{hero.backdrop}', alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
    { type: 'box', when: [{ test: 'hero.backdrop', not: true }], style: fill, children: tile('hero.id') },
    { type: 'box', style: { ...fill, 'background-image': 'linear-gradient(90deg, $scrim 0%, $scrim-clear 65%), linear-gradient(0deg, $page 0%, $scrim-clear 45%)' } },
    { type: 'box', style: col({ position: 'relative', height: '100%', 'justify-content': 'flex-end', 'box-sizing': 'border-box', ...side, 'padding-bottom': '34px', gap: '12px', 'max-width': '48rem' }),
      small: { ...sideSmall, 'padding-bottom': '18px', gap: '8px', 'max-width': 'none' }, children: [
        { type: 'image', when: [{ test: 'hero.logo' }], src: '{hero.logo}', alt: '{hero.name}', role: 'heading', level: 1, style: { height: '120px', width: 'auto', 'max-width': '80%', 'object-fit': 'contain', 'align-self': 'flex-start' }, small: { height: '64px' } },
        { type: 'text', when: [{ test: 'hero.logo', not: true }], text: '{hero.name}', role: 'heading', level: 1, style: { 'font-size': '46px', 'font-weight': '700', color: '$ink-strong', 'line-clamp': '2', 'text-shadow': '0px 2px 12px $shadow' }, small: { 'font-size': '28px' } },
        { type: 'box', style: row({ gap: '14px', 'align-items': 'center', 'flex-wrap': 'wrap' }), children: [
          { type: 'text', when: [{ test: 'hero.yearLabel' }], text: '{hero.yearLabel}', style: { 'font-size': '14px', color: '$ink-strong' } },
          { type: 'text', when: [{ test: 'hero.rating' }], text: '{hero.rating}', style: { 'font-size': '12px', padding: '1px 6px', ...edge('1px', '$secondary'), 'border-radius': '3px', color: '$ink' } },
        ] },
        { type: 'text', when: [{ test: 'hero.summary' }, { test: 'env.small', not: true }], text: '{hero.summary}', style: { 'font-size': '15px', 'line-height': '1.5', color: '$ink', 'line-clamp': '3', 'max-width': '40rem' } },
        { type: 'box', style: row({ gap: '10px', 'margin-top': '4px' }), children: [
          { type: 'box', press: { action: 'select', arg: '{hero.kindId}' }, label: '{hero.name}', style: { ...submit, height: '44px' }, small: { height: '40px' }, hover: { opacity: '0.9' }, focus: submitFocus, children: [
            glyph('info', 19), { type: 'text', text: '{s:moreInfo}' },
          ] },
        ] },
      ] },
    { type: 'box', when: [{ test: 'env.heroCount', is: 'gt', value: '1' }], role: 'group', label: '{s:featured}', style: row({ position: 'absolute', right: '3.3%', bottom: '38px', gap: '8px' }), small: { right: '14px', bottom: '22px' }, children: [
      { type: 'repeat', over: 'home.heroes', item: { type: 'box', style: row(), children: [
        { type: 'box', when: [{ test: 'index.current' }], press: { action: 'pickHero', arg: '{index}' }, label: '{s:featuredOf}', style: { position: 'relative', width: '22px', height: '9px', 'border-radius': '5px', cursor: 'pointer', 'background-color': '$accent', 'background-image': gradient }, focus: { 'box-shadow': '0px 0px 0px 2px $ink-strong' } },
        { type: 'box', when: [{ test: 'index.current', not: true }], press: { action: 'pickHero', arg: '{index}' }, label: '{s:featuredOf}', style: { position: 'relative', width: '9px', height: '9px', 'border-radius': '5px', cursor: 'pointer', 'background-color': '$track' }, focus: { 'box-shadow': '0px 0px 0px 2px $ink-strong' } },
      ] } },
    ] },
  ] } };

const home: Node = { type: 'box', style: col({ 'padding-bottom': '40px', color: '$ink', 'font-family': sans }), children: [
  { type: 'slot', slot: 'searchField', style: col() },
  mediaBar,
  { type: 'box', when: [{ test: 'env.searching', not: true }, { test: 'env.heroCount', is: 'eq', value: '0' }], style: { height: '22px', 'flex-shrink': '0' }, small: { height: '14px' } },
  { type: 'repeat', over: 'home.rows', when: [{ test: 'env.searching', not: true }], item: section('row.items', sectionTitle('{row.name}')) },
  { type: 'box', when: [{ test: 'env.searching', not: true }, { test: 'env.rowCount', is: 'eq', value: '0' }, { test: 'env.heroCount', is: 'eq', value: '0' }], role: 'status',
    style: col({ 'align-items': 'center', 'text-align': 'center', gap: '10px', padding: '64px 24px', color: '$secondary' }), children: [
      glyph(jelly('folder'), 44),
      { type: 'text', text: '{s:nothingHere}', style: { 'margin-top': '6px', 'font-size': '20px', 'font-weight': '600', color: '$ink-strong' } },
      { type: 'text', text: '{s:noRows}', style: { 'max-width': '30rem', 'font-size': '15px', 'line-height': '1.5' } },
    ] },
] };

// ---------------------------------------------------------------- Title

const heading2: Style = { 'font-size': '21px', 'font-weight': '600', color: '$ink-strong' };
const heading2Small: Style = { 'font-size': '17px' };
const block: Style = col({ 'padding-bottom': '26px' });

// A round action under the title: the play circle carries the gradient.
const roundAction = (label: string, symbol: string, primary: boolean, press: Press, testId: string, when: Condition[] = []): Node => ({
  type: 'box', press, label, testId, when, style: col({ position: 'relative', 'align-items': 'center', gap: '6px', padding: '0px', 'border-radius': '8px', color: '$ink-strong', cursor: 'pointer' }),
  hover: { opacity: '0.88' }, focus: { 'box-shadow': '0px 0px 0px 2px $accent' }, children: [
    { type: 'box', style: { width: '58px', height: '58px', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', 'box-shadow': '0px 4px 14px $shadow',
      ...(primary ? { 'background-color': '$accent', 'background-image': gradient } : { 'background-color': '$raised', ...edge('1px', '$line') }) }, small: { width: '54px', height: '54px' },
      children: [glyph(symbol, primary ? 28 : 24)] },
    { type: 'text', text: label, style: { 'font-size': '12px', color: '$secondary' } },
  ] });
const infoLine = (label: string, value: string, when: Condition[]): Node => ({ type: 'box', when, style: row({ gap: '10px', 'align-items': 'baseline' }), children: [
  { type: 'text', text: label, style: { color: '$secondary', width: '90px', 'flex-shrink': '0' } },
  { type: 'text', text: value, style: { color: '$ink', flex: '1', 'min-width': '0px' } },
] });

const titleTop: Node = { type: 'box', style: col({ position: 'relative' }), children: [
  { type: 'box', style: col({ position: 'relative', height: 'min(56vh, 520px)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$card' }), small: { height: '230px' }, children: [
    { type: 'box', when: [{ test: 'detail.backdrop', not: true }], style: fill, children: tile('detail.id') },
    { type: 'image', when: [{ test: 'detail.backdrop' }], src: '{detail.backdrop}', alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
    { type: 'box', style: { ...fill, 'background-image': 'linear-gradient(0deg, $page 0%, $scrim-page 18%, $scrim-clear 60%), linear-gradient(180deg, $scrim 0%, $scrim-clear 30%)' } },
  ] },
  { type: 'box', style: row({ position: 'relative', gap: '36px', 'align-items': 'flex-start', ...side, 'margin-top': '-190px' }), small: { gap: '0px', ...sideSmall, 'margin-top': '-60px' }, children: [
    { type: 'box', style: col({ position: 'relative', width: 'clamp(180px, 17vw, 300px)', 'flex-shrink': '0', 'aspect-ratio': '2 / 3', 'border-radius': '6px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$card', 'box-shadow': '0px 8px 30px $shadow', 'align-items': 'center', 'justify-content': 'center', color: '$secondary' }),
      small: { display: 'none' }, children: [
        { type: 'box', when: [{ test: 'detail.poster', not: true }], style: fill, children: tile('detail.id') },
        { type: 'image', when: [{ test: 'detail.poster' }], src: '{detail.poster}', alt: '', style: { width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'box', when: [{ test: 'detail.poster', not: true }], style: { position: 'relative', width: '56px', height: '56px' }, children: kindGlyphs('detail.kind', 0, { width: '100%', height: '100%' }) },
      ] },
    { type: 'box', style: col({ flex: '1', 'min-width': '0px', gap: '16px', 'padding-top': '60px', 'align-items': 'flex-start', 'text-align': 'left' }), small: { gap: '12px', 'padding-top': '0px', 'align-items': 'center', 'text-align': 'center' }, children: [
      { type: 'image', when: [{ test: 'detail.logo' }], src: '{detail.logo}', alt: '{detail.name}', role: 'heading', level: 1, style: { height: '110px', width: 'auto', 'max-width': 'min(480px, 90%)', 'object-fit': 'contain' }, small: { height: '70px', 'max-width': '80%' } },
      { type: 'text', when: [{ test: 'detail.logo', not: true }], text: '{detail.name}', role: 'heading', level: 1, style: { 'font-size': '40px', 'font-weight': '700', color: '$ink-strong', 'line-height': '1.15', 'text-shadow': '0px 2px 10px $shadow' }, small: { 'font-size': '28px' } },
      { type: 'box', style: row({ gap: '14px', 'align-items': 'center', 'flex-wrap': 'wrap', 'justify-content': 'flex-start', 'font-size': '15px' }), small: { 'justify-content': 'center' }, children: [
        { type: 'text', text: '{detail.kindLabel}', style: { color: '$secondary' } },
      ] },
      { type: 'box', style: row({ gap: '12px', 'align-items': 'flex-start', 'flex-wrap': 'wrap', 'justify-content': 'flex-start', 'margin-top': '4px' }), small: { gap: '14px', 'justify-content': 'center' }, children: [
        roundAction('{s:resume}', 'play-fill', true, { action: 'play', arg: '{detail.id}' }, 'detail-play', [{ test: 'detail.canPlay' }, { test: 'detail.hasResume' }]),
        roundAction('{s:play}', 'play-fill', true, { action: 'play', arg: '{detail.id}' }, 'detail-play', [{ test: 'detail.canPlay' }, { test: 'detail.hasResume', not: true }]),
        { type: 'repeat', over: 'detail.extras', item: roundAction('{s:trailer}', jelly('film'), false, { action: 'playExtra', arg: '{extra.id}' }, 'detail-trailer-{extra.id}', [{ test: 'extra.kind', is: 'eq', value: 'trailer' }, { test: 'extra.ready' }]) },
      ] },
      { type: 'box', when: [{ test: 'detail.hasResume' }], style: col({ gap: '6px', width: '320px' }), small: { width: '70%' }, children: [
        { type: 'box', label: '{s:watchProgress}', style: { height: '5px', 'border-radius': '3px', 'background-color': '$track', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
          { type: 'box', style: { height: '5px', width: '{detail.resumePct}%', 'background-color': '$accent' } },
        ] },
      ] },
      { type: 'text', when: [{ test: 'detail.summary' }], text: '{detail.summary}', style: { 'font-size': '16px', 'line-height': '1.6', color: '$ink', 'max-width': '52rem', 'text-align': 'left' }, small: { 'font-size': '15px' } },
      { type: 'box', style: col({ gap: '6px', 'font-size': '14px', 'max-width': '52rem', 'align-self': 'stretch', 'text-align': 'left' }), children: [
        infoLine('{s:crew}', '{detail.crewLine}', [{ test: 'detail.crewLine' }]),
        { type: 'box', style: row({ gap: '8px', 'flex-wrap': 'wrap', 'margin-top': '6px' }), children: [
          { type: 'repeat', over: 'detail.mediaFacts', item: { type: 'text', text: '{fact.text}', style: { 'font-size': '12px', 'font-weight': '600', padding: '4px 8px', 'border-radius': '4px', 'background-color': '$raised', color: '$ink' } } },
        ] },
      ] },
    ] },
  ] },
] };

// One episode in a season's list: its still, number and name, facts and overview.
const episodeRow: Node = { type: 'box', group: true, style: row({ position: 'relative', gap: '20px', 'align-items': 'center', padding: '12px 8px', 'border-radius': '6px', 'background-color': 'transparent' }),
  small: { gap: '12px', 'align-items': 'flex-start' }, groupHover: { 'background-color': '$hover' }, children: [
    { type: 'box', press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}', style: { position: 'relative', width: '220px', 'aspect-ratio': '16 / 9', 'flex-shrink': '0', 'border-radius': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$card', color: '$ink-strong', cursor: 'pointer' },
      small: { width: '130px' }, focus: { 'box-shadow': '0px 0px 0px 3px $accent' }, children: [
        { type: 'box', when: [{ test: 'card.backdrop', not: true }], style: fill, children: tile('card.id') },
        { type: 'image', when: [{ test: 'card.backdrop' }], src: '{card.backdrop}', alt: '', style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'box', style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$overlay', opacity: '0', transition: 'opacity 140ms linear' }, groupHover: { opacity: '1' }, children: [
          { type: 'box', style: { width: '44px', height: '44px', 'border-radius': '22px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$accent' }, children: [glyph('play-fill', 24)] },
        ] },
        { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '6px', right: '6px', width: '24px', height: '24px', 'border-radius': '12px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$accent', color: '$ink-strong' }, children: [glyph('checkmark', 14)] },
        { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '4px', 'background-color': '$overlay' }, children: [
          { type: 'box', style: { height: '100%', width: '{card.progressPct}%', 'background-color': '$accent' } },
        ] },
      ] },
    { type: 'box', style: col({ flex: '1', 'min-width': '0px', gap: '5px' }), children: [
      { type: 'box', press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'episode-{card.id}', style: { position: 'relative', color: '$ink-strong', 'text-align': 'left', cursor: 'pointer' }, hover: { color: '$accent' }, focus: { color: '$accent' }, children: [
        { type: 'text', text: '{episode.numberTitle}', style: { 'font-size': '16px', 'font-weight': '600', 'line-clamp': '2' }, small: { 'font-size': '15px' } },
      ] },
      { type: 'text', when: [{ test: 'card.facts' }], text: '{card.facts}', style: { 'font-size': '13px', color: '$secondary', 'font-variant-numeric': 'tabular-nums' } },
      { type: 'text', when: [{ test: 'card.summary' }, { test: 'env.small', not: true }], text: '{card.summary}', style: { 'font-size': '14px', 'line-height': '1.5', color: '$ink', 'line-clamp': '2' } },
    ] },
  ] };

const seasonTab: Node = { type: 'box', press: { action: 'select', arg: '{season.pick}' }, label: '{card.name}', role: 'tab', style: tab, hover: { color: '$accent' }, focus: { color: '$accent' }, children: [
  { type: 'text', when: [{ test: 'season.on' }], text: '{card.name}', style: { color: '$accent', 'font-weight': '600' } },
  { type: 'text', when: [{ test: 'season.on', not: true }], text: '{card.name}' },
  { ...underline(0), when: [{ test: 'season.on' }] },
] };

const extraCard: Node = { type: 'box', style: col({ width: 'clamp(220px, 18vw, 320px)', 'flex-shrink': '0', gap: '6px' }), small: { width: '52vw' }, children: [
  { type: 'box', press: { action: 'playExtra', arg: '{extra.id}' }, label: '{extra.name}', style: { position: 'relative', width: '100%', 'aspect-ratio': '16 / 9', 'border-radius': '6px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: '$ink-strong', cursor: 'pointer' },
    hover: { 'box-shadow': '0px 0px 0px 3px $accent' }, focus: { 'box-shadow': '0px 0px 0px 3px $accent' }, children: [
      ...tile('extra.id'),
      { type: 'box', when: [{ test: 'extra.ready' }], style: { position: 'relative', width: '48px', height: '48px', 'border-radius': '24px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$accent' }, children: [glyph('play-fill', 24)] },
      { type: 'box', when: [{ test: 'extra.ready', not: true }], style: { position: 'relative', width: '48px', height: '48px', 'border-radius': '24px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': '$raised', opacity: '0.6' }, children: [glyph('info', 24)] },
    ] },
  { type: 'text', text: '{extra.name}', style: { 'font-size': '13px', 'font-weight': '500', color: '$ink-strong', 'text-align': 'center', 'line-clamp': '1' } },
  { type: 'text', when: [{ test: 'extra.ready', not: true }], text: '{s:notYet}', style: { 'font-size': '12px', color: '$secondary', 'text-align': 'center' } },
] };

const person: Node = { type: 'box', role: 'listitem', style: col({ width: 'clamp(110px, 8.6vw, 160px)', 'flex-shrink': '0', gap: '2px', 'align-items': 'center', 'text-align': 'center' }), small: { width: '26vw' }, children: [
  { type: 'image', when: [{ test: 'person.portrait' }], src: '{person.portrait}', alt: '', style: { width: '100%', 'aspect-ratio': '2 / 3', 'border-radius': '6px', 'object-fit': 'cover', 'margin-bottom': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden' } },
  { type: 'box', when: [{ test: 'person.portrait', not: true }], style: col({ position: 'relative', width: '100%', 'aspect-ratio': '2 / 3', 'border-radius': '6px', 'margin-bottom': '4px', 'align-items': 'center', 'justify-content': 'center', color: '$secondary', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }), children: [
    ...tile('person.name'),
    { ...glyph('person', 46), style: { position: 'relative', width: '46px', height: '46px' }, small: { width: '34px', height: '34px' } } as Node,
  ] },
  { type: 'text', text: '{person.name}', style: { width: '100%', 'font-size': '13px', 'font-weight': '500', color: '$ink-strong', 'line-clamp': '2' } },
  { type: 'text', when: [{ test: 'person.role' }], text: '{person.role}', style: { width: '100%', 'font-size': '12px', color: '$secondary', 'line-clamp': '1' } },
] };

const hscroll = (children: Node[], role?: string): Node => ({ type: 'box', style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }), children: [
  { type: 'box', role, style: row({ gap: '16px', ...side, 'padding-bottom': '6px' }), small: { gap: '10px', ...sideSmall }, children },
] });

const titleRest: Node = { type: 'box', style: col({ 'padding-top': '40px' }), small: { 'padding-top': '26px' }, children: [
  { type: 'repeat', over: 'detail.upNext', item: { type: 'box', style: col({ gap: '10px', ...side, ...block }), small: { ...sideSmall, 'padding-bottom': '18px' }, children: [
    { type: 'text', text: '{s:nextUp}', role: 'heading', level: 2, style: heading2, small: heading2Small },
    { type: 'box', style: row({ gap: '14px', 'align-items': 'center' }), children: [
      { type: 'use', template: 'upNext' },
      { type: 'box', when: [{ test: 'env.small', not: true }], press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}', style: { ...iconBtn(56), 'background-color': '$raised' }, hover: iconBtnHover, focus: iconBtnHover, children: [glyph('play-fill', 28)] },
    ] },
  ] } },
  { type: 'box', when: [{ test: 'detail.hasEpisodes' }], style: col({ gap: '4px', ...side, ...block }), small: { ...sideSmall, 'padding-bottom': '18px' }, children: [
    { type: 'text', text: '{s:episodes}', role: 'heading', level: 2, style: { 'font-size': '20px', 'font-weight': '600', color: '$ink-strong', 'padding-bottom': '4px' } },
    { type: 'box', when: [{ test: 'detail.hasSeasons' }], style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', 'margin-bottom': '8px', ...hairline }), children: [
      { type: 'box', role: 'tablist', label: '{s:seasons}', testId: 'season-picker', style: row(), children: [{ type: 'repeat', over: 'detail.seasons', item: seasonTab }] },
    ] },
    { type: 'repeat', over: 'detail.episodes', item: episodeRow },
  ] },
  { type: 'box', when: [{ test: 'detail.hasExtras' }], style: col({ gap: '10px', ...block }), small: { 'padding-bottom': '18px' }, children: [
    { type: 'text', text: '{s:specialFeatures}', role: 'heading', level: 2, style: { ...heading2, ...side }, small: { ...heading2Small, ...sideSmall } },
    hscroll([{ type: 'repeat', over: 'detail.extras', item: extraCard }]),
  ] },
  { type: 'box', when: [{ test: 'detail.hasCast' }], style: col({ gap: '10px', ...block }), small: { 'padding-bottom': '18px' }, children: [
    { type: 'text', text: '{s:cast}', role: 'heading', level: 2, style: { 'font-size': '20px', 'font-weight': '600', color: '$ink-strong', ...side }, small: sideSmall },
    hscroll([{ type: 'repeat', over: 'detail.cast', item: person }], 'list'),
  ] },
  { type: 'repeat', over: 'detail.related', item: section('row.items', sectionTitle('{row.name}')) },
] };

// The waiting state: the accent spinner, fading in after a beat.
const waiting: Node = { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'loading' }], role: 'status', label: '{s:opening}', motion: 'statusIn',
  style: col({ 'align-items': 'center', 'justify-content': 'center', gap: '16px', 'padding-top': '220px', 'padding-bottom': '80px' }), children: [spinner(54, { small: { width: '44px', height: '44px' } })] };
const failure: Node = { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'failed' }], role: 'status', style: col({ 'align-items': 'center', 'text-align': 'center', gap: '10px', padding: '64px 24px', color: '$secondary' }), children: [
  glyph('alert', 44),
  { type: 'text', text: '{s:quiet}', style: { 'margin-top': '6px', 'font-size': '20px', 'font-weight': '600', color: '$ink-strong' } },
  { type: 'text', text: '{s:titleFailed}', style: { 'max-width': '30rem', 'font-size': '15px', 'line-height': '1.5' } },
] };

const title: Node = { type: 'box', style: col({ position: 'relative', height: '100%', 'min-height': '0px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$page', color: '$ink' }), children: [
  { type: 'box', press: { action: 'back' }, label: '{s:closeTitle}', testId: 'detail-close', style: { position: 'absolute', top: '20px', right: '20px', 'z-index': '10', 'box-sizing': 'border-box', width: '44px', height: '44px', ...edge('1px', 'surface.line'), 'border-radius': '22px', padding: '13px', 'background-color': 'surface.glass', 'backdrop-filter': 'blur(20px) saturate(1.3)', color: 'ink.primary' },
    children: [{ type: 'icon', symbol: 'close', style: { width: '100%', height: '100%' } }] },
  { type: 'box', id: '{env.route}-scroll-{env.entry}', role: 'region', label: '{s:titleDetails}', style: col({ flex: '1', 'min-height': '0px', 'overflow-y': 'auto', 'overflow-x': 'hidden', 'font-family': sans }), children: [
    waiting,
    failure,
    { ...titleTop, when: [{ test: 'env.load', is: 'eq', value: 'ready' }], motion: 'fadeIn' } as Node,
    { ...titleRest, when: [{ test: 'env.load', is: 'eq', value: 'ready' }], motion: 'fadeIn', style: { ...(titleRest as { style: Style }).style, 'padding-bottom': '56px' } } as Node,
  ] },
] };

export default {
  schema: 1, renderer: 2, id, name: 'Jelly Twin', version,
  tagline: 'A familiar home-media client: near-black, cyan accents, card rows.',
  preview: asset('preview.jpg'), swatches: ['#101010', '#ffffff', '#00a4dc', '#aa5cc3', '#292929'],
  tokens: {
    page: '#101010', header: '#101010f2', drawer: '#1c1c1c', raised: '#292929', 'raised-hover': '#383838', card: '#242424', field: '#292929',
    line: '#ffffff1f', ink: '#ffffffde', 'ink-strong': '#ffffff', secondary: '#ffffff99', quiet: '#ffffff66',
    accent: '#00a4dc', 'accent-soft': '#00a4dc33', violet: '#aa5cc3', 'violet-soft': '#aa5cc340', hover: '#ffffff14',
    overlay: '#00000099', scrim: '#000000b3', 'scrim-clear': '#10101000', 'scrim-page': '#101010d9', 'osd-top': '#000000b3', 'osd-bottom': '#000000d9',
    track: '#ffffff40', buffer: '#ffffff73', popup: '#202020f7', shadow: '#000000a6', danger: '#cb272a',
    'tile-1': '#00455c', 'tile-2': '#44007e', 'tile-3': '#1e5631', 'tile-4': '#6b2c1f', 'tile-5': '#234a7a',
  },
  strings: { en: {
    mainNavigation: 'Main navigation', velaHome: 'Vela home', search: 'Search', profile: 'Profile and appearance', close: 'Close',
    openMenu: 'Open menu', closeMenu: 'Close menu', menu: 'Menu', media: 'Media', user: 'User', sections: 'Sections', liveTv: 'Live TV',
    home: 'Home', appearance: 'Change appearance', install: 'Install Vela', update: 'Update ready, reload', signOut: 'Sign out',
    moreInfo: 'More info', featured: 'Featured titles', featuredOf: 'Featured title {index.label} of {env.heroCount}: {hero.name}',
    nothingHere: 'Nothing here yet', noRows: 'Your library hasn\'t offered any rows yet. Titles appear here as your server adds them.',
    play: 'Play', resume: 'Resume', trailer: 'Trailer', watchProgress: 'Watch progress', crew: 'Crew', genres: 'Genres', played: 'Played',
    nextUp: 'Next Up', episodes: 'Episodes', seasons: 'Seasons', specialFeatures: 'Special Features', cast: 'Cast', moreLikeThis: 'More Like This', notYet: 'Not available yet',
    closeTitle: 'Close title', titleDetails: 'Title details', opening: 'Opening title…', quiet: 'Something went quiet', titleFailed: 'This title couldn\'t be opened. It may no longer be available.',
  } },
  motion: {
    fadeIn: { keyframes: 'dissolve', duration: 260, easing: 'ease-out', fill: 'both' },
    statusIn: { keyframes: 'dissolve', duration: 300, delay: 200, easing: 'ease-out', fill: 'both' },
    spin: { keyframes: 'spin', duration: 900, easing: 'linear', iterations: 'infinite', fill: 'none' },
    pop: { keyframes: 'pop', duration: 200, easing: 'ease-out', fill: 'both', still: { keyframes: 'dissolve', duration: 160 } },
    scrimIn: { keyframes: 'dissolve', duration: 220, easing: 'ease-out', fill: 'both' },
    drawerIn: { keyframes: 'slideIn', duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both', still: { keyframes: 'dissolve', duration: 160 } },
  },
  templates: { poster: card(false), upNext: { ...card(true), style: { ...card(true).style, width: 'clamp(240px, 21.5vw, 400px)' }, small: { width: '58vw' } } },
  slots: { shell, home },
  routes: { title },
  detail: { wide: 'fullscreen', small: 'fullscreen' },
} satisfies SkinDocument;

// Index: a quiet printed catalogue (light paper, serif type, plain lists), as a skin
// document (protocol/v0/skin.ts). It reproduces the compiled Index element for element:
// a reading rail beside the page on wide screens and a wrapped bar above it on phones,
// titles as ruled catalogue entries, and from 900 px a title page split beside a narrow
// home. Layout that depends on the slot's own width (a split pane is small) is written
// as `states` on `env.small`, never as window-width variants.
//
// Deliberate differences from the compiled Index (agreed with the orchestrator):
// - Opening a title from 900 px keeps the 360 px home pane where the reader was; compiled
//   reset it to the top.
// - The sign-in heading is readable (compiled drew Index's dark ink on the dark sign-in stage).
import type { Condition, Node, SkinDocument, Style } from '../../../skin';

const id = 'index', version = '1.0.0';
const asset = (file: string) => `/vela/v0/appearance/skins/${id}/${version}/${file}`;
const serif = 'Georgia, serif';
/** A rule under a box (and nothing on its other sides). */
const rule = (width: string, color: string): Style => ({ 'border-width': '0px', 'border-style': 'solid', 'border-top-width': '0px', 'border-bottom-width': width, 'border-bottom-color': color });
const small: Condition = { test: 'env.small' };
const ready: Condition = { test: 'env.load', is: 'eq', value: 'ready' };
const wide: Condition = { test: 'env.small', not: true };

/** A style that changes when the slot is small: the small state replaces the style whole. */
const responsive = (style: Style, smallStyle: Style) => ({ style, states: [{ when: [small], style: { ...style, ...smallStyle } as Style }] });

// A button with a ground of its own: compiled Exact washes it with 12% of its ink on hover
// (they draw that wash themselves and opt out of the renderer's control states).
const inkWash = { hover: { 'background-image': 'linear-gradient(color-mix(in srgb, currentColor 12%, transparent) 0 0)' } as Style, controlStates: false };

// A plain text button as Exact draws one: unset, a block, 4 px of padding, centred text.
const plain = (text: string, press: { action: 'home' | 'search' | 'live' | 'signOut' }, when: Condition[]): Node => ({
  type: 'box', press, label: text, when, style: { display: 'block', padding: '4px', 'text-align': 'center' }, children: [{ type: 'text', text }] });

// ---------------------------------------------------------------- shell
const nav: Node = { type: 'box', role: 'navigation', label: '{s:mainNavigation}',
  ...responsive({ display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '12px', 'align-items': 'center', padding: '20px', 'background-color': '$rail' }, { padding: '12px' }),
  children: [
    { type: 'image', src: 'assets/brand/vela-lockup-paper.svg', alt: '{s:vela}', style: { width: '58px', height: '22px' } },
    plain('{s:home}', { action: 'home' }, [{ test: 'env.viewer' }]),
    plain('{s:search}', { action: 'search' }, [{ test: 'env.viewer' }]),
    plain('{s:live}', { action: 'live' }, [{ test: 'env.canLive' }]),
    { type: 'box', press: { action: 'openPicker' }, a11y: { haspopup: 'dialog' }, label: '{s:choose}', testId: 'skin-picker', when: [{ test: 'env.skinCount', is: 'gt', value: '1' }],
      style: { display: 'block', padding: '6px 12px', 'text-align': 'center', 'background-color': '$field', border: '1px solid $line' }, ...inkWash, children: [{ type: 'text', text: '{s:choose}', style: { 'font-size': '13px' } }] },
    { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
    { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
    { type: 'text', text: '{env.viewer}', when: [{ test: 'env.viewer' }], style: { 'font-size': '12px' } },
    plain('{s:signOut}', { action: 'signOut' }, [{ test: 'env.viewer' }]),
  ] };

const shell: Node = { type: 'box',
  ...responsive({ position: 'relative', display: 'flex', 'flex-direction': 'row', height: '100%', 'min-height': '0px', 'background-color': '$page', color: '$ink', 'color-scheme': 'light', 'font-family': serif } as Style, { 'flex-direction': 'column' }),
  children: [
    // Wide: an 11.25rem rail of the bar's ground, the bar wrapping inside it. Small: the bar alone.
    { type: 'box', ...responsive({ display: 'flex', 'flex-direction': 'column', width: '11.25rem', 'flex-shrink': '0', 'background-color': '$rail' }, { width: 'auto', 'flex-shrink': '1' }), children: [nav] },
    { type: 'slot', slot: 'children', style: { display: 'flex', 'flex-direction': 'column', 'flex-grow': '1', 'min-width': '0px', 'min-height': '0px' } as Style,
      inner: { display: 'flex', 'flex-direction': 'column', 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' } as Style },
  ] };

// ---------------------------------------------------------------- catalogue entries
const column = (text: string, width: string, when: Condition[], extra: Style = {}): Node => ({ type: 'text', text, when, style: { width, 'font-size': '12px', color: '$secondary', ...extra } });
const kinds: [string, string][] = [['movie', 'film'], ['show', 'series'], ['episode', 'episode'], ['season', 'season']];

// One entry: the name (the pressable part), then kind, year, rating and genres in fixed
// columns; on a small slot the compact facts instead.
const card: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '12px', padding: '10px 0px', ...rule('1px', '$line') }, children: [
  { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
  { type: 'box', press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}', style: { display: 'block', flex: '1', 'min-width': '0px', padding: '4px', 'text-align': 'left' }, children: [
    { type: 'text', text: '{card.name}', style: { 'font-size': '16px', 'font-weight': '600' } },
  ] },
  ...kinds.map(([k, s]) => column(`{s:${s}}`, '80px', [wide, { test: 'card.kind', is: 'eq', value: k }])),
  column('{s:collection}', '80px', [wide, ...kinds.map(([k]) => ({ test: 'card.kind', is: 'ne' as const, value: k }))]),
  column('{card.yearLabel}', '54px', [wide, { test: 'card.yearLabel' }]),
  column('{s:noYear}', '54px', [wide, { test: 'card.yearLabel', not: true }]),
  column('{card.rating}', '50px', [wide]),
  column('{card.genresComma}', '150px', [wide], { 'line-clamp': '1' }),
  column('{card.facts}', '100px', [small], { 'line-clamp': '1' }),
] };

/** A titled list of entries: the heading, then one entry per element of `over`. */
const catalogue = (heading: string, over: string, when: Condition[] = []): Node => ({ type: 'box', when, style: { display: 'flex', 'flex-direction': 'column', padding: '20px 4%', gap: '4px' }, children: [
  { type: 'text', text: heading, role: 'heading', level: 2, style: { 'font-size': '24px', 'font-weight': '700' } },
  { type: 'repeat', over, item: { type: 'use', template: 'card' } },
] });

// A home row, then (when the server has more) the 1 px sentinel that asks for it and the
// waiting line while it comes.
const loadingMore = (when: Condition[]): Node => ({ type: 'text', text: '{s:loadingMore}', role: 'status', when, style: { color: '$secondary', padding: '8px 4%' } });
const row: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column' }, children: [
  catalogue('{row.name}', 'row.items'),
  { type: 'box', when: [{ test: 'row.hasMore' }], style: { height: '1px' }, children: [{ type: 'widget', widget: 'sentinel', params: { on: 'row' } }] },
  loadingMore([{ test: 'row.hasMore' }, { test: 'row.loadingMore' }]),
] };

// ---------------------------------------------------------------- home
// A loading or failure moment: the message alone, 32 px in.
const status = (text: string, when: Condition[]): Node => ({ type: 'text', text, role: 'status', when, style: { padding: '32px' } });

// Compiled, the heading, the search field and the featured title share one column
// (padding 24px 4%, gap 18px); here they are siblings carrying that padding and gap.
const home: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', 'background-color': '$page', color: '$ink' }, children: [
  // Before home is known, Index shows only the message, plainly (as its compiled Status: no retry).
  status('{s:findingEvening}', [{ test: 'env.load', is: 'eq', value: 'loading' }]),
  status('{s:unreachable}', [{ test: 'env.load', is: 'eq', value: 'failed' }]),
  { type: 'box', when: [ready], style: { display: 'block', padding: '24px 4% 0px' }, children: [
    { type: 'text', text: '{s:viewingIndex}', role: 'heading', level: 1, ...responsive({ 'font-size': '42px', 'font-weight': '700' }, { 'font-size': '28px' }) },
  ] },
  // The search field: a bold label, the bare input and a plain Clear over a 2 px rule.
  { type: 'box', when: [ready], style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '12px', margin: '18px 4% 0px', padding: '8px 0px', ...rule('2px', '$ink') }, children: [
    { type: 'text', text: '{s:searchLabel}', style: { 'font-size': '12px', 'font-weight': '700' } },
    { type: 'widget', widget: 'searchInput', params: { placeholder: '{s:searchPlaceholder}', label: '{s:searchLibrary}', placeholderColor: '$placeholder' },
      style: { flex: '1', 'min-width': '0px', padding: '8px', color: '$ink', 'font-family': serif, 'font-size': '16px' } },
    { type: 'box', when: [{ test: 'env.query' }], press: { action: 'clearSearch' }, label: '{s:clearSearch}', style: { display: 'block', 'text-align': 'center' }, children: [{ type: 'text', text: '{s:clear}' }] },
  ] },
  { type: 'box', when: [ready, { test: 'env.searching', not: true }], style: { display: 'flex', 'flex-direction': 'column', padding: '0px 4%' }, children: [
    { type: 'repeat', over: 'home.hero', item: { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '8px', padding: '16px 0px', 'margin-top': '18px' }, children: [
      { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
      { type: 'text', text: '{s:featured}', style: { 'font-size': '11px', 'letter-spacing': '2px' } },
      { type: 'box', press: { action: 'select', arg: '{hero.kindId}' }, label: '{hero.label}', style: { display: 'block', 'text-align': 'left' }, children: [
        { type: 'text', text: '{hero.name}', style: { 'font-size': '26px', 'font-weight': '700' } },
      ] },
      { type: 'text', text: '{hero.facts}', style: { 'font-size': '12px' } },
      { type: 'text', text: '{hero.summary}', style: { 'font-size': '14px', 'line-clamp': '2' } },
    ] } },
  ] },
  { type: 'box', when: [ready], style: { height: '24px' } },
  { type: 'box', when: [ready, { test: 'env.searching', not: true }], style: { display: 'flex', 'flex-direction': 'column' }, children: [
    { type: 'repeat', over: 'home.rows', item: { type: 'use', template: 'row' } },
    { type: 'box', when: [{ test: 'env.homeHasMore' }], style: { height: '1px' }, children: [{ type: 'widget', widget: 'sentinel', params: { on: 'home' } }] },
    loadingMore([{ test: 'env.homeHasMore' }, { test: 'env.homeMoreLoading' }]),
  ] },
] };

// ---------------------------------------------------------------- library
// A plain Contract button with no ground of its own, as Exact draws it ("bordered"): a hairline
// in the label colour at 45%, the control radius and curve, the label colour at weight 500.
const bordered: Style = { display: 'block', padding: '16px', border: '1px solid var(--exact-line)', 'border-radius': 'calc(8px * var(--exact-curve-reach))', 'corner-shape': 'var(--exact-control-curve, var(--exact-curve))',
  color: 'var(--exact-label)', 'font-weight': '500', 'line-height': '20px', 'text-align': 'center' };

// A library's titles in the server's order, a way back and a way to load more.
const library: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column' }, children: [
  status('{s:findingTitles}', [{ test: 'env.load', is: 'eq', value: 'loading' }]),
  status('{s:libraryFailed}', [{ test: 'env.load', is: 'eq', value: 'failed' }]),
  { type: 'box', when: [ready], press: { action: 'home' }, label: '{s:back}', style: bordered, children: [{ type: 'text', text: '{s:back}' }] },
  catalogue('{library.name}', 'library.items', [ready]),
  { type: 'box', when: [ready, { test: 'library.more' }], press: { action: 'libraryMore' }, disabled: [{ test: 'env.libraryMoreLoading' }], label: '{s:showMore}',
    style: bordered, children: [{ type: 'text', text: '{s:showMore}' }] },
] };

// ---------------------------------------------------------------- title
const section = (heading: string, when: Condition[], children: Node[], gap: string): Node => ({ type: 'box', when, style: { display: 'flex', 'flex-direction': 'column', padding: '0px 7%', gap }, children: [
  { type: 'text', text: heading, role: 'heading', level: 2, style: { 'font-size': '24px', 'font-weight': '700' } },
  ...children,
] });
// A pressable block whose text is its accessible name, as a compiled button with a text child.
const playButton = (text: string, when: Condition[]): Node => ({ type: 'box', when, press: { action: 'play', arg: '{detail.id}' }, testId: 'detail-play', label: text,
  style: { display: 'block', 'align-self': 'start', padding: '12px 20px', 'text-align': 'center', 'background-color': '$ink', color: '$page' }, ...inkWash, children: [{ type: 'text', text }] });
// An extra keeps its place in server order whether or not it is ready; one that is not is shown, disabled.
// Exact dims a disabled button to half opacity; the box carries that here.
const extraButton = (text: string, ready: boolean): Node => ({ type: 'box', when: [{ test: 'extra.ready', not: !ready }], press: { action: 'playExtra', arg: '{extra.id}' }, label: text,
  ...(ready ? {} : { disabled: [{ test: 'extra.ready', not: true }], disabledStyle: { opacity: '0.5' } }), style: { display: 'block', padding: '16px', 'text-align': 'left', 'background-color': '$rail' }, ...inkWash, children: [{ type: 'text', text }] });

const detail: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '28px', 'padding-bottom': '48px' }, children: [
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', padding: '32px 4%', gap: '24px', 'align-items': 'start' }, children: [
    { type: 'image', src: '{detail.poster}', alt: '', when: [wide, { test: 'detail.poster' }], style: { width: '180px', height: '270px', 'object-fit': 'cover' } },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', flex: '1', gap: '16px' }, children: [
      { type: 'text', text: '{detail.kindLabel}', style: { 'font-size': '11px', 'letter-spacing': '2px' } },
      { type: 'text', text: '{detail.name}', role: 'heading', level: 1, ...responsive({ 'font-size': '48px', 'font-weight': '700' }, { 'font-size': '32px' }) },
      { type: 'text', text: '{detail.facts}', style: { 'font-size': '13px' } },
      { type: 'text', text: '{detail.summary}', style: { 'font-size': '16px', 'line-height': '1.6' } },
      playButton('{s:resume}', [{ test: 'detail.canPlay' }, { test: 'detail.hasResume' }]),
      playButton('{s:play}', [{ test: 'detail.canPlay' }, { test: 'detail.hasResume', not: true }]),
    ] },
  ] },
  catalogue('{s:seasons}', 'detail.seasons', [{ test: 'detail.seasonCount', is: 'gt', value: '0' }]),
  catalogue('{s:episodes}', 'detail.episodes', [{ test: 'detail.hasEpisodes' }]),
  section('{s:extras}', [{ test: 'detail.hasExtras' }], [
    { type: 'repeat', over: 'detail.extras', item: { type: 'box', style: { display: 'flex', 'flex-direction': 'column' }, children: [extraButton('{extra.name}', true), extraButton('{s:notAvailable}', false)] } },
  ], '14px'),
  section('{s:featuring}', [{ test: 'detail.castLine' }], [{ type: 'text', text: '{detail.castLine}', style: { color: '$secondary', 'line-height': '1.6' } }], '12px'),
  section('{s:behind}', [{ test: 'detail.crewLine' }], [{ type: 'text', text: '{detail.crewLine}', style: { 'line-height': '1.6' } }], '12px'),
  { type: 'repeat', over: 'detail.related', item: { type: 'use', template: 'row' } },
] };

// The flat title page: the page ground, the round close control, one scroll region.
const title: Node = { type: 'box', style: { width: '100%', height: '100%', display: 'flex', 'flex-direction': 'column', 'background-color': '$page', color: '$ink' }, children: [
  { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$page' }, children: [
    { type: 'box', press: { action: 'back' }, label: '{s:closeTitle}', testId: 'detail-close', id: 'back',
      style: { position: 'absolute', top: '20px', right: '20px', 'z-index': '10', width: '44px', height: '44px', 'box-sizing': 'border-box', padding: '13px', border: '1px solid surface.line', 'border-radius': '22px', 'background-color': 'surface.glass', 'backdrop-filter': 'blur(20px) saturate(1.3)', color: 'ink.primary' }, ...inkWash,
      children: [{ type: 'icon', symbol: 'close', style: { width: '19.2px', height: '19.2px' } }] },
    { type: 'box', id: '{env.route}-scroll-{env.entry}', role: 'region', label: '{s:titleDetails}', style: { display: 'block', flex: '1', 'min-height': '0px', 'overflow-x': 'auto', 'overflow-y': 'auto' }, children: [
      status('{s:failed}', [{ test: 'env.load', is: 'eq', value: 'failed' }]),
      status('{s:opening}', [{ test: 'env.load', is: 'eq', value: 'loading' }]),
      { ...detail, when: [{ test: 'env.load', is: 'eq', value: 'ready' }] },
    ] },
  ] },
] };

export default {
  schema: 1, renderer: 11, status: true, id, name: 'Index', version, tagline: 'A quiet printed catalogue: light paper, serif type, plain lists.',
  preview: asset('preview.jpg'), swatches: ['#f3f0e8', '#22221e', '#813b31', '#e3dfd3', '#bcb8ae'],
  // Sections cut rather than slide; nothing fades under a bar.
  traits: { panSections: false, barMask: false, page: '$page', ink: '$ink', splashOnPaper: true },
  tokens: {
    page: '#f3f0e8', ink: '#22221e', placeholder: 'rgba(60, 60, 67, 0.3)', rail: '#e3dfd3', field: '#ffffff', secondary: '#55554d', line: '#bcb8ae', accent: '#813b31',
    separator: '#d6d1c6', airing: '#e9e1d3',
    'video-header': '#000000dd', 'video-footer': '#000000ee', 'on-video': '#f5f1e9', 'video-line': '#ffffff24', 'video-ground': '#090b0e',
  },
  strings: { en: {
    mainNavigation: 'Main navigation', vela: 'vela', home: 'Home', search: 'Search', live: 'Live TV', choose: 'Change appearance',
    install: 'Install Vela', update: 'Update ready, reload', signOut: 'Sign out',
    findingEvening: 'Finding your evening…', unreachable: 'Your library couldn\'t be reached. Check your server connection.',
    viewingIndex: 'THE VIEWING INDEX', searchLabel: 'SEARCH', searchPlaceholder: 'Title, person, or description', searchLibrary: 'Search your library', clearSearch: 'Clear search', clear: 'Clear', featured: 'FEATURED', loadingMore: 'Loading more…',
    film: 'Film', series: 'Series', episode: 'Episode', season: 'Season', collection: 'Collection', noYear: '—',
    closeTitle: 'Close title', titleDetails: 'Title details', opening: 'Opening title…', failed: 'This title couldn\'t be opened. It may no longer be available.',
    back: 'Back', showMore: 'Show more', findingTitles: 'Finding titles…', libraryFailed: 'This library couldn\'t be opened. Check your connection and try again.',
    play: 'Play', resume: 'Resume watching', seasons: 'Seasons', episodes: 'Episodes', extras: 'Extras', notAvailable: '{extra.name} · Not available',
    featuring: 'Featuring', behind: 'Behind the story',
  } },
  templates: { card, row },
  slots: { shell, home },
  routes: { title, library },
  // Below 900 px the title page covers home; from 900 it stacks beside a 360 px home pane.
  detail: { from: 900, small: 'fullscreen', wide: 'stack', split: '360', frame: { flat: true } },
} satisfies SkinDocument;

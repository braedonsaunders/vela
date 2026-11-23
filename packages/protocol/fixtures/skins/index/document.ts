import { episodePage } from '../../../episode-page';
// Index: a quiet printed catalogue (light paper, serif type, plain lists), as a skin
// document (protocol/v0/skin.ts). It reproduces the compiled Index element for element:
// a reading rail beside the page on wide screens and a wrapped bar above it on phones,
// titles as ruled catalogue entries, and from 900 px a title page split beside a narrow
// home. Layout that depends on the slot's own width (a split pane is small) is written
// as `states` on `env.small`, never as window-width variants.
//
// Deliberate difference from the compiled Index (agreed with the orchestrator): opening a title
// from 900 px keeps the 360 px home pane where the reader was; compiled reset it to the top.
import type { Condition, Node, SkinDocument, Style } from '../../../skin';

const id = 'index';
const version = '1.0.14';
const asset = (file: string) => `/vela/v0/appearance/skins/${id}/${version}/${file}`;
const serif = 'Georgia, serif';
/** A rule under a box (and nothing on its other sides). */
const rule = (width: string, color: string): Style => ({
  'border-width': '0px',
  'border-style': 'solid',
  'border-top-width': '0px',
  'border-bottom-width': width,
  'border-bottom-color': color,
});
const small: Condition = { test: 'env.small' };
const ready: Condition = { test: 'env.load', is: 'eq', value: 'ready' };
const wide: Condition = { test: 'env.small', not: true };

/** A style that changes when the slot is small: the small state replaces the style whole. */
const responsive = (style: Style, smallStyle: Style) => ({
  style,
  states: [{ when: [small], style: { ...style, ...smallStyle } as Style }],
});

// A button with a ground of its own: compiled Exact washes it with 12% of its ink on hover and
// dims the whole control while pressed (drawn here, so they opt out of the renderer's states).
const inkWash = {
  hover: { 'background-image': 'linear-gradient(color-mix(in srgb, currentColor 12%, transparent) 0 0)' } as Style,
  active: { opacity: '0.65' },
  controlStates: false,
};

// A plain text button as Exact draws one: unset, a block, 4 px of padding, centred text.
const plain = (text: string, press: { action: 'home' | 'search' | 'live' | 'signOut' }, when: Condition[]): Node => ({
  type: 'box',
  press,
  label: text,
  when,
  style: { display: 'flex', 'flex-direction': 'column', padding: '4px', 'text-align': 'center' },
  children: [{ type: 'text', text }],
});

// ---------------------------------------------------------------- shell
const nav: Node = {
  type: 'box',
  role: 'navigation',
  label: '{s:mainNavigation}',
  ...responsive(
    {
      display: 'flex',
      'flex-direction': 'row',
      'flex-wrap': 'wrap',
      gap: '12px',
      'align-items': 'center',
      padding: '20px',
      'background-color': '$rail',
    },
    { padding: '12px' },
  ),
  children: [
    {
      type: 'image',
      src: 'assets/brand/vela-lockup-paper.svg',
      alt: '{s:vela}',
      style: { width: '58px', height: '22px' },
    },
    plain('{s:home}', { action: 'home' }, [{ test: 'env.viewer' }]),
    plain('{s:search}', { action: 'search' }, [{ test: 'env.viewer' }]),
    plain('{s:live}', { action: 'live' }, [{ test: 'env.canLive' }]),
    {
      type: 'box',
      press: { action: 'openPicker' },
      a11y: { haspopup: 'dialog' },
      label: '{s:choose}',
      testId: 'skin-picker',
      when: [{ test: 'env.skinCount', is: 'gt', value: '1' }],
      style: {
        display: 'flex',
        'flex-direction': 'column',
        padding: '6px 12px',
        'text-align': 'center',
        'background-color': '$field',
        border: '1px solid $line',
      },
      ...inkWash,
      children: [{ type: 'text', text: '{s:choose}', style: { 'font-size': '13px' } }],
    },
    { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
    { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
    // The reader: a small printed plate (their avatar where the server gives one, else their initial) and their name.
    { type: 'box', when: [{ test: 'env.viewer' }], style: { display: 'flex', 'flex-direction': 'row', gap: '8px', 'align-items': 'center', padding: '4px' }, children: [
      { type: 'text', text: '{env.viewerInitial}', style: { width: '22px', height: '22px', 'flex-shrink': '0', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', border: '1px solid $line', 'background-color': '$field', 'font-size': '12px' } },
      { type: 'text', text: '{env.viewer}', style: { 'font-size': '12px' } },
    ] },
    plain('{s:signOut}', { action: 'signOut' }, [{ test: 'env.viewer' }]),
    // Which Vela this is, where it runs and the server, as the rail's colophon: selectable, and on TV a stop the remote reaches.
    { type: 'box', when: [{ test: 'env.viewer' }, { test: 'env.aboutLine' }], readingStop: true, label: '{env.aboutLabel}', testId: 'about-line', style: { padding: '4px' },
      children: [{ type: 'text', text: '{env.aboutLine}', style: { 'font-size': '11px', 'line-height': '15px', color: '$secondary' } }] },
  ],
};

// Libraries remain reachable from the reading rail and from a scrollable phone strip.
const libraries: Node = {
  type: 'box', role: 'navigation', label: '{s:mainNavigation}', when: [{ test: 'env.viewer' }],
  style: { display: 'flex', 'flex-direction': 'column', gap: '4px', padding: '0px 20px 20px', 'background-color': '$rail' },
  small: { 'flex-direction': 'row', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', padding: '0px 12px 10px', gap: '12px' },
  children: [{ type: 'repeat', over: 'nav.destinations', item: {
    type: 'box', when: [{ test: 'dest.kind', is: 'ne', value: 'live' }], press: { action: 'library', arg: '{dest.id}' }, label: '{dest.name}',
    style: { position: 'relative', padding: '4px', 'flex-shrink': '0', 'white-space': 'nowrap' },
    children: [{ type: 'text', text: '{dest.name}' }],
  } }],
};

const shell: Node = {
  type: 'box',
  ...responsive(
    {
      position: 'relative',
      display: 'flex',
      'flex-direction': 'row',
      height: '100%',
      'min-height': '0px',
      'background-color': '$page',
      color: '$ink',
      'color-scheme': 'light',
      'font-family': serif,
    } as Style,
    { 'flex-direction': 'column' },
  ),
  children: [
    // Wide: an 11.25rem rail of the bar's ground, the bar wrapping inside it. Small: the bar alone.
    {
      type: 'box',
      ...responsive(
        {
          display: 'flex',
          'flex-direction': 'column',
          width: '11.25rem',
          'flex-shrink': '0',
          'background-color': '$rail',
        },
        { width: 'auto', 'flex-shrink': '1' },
      ),
      children: [nav, libraries],
    },
    {
      type: 'slot',
      slot: 'children',
      style: {
        display: 'flex',
        'flex-direction': 'column',
        'flex-grow': '1',
        'min-width': '0px',
        'min-height': '0px',
      } as Style,
      inner: {
        display: 'flex',
        'flex-direction': 'column',
        'flex-grow': '1',
        'min-height': '0px',
        height: '100%',
        width: '100%',
      } as Style,
    },
  ],
};

// ---------------------------------------------------------------- catalogue entries
const column = (text: string, width: string, when: Condition[], extra: Style = {}): Node => ({
  type: 'text',
  text,
  when,
  style: { width, 'font-size': '12px', color: '$secondary', ...extra },
});
const kinds: [string, string][] = [
  ['movie', 'film'],
  ['show', 'series'],
  ['episode', 'episode'],
  ['season', 'season'],
];

// One entry: the name (the pressable part), then kind, year, rating and genres in fixed
// columns; on a small slot the compact facts instead.
const card: Node = {
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'row',
    'align-items': 'center',
    gap: '12px',
    padding: '10px 0px',
    ...rule('1px', '$line'),
  },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    {
      type: 'box',
      press: { action: 'select', arg: '{card.kindId}' },
      label: '{card.label}',
      testId: 'title-{card.id}',
      style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'baseline', gap: '6px', flex: '1', 'min-width': '0px', padding: '4px', 'text-align': 'left' },
      children: [
        // Watched: a ticked entry, as a reader marks a printed catalogue, in a fixed margin so the
        // names stay aligned. The entry's name already says "watched" to assistive technology.
        { type: 'box', a11y: { hidden: true }, style: { width: '16px', 'flex-shrink': '0' }, children: [
          { type: 'text', when: [{ test: 'card.played' }], text: '✓', style: { 'font-size': '16px', 'font-weight': '700', color: '$accent' } },
        ] },
        { type: 'text', text: '{card.name}', style: { 'font-size': '16px', 'font-weight': '600', flex: '1', 'min-width': '0px' } },
      ],
    },
    ...kinds.map(([k, s]) => column(`{s:${s}}`, '80px', [wide, { test: 'card.kind', is: 'eq', value: k }])),
    column('{s:collection}', '80px', [
      wide,
      ...kinds.map(([k]) => ({ test: 'card.kind', is: 'ne' as const, value: k })),
    ]),
    column('{card.yearLabel}', '54px', [wide, { test: 'card.yearLabel' }]),
    column('{s:noYear}', '54px', [wide, { test: 'card.yearLabel', not: true }]),
    column('{card.rating}', '50px', [wide]),
    column('{card.genresComma}', '150px', [wide], { 'line-clamp': '1' }),
    column('{card.facts}', '100px', [small], { 'line-clamp': '1' }),
  ],
};

/** A titled list of entries: the heading, then one entry per element of `over`. */
const catalogue = (heading: string, over: string, when: Condition[] = []): Node => ({
  type: 'box',
  when,
  style: { display: 'flex', 'flex-direction': 'column', padding: '20px 4%', gap: '4px' },
  children: [
    { type: 'text', text: heading, role: 'heading', level: 2, style: { 'font-size': '24px', 'font-weight': '700' } },
    { type: 'repeat', over, item: { type: 'use', template: 'card' } },
  ],
});

// A home row, then (when the server has more) the 1 px sentinel that asks for it and the
// waiting line while it comes.
const loadingMore = (when: Condition[]): Node => ({
  type: 'text',
  text: '{s:loadingMore}',
  role: 'status',
  when,
  style: { color: '$secondary', padding: '8px 4%' },
});
const row: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column' },
  children: [
    catalogue('{row.name}', 'row.items'),
    {
      type: 'box',
      when: [{ test: 'row.hasMore' }],
      style: { height: '1px' },
      children: [{ type: 'widget', widget: 'sentinel', params: { on: 'row' } }],
    },
    loadingMore([{ test: 'row.hasMore' }, { test: 'row.loadingMore' }]),
  ],
};

// ---------------------------------------------------------------- home
// A plain Contract button with no ground of its own, as Exact draws it ("bordered"): a hairline
// in the label colour at 45%, the control radius (8px x Exact's curve reach, 1.52 where corner-shape
// is supported: a var() radius is not bound) and curve, the label colour at weight 500, centred.
// Exact's bordered button washes its ground on hover (quaternary) and while pressed (tertiary)
// and does not dim; it opts out of the renderer's pressed dim.
const borderedStates = {
  hover: { 'background-image': 'linear-gradient(var(--exact-quaternary-fill) 0 0)' } as Style,
  active: { 'background-image': 'linear-gradient(var(--exact-tertiary-fill) 0 0)' } as Style,
  controlStates: false,
};
const bordered: Style = {
  display: 'flex',
  'flex-direction': 'column',
  'justify-content': 'center',
  'align-items': 'center',
  padding: '16px',
  border: '1px solid var(--exact-line)',
  'border-radius': '12.16px',
  'corner-shape': 'var(--exact-control-curve, var(--exact-curve))',
  color: 'var(--exact-label)',
  'font-weight': '500',
  'line-height': '20px',
  'text-align': 'center',
};

// A loading or failure moment: the message, 32 px in, and after a failure Try again.
const status = (text: string, when: Condition[], retry = false): Node => ({
  type: 'box',
  when,
  style: { display: 'flex', 'flex-direction': 'column', gap: '12px', padding: '32px', 'align-items': 'flex-start' },
  children: [
    { type: 'text', text, role: 'status' },
    ...(retry
      ? [
          {
            type: 'box',
            when: [{ test: 'env.canRetry' }],
            press: { action: 'retry' },
            label: '{s:tryAgain}',
            style: { ...bordered, padding: '8px 16px' },
            ...borderedStates,
            children: [{ type: 'text', text: '{s:tryAgain}' }],
          } as Node,
        ]
      : []),
  ],
});

// Compiled, the heading, the search field and the featured title share one column
// (padding 24px 4%, gap 18px); here they are siblings carrying that padding and gap.
const home: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column', 'background-color': '$page', color: '$ink' },
  children: [
    // Before home is known, Index shows only the message, plainly (as its compiled Status: no retry).
    status('{s:findingEvening}', [{ test: 'env.load', is: 'eq', value: 'loading' }]),
    status('{s:unreachable}', [{ test: 'env.load', is: 'eq', value: 'failed' }], true),
    {
      type: 'box',
      when: [ready],
      style: { display: 'flex', 'flex-direction': 'column', padding: '24px 4% 0px' },
      children: [
        {
          type: 'text',
          text: '{s:viewingIndex}',
          role: 'heading',
          level: 1,
          ...responsive({ 'font-size': '42px', 'font-weight': '700' }, { 'font-size': '28px' }),
        },
      ],
    },
    // The search field: a bold label, the bare input and a plain Clear over a 2 px rule.
    {
      type: 'box',
      when: [ready],
      style: {
        display: 'flex',
        'flex-direction': 'row',
        'align-items': 'center',
        gap: '12px',
        margin: '18px 4% 0px',
        padding: '8px 0px',
        ...rule('2px', '$ink'),
      },
      children: [
        { type: 'text', text: '{s:searchLabel}', style: { 'font-size': '12px', 'font-weight': '700' } },
        {
          type: 'widget',
          widget: 'searchInput',
          params: {
            placeholder: '{s:searchPlaceholder}',
            label: '{s:searchLibrary}',
            placeholderColor: '$placeholder',
          },
          style: {
            flex: '1',
            'min-width': '0px',
            padding: '8px',
            color: '$ink',
            'font-family': serif,
            'font-size': '16px',
          },
        },
        {
          type: 'box',
          when: [{ test: 'env.query' }],
          press: { action: 'clearSearch' },
          label: '{s:clearSearch}',
          style: { display: 'flex', 'flex-direction': 'column', 'text-align': 'center' },
          children: [{ type: 'text', text: '{s:clear}' }],
        },
      ],
    },
    {
      type: 'box',
      when: [ready, { test: 'env.searching', not: true }],
      style: { display: 'flex', 'flex-direction': 'column', padding: '0px 4%' },
      children: [
        {
          type: 'repeat',
          over: 'home.hero',
          item: {
            type: 'box',
            style: {
              display: 'flex',
              'flex-direction': 'column',
              gap: '8px',
              padding: '16px 0px',
              'margin-top': '18px',
            },
            children: [
              { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
              { type: 'text', text: '{s:featured}', style: { 'font-size': '11px', 'letter-spacing': '2px' } },
              {
                type: 'box',
                press: { action: 'select', arg: '{hero.kindId}' },
                label: '{hero.label}',
                style: { display: 'flex', 'flex-direction': 'column', 'text-align': 'left' },
                children: [{ type: 'text', text: '{hero.name}', style: { 'font-size': '26px', 'font-weight': '700' } }],
              },
              { type: 'text', text: '{hero.facts}', style: { 'font-size': '12px' } },
              { type: 'text', text: '{hero.summary}', style: { 'font-size': '14px', 'line-clamp': '2' } },
            ],
          },
        },
      ],
    },
    { type: 'box', when: [ready], style: { height: '24px' } },
    {
      type: 'box',
      when: [ready, { test: 'env.searching', not: true }],
      style: { display: 'flex', 'flex-direction': 'column' },
      children: [
        { type: 'repeat', over: 'home.rows', item: { type: 'use', template: 'row' } },
        {
          type: 'box',
          when: [{ test: 'env.homeHasMore' }],
          style: { height: '1px' },
          children: [{ type: 'widget', widget: 'sentinel', params: { on: 'home' } }],
        },
        loadingMore([{ test: 'env.homeHasMore' }, { test: 'env.homeMoreLoading' }]),
      ],
    },
  ],
};

// ---------------------------------------------------------------- library
// A library's titles in the server's order, a way back and a way to load more.
const library: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column' },
  children: [
    status('{s:findingTitles}', [{ test: 'env.load', is: 'eq', value: 'loading' }]),
    status('{s:libraryFailed}', [{ test: 'env.load', is: 'eq', value: 'failed' }], true),
    {
      type: 'box',
      when: [ready],
      press: { action: 'home' },
      label: '{s:back}',
      style: bordered,
      ...borderedStates,
      children: [{ type: 'text', text: '{s:back}' }],
    },
    { type: 'use', template: 'velaLibraryViews', when: [ready] },
    { type: 'use', template: 'velaLibraryFilters', when: [ready] },
    { type: 'use', template: 'velaLibraryAlternative' },
    catalogue('{library.name}', 'library.items', [ready, { test: 'library.view', is: 'eq', value: 'library' }]),
    { type: 'box', role: 'status', when: [ready, { test: 'library.view', is: 'eq', value: 'library' }, { test: 'library.itemCount', is: 'eq', value: '0' }],
      style: { padding: '24px 4%', display: 'flex', 'flex-direction': 'column', gap: '8px' }, children: [
        { type: 'text', text: '{t:library.empty}', style: { 'font-size': '20px' } },
        { type: 'text', text: '{t:library.emptyHint}', style: { 'font-size': '14px' } },
      ] },
    {
      type: 'box',
      when: [ready, { test: 'library.view', is: 'eq', value: 'library' }, { test: 'library.more' }],
      press: { action: 'libraryMore' },
      disabled: [{ test: 'env.libraryMoreLoading' }],
      label: '{s:showMore}',
      style: bordered,
      ...borderedStates,
      children: [{ type: 'text', text: '{s:showMore}' }],
    },
  ],
};

// A collection's titles in server order, under a way back.
const collection: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column' },
  children: [
    status('{s:openingCollection}', [{ test: 'env.load', is: 'eq', value: 'loading' }]),
    status('{s:collectionFailed}', [{ test: 'env.load', is: 'eq', value: 'failed' }], true),
    {
      type: 'box',
      when: [ready],
      press: { action: 'back' },
      label: '{s:back}',
      style: bordered,
      ...borderedStates,
      children: [{ type: 'text', text: '{s:back}' }],
    },
    catalogue('{collection.name}', 'collection.items', [ready]),
  ],
};

// ---------------------------------------------------------------- signed out
// Compiled Index signs in on the default stage inside its own shell: drifting light, a vignette
// and grain behind a glass card.
const display: Style = {
  'font-family': '"Index Display", "Iowan Old Style", Georgia, serif',
  'font-weight': '400',
  'letter-spacing': '-0.01em',
  'line-height': '0.98',
};
const eyebrow: Style = {
  'font-size': '10px',
  'font-weight': '600',
  'letter-spacing': '0.24em',
  'text-transform': 'uppercase',
  color: '$stage-quiet',
};
const ring = { 'box-shadow': '0px 0px 0px 2px $stage, 0px 0px 0px 4px $warm' } as Style;
const pill = (primary: boolean): Style =>
  ({
    display: 'flex',
    'flex-direction': 'row',
    gap: '10px',
    'align-items': 'center',
    'justify-content': 'center',
    // Compiled drew 52 px of content inside a ghost pill's 1 px border: 54 px border-box.
    height: primary ? '52px' : '54px',
    'box-sizing': 'border-box',
    'border-radius': '999px',
    ...(primary
      ? { border: 'none', 'background-color': '$stage-ink', color: '$stage-inverse', 'font-weight': '650' }
      : {
          border: '1px solid $glass-edge',
          'background-color': '$control',
          'backdrop-filter': 'blur(20px) saturate(1.3)',
          color: '$stage-ink',
          'font-weight': '600',
        }),
  }) as Style;
// Three soft lights that breathe in turn (the stage's indeterminate progress); still, they rest at .8.
const dot = (delay: number): Node => ({
  type: 'box',
  motion: `pulse${delay}`,
  style: { width: '7px', height: '7px', 'border-radius': '4px', 'background-color': '$warm' },
  states: [
    {
      when: [{ test: 'env.still' }],
      style: { width: '7px', height: '7px', 'border-radius': '4px', 'background-color': '$warm', opacity: '0.8' },
    },
  ],
});
const glow = (when: Condition[]): Node => ({
  type: 'box',
  when,
  a11y: { hidden: true },
  style: { display: 'flex', 'flex-direction': 'row', gap: '8px' },
  children: [dot(0), dot(180), dot(360)],
});
const aurora = (motion: string, place: Style, colour: string, opacity: string): Node => ({
  type: 'box',
  motion,
  style: {
    position: 'absolute',
    'border-radius': '50%',
    opacity,
    'background-image': `radial-gradient(circle, ${colour} 0%, $clear 68%)`,
    ...place,
  } as Style,
});
// The card's content is one flat column: each part carries its own top margin for the compiled
// groups' gaps (26 between groups, 10 in the heading, 16 between fields, 8 under a label).
const onSignIn: Condition = { test: 'env.auth', is: 'eq', value: 'signin' };
const at = (top: string, extra: Style = {}): Style => ({ 'margin-top': top, ...extra }) as Style;
const fieldParts = (name: 'username' | 'password', label: string, top: string): Node[] => [
  {
    type: 'text',
    text: label,
    when: [onSignIn, { test: 'signin.canPassword' }],
    motion: 'enter60',
    style: { ...eyebrow, ...at(top), 'margin-bottom': '8px' } as Style,
  },
  {
    type: 'widget',
    widget: 'textInput',
    when: [onSignIn, { test: 'signin.canPassword' }],
    motion: 'enter60',
    params: { field: name, label },
    style: {
      height: '52px',
      'box-sizing': 'border-box',
      padding: '0px 18px',
      'border-radius': '14px',
      border: '1px solid $glass-edge',
      'background-color': '$field-ground',
      color: '$stage-ink',
      'font-size': '16px',
      'font-family': serif,
      outline: 'none',
      transition: 'border-color 180ms linear, box-shadow 360ms cubic-bezier(0.16, 1, 0.3, 1)',
    } as Style,
    hover: { 'border-color': '$glass-edge-strong' },
    focus: { 'border-color': '$warm', 'box-shadow': '0px 0px 0px 4px $focus-halo', outline: 'none' } as Style,
  },
];

// The sign-in step: heading, the error when there is one, the fields and Sign in, then a code.
const signIn: Node[] = [
  {
    type: 'text',
    text: '{s:welcome}',
    role: 'heading',
    level: 1,
    when: [onSignIn],
    motion: 'enter60',
    style: { ...display, 'font-size': '42px', color: '$stage-ink' },
  },
  {
    type: 'text',
    text: '{s:signInTo}',
    when: [onSignIn],
    motion: 'enter60',
    style: { ...at('10px'), color: '$stage-secondary', 'font-size': '15px', 'line-height': '1.5' },
  },
  // The server also answers at an HTTPS address: offer it before a password is typed here.
  {
    type: 'box',
    when: [onSignIn, { test: 'signin.secureOrigin' }],
    motion: 'enter120',
    style: {
      ...at('26px'),
      display: 'flex',
      'flex-direction': 'column',
      gap: '12px',
      padding: '16px',
      'border-radius': '16px',
      'background-color': '$secure',
      border: '1px solid $secure-edge',
    },
    children: [
      {
        type: 'box',
        style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
        children: [
          {
            type: 'icon',
            symbol: 'lock',
            a11y: { hidden: true },
            style: { width: '16px', height: '16px', color: '$warm' },
          },
          { type: 'text', text: '{s:secureTitle}', style: { 'font-size': '14px', 'font-weight': '650' } },
        ],
      },
      {
        type: 'text',
        text: '{s:secureBody}',
        style: { 'font-size': '13px', 'line-height': '1.5', color: '$stage-secondary' },
      },
      {
        type: 'box',
        press: { action: 'goSecure' },
        testId: 'secure-switch',
        label: '{s:secureAction}',
        disabled: [{ test: 'signin.secureBusy' }],
        controlStates: false,
        style: {
          ...pill(false),
          height: '44px',
          'padding-left': '18px',
          'padding-right': '18px',
          'align-self': 'flex-start',
          transition:
            'background-color 180ms linear, border-color 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
        } as Style,
        hover: { 'background-color': '$control-hover', 'border-color': '$glass-edge-strong' },
        active: { scale: '0.97' },
        focus: ring,
        disabledStyle: { opacity: '0.42' },
        children: [
          glow([{ test: 'signin.secureBusy' }]),
          { type: 'text', text: '{s:secureAction}', style: { 'font-size': '14px' } },
        ],
      },
      {
        type: 'text',
        text: '{signin.secureError}',
        role: 'alert',
        when: [{ test: 'signin.secureError' }],
        style: { 'font-size': '12px', color: '$warm' },
      },
    ],
  },
  {
    type: 'box',
    when: [onSignIn, { test: 'signin.error' }],
    role: 'alert',
    motion: 'enter0',
    style: {
      ...at('26px'),
      display: 'flex',
      'flex-direction': 'row',
      gap: '10px',
      'align-items': 'flex-start',
      padding: '12px 14px',
      'border-radius': '14px',
      'background-color': '$alert',
      border: '1px solid $alert-edge',
    },
    children: [
      { type: 'icon', symbol: 'alert', style: { width: '18px', height: '18px', color: '$warm', 'flex-shrink': '0' } },
      {
        type: 'text',
        text: '{signin.error}',
        style: { color: '$stage-ink', 'font-size': '14px', 'line-height': '1.45' },
      },
    ],
  },
  ...fieldParts('username', '{s:username}', '26px'),
  ...fieldParts('password', '{s:password}', '16px'),
  {
    type: 'box',
    when: [onSignIn, { test: 'signin.canPassword' }],
    motion: 'enter60',
    press: { action: 'signIn' },
    testId: 'sign-in',
    label: '{s:signIn}',
    disabled: [{ test: 'signin.ready', not: true }],
    controlStates: false,
    style: {
      ...pill(true),
      ...at('22px'),
      transition: 'background-color 180ms linear, opacity 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
    } as Style,
    hover: { 'background-color': '$primary-hover' },
    active: { scale: '0.97' },
    focus: ring,
    disabledStyle: { 'background-color': '$control-hover', color: '$stage-quiet' },
    children: [
      glow([{ test: 'signin.busy' }]),
      {
        type: 'text',
        text: '{s:signingIn}',
        when: [{ test: 'signin.busy' }],
        style: { 'font-size': '15px', 'font-weight': '650' },
      },
      {
        type: 'text',
        text: '{s:signIn}',
        when: [{ test: 'signin.busy', not: true }],
        style: { 'font-size': '15px', 'font-weight': '650' },
      },
    ],
  },
  {
    type: 'box',
    when: [onSignIn, { test: 'signin.canPassword' }, { test: 'signin.canQuick' }],
    motion: 'enter60',
    a11y: { hidden: true },
    style: { ...at('26px'), display: 'flex', 'flex-direction': 'row', gap: '14px', 'align-items': 'center' },
    children: [
      { type: 'box', style: { flex: '1', height: '1px', 'background-color': '$glass-edge' } },
      { type: 'text', text: '{s:or}', style: { 'font-size': '12px', color: '$stage-quiet' } },
      { type: 'box', style: { flex: '1', height: '1px', 'background-color': '$glass-edge' } },
    ],
  },
  {
    type: 'box',
    when: [onSignIn, { test: 'signin.canQuick' }],
    motion: 'enter60',
    press: { action: 'startQuick' },
    testId: 'quick-connect',
    label: '{s:withCode}',
    disabled: [{ test: 'signin.busy' }],
    controlStates: false,
    style: {
      ...pill(false),
      ...at('26px'),
      transition: 'background-color 180ms linear, border-color 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
    } as Style,
    hover: { 'background-color': '$control-hover', 'border-color': '$glass-edge-strong' },
    active: { scale: '0.97' },
    focus: ring,
    disabledStyle: { opacity: '0.42' },
    children: [
      { type: 'icon', symbol: 'smartphone', style: { width: '18px', height: '18px' } },
      { type: 'text', text: '{s:withCode}', style: { 'font-size': '15px' } },
    ],
  },
  {
    type: 'text',
    text: '{s:noMethods}',
    role: 'status',
    when: [onSignIn, { test: 'signin.canPassword', not: true }, { test: 'signin.canQuick', not: true }],
    motion: 'enter60',
    style: { ...at('26px'), color: '$stage-secondary', 'font-size': '14px', 'line-height': '1.55' },
  },
];

// Quick connect: the code one tile per character, the wait, and a way back.
const onQuick: Condition = { test: 'env.auth', is: 'eq', value: 'quick' };
const centred = (top: string, extra: Style = {}): Style =>
  ({ ...at(top), 'align-self': 'center', 'text-align': 'center', ...extra }) as Style;
const quick: Node[] = [
  {
    type: 'text',
    text: '{s:easierWay}',
    role: 'heading',
    level: 1,
    when: [onQuick],
    motion: 'enter60',
    style: { ...display, ...centred('0px'), 'font-size': '42px', color: '$stage-ink' },
  },
  {
    type: 'text',
    text: '{s:approve}',
    when: [onQuick],
    motion: 'enter60',
    style: {
      ...centred('10px', { 'max-width': '300px' }),
      color: '$stage-secondary',
      'font-size': '15px',
      'line-height': '1.5',
    },
  },
  {
    type: 'box',
    when: [onQuick],
    testId: 'connect-code',
    role: 'text',
    label: '{quick.code}',
    motion: 'enter60',
    style: {
      ...at('26px'),
      display: 'flex',
      'flex-direction': 'row',
      width: '100%',
      gap: '6px',
      'justify-content': 'center',
    },
    children: [
      {
        type: 'repeat',
        over: 'quick.chars',
        item: {
          type: 'text',
          text: '{char.text}',
          a11y: { hidden: true },
          motion: 'enter120',
          stagger: { step: 45, cap: 16 },
          style: {
            flex: '1',
            'max-width': '44px',
            height: '54px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'border-radius': '12px',
            'background-color': '$glass-deep',
            border: '1px solid $glass-edge',
            'box-shadow': 'inset 0px 1px 0px $ring',
            'font-family': 'ui-monospace, "SF Mono", Menlo, monospace',
            'font-size': '24px',
            'font-weight': '600',
            color: '$warm',
          },
        },
      },
    ],
  },
  {
    type: 'box',
    when: [onQuick],
    role: 'status',
    motion: 'enter60',
    style: { ...centred('26px'), display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
    children: [
      glow([{ test: 'quick.error', not: true }]),
      {
        type: 'text',
        text: '{s:waiting}',
        when: [{ test: 'quick.error', not: true }],
        style: { color: '$stage-secondary', 'font-size': '14px' },
      },
      {
        type: 'text',
        text: '{quick.error}',
        when: [{ test: 'quick.error' }],
        style: { color: '$warm', 'font-size': '14px' },
      },
    ],
  },
  {
    type: 'text',
    text: '{s:expires}',
    when: [onQuick],
    motion: 'enter60',
    style: { ...centred('10px'), color: '$stage-quiet', 'font-size': '12px' },
  },
  {
    type: 'box',
    when: [onQuick],
    motion: 'enter60',
    press: { action: 'cancelQuick' },
    label: '{s:cancel}',
    controlStates: false,
    style: {
      ...pill(false),
      ...centred('26px'),
      height: '48px',
      padding: '0px 28px',
      transition: 'background-color 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
    } as Style,
    hover: { 'background-color': '$control-hover', 'border-color': '$glass-edge-strong' },
    active: { scale: '0.97' },
    focus: ring,
    children: [{ type: 'text', text: '{s:cancel}', style: { 'font-size': '14px' } }],
  },
];

const notice = (when: Condition[], children: Node[], role: string): Node => ({
  type: 'box',
  when,
  role,
  motion: 'enter0',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    gap: '18px',
    'align-items': 'center',
    'text-align': 'center',
    padding: '12px 0px',
  },
  children,
});

// The stage itself is the route's root: it centres the lockup and the glass card.
const auth: Node = {
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'min-height': '100dvh',
    width: '100%',
    'box-sizing': 'border-box',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    color: '$stage-ink',
    'align-items': 'center',
    'justify-content': 'center',
    padding: 'max(28px, 7vh) 16px',
    'background-color': '$stage',
  },
  children: [
    {
      type: 'box',
      a11y: { hidden: true },
      style: { position: 'absolute', inset: '0px', 'pointer-events': 'none' },
      children: [
        {
          type: 'image',
          src: '{env.authBackdrop}',
          alt: '',
          when: [{ test: 'env.authBackdrop' }],
          style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' },
        },
        aurora('auroraA', { width: '72vmax', height: '72vmax', left: '-22vmax', top: '-30vmax' }, '$ember', '0.5'),
        aurora('auroraB', { width: '80vmax', height: '80vmax', right: '-30vmax', bottom: '-42vmax' }, '$tide', '0.55'),
        aurora('auroraC', { width: '54vmax', height: '54vmax', left: '34%', top: '18%' }, '$dusk', '0.35'),
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            'background-image': 'radial-gradient(ellipse 110% 85% at 50% 42%, $clear 35%, $vignette 100%)',
          },
        },
        {
          type: 'image',
          src: 'assets/grain.svg',
          alt: '',
          style: {
            position: 'absolute',
            inset: '0px',
            width: '100%',
            height: '100%',
            'object-fit': 'fill',
            opacity: '0.06',
          },
        },
      ],
    },
    {
      type: 'image',
      src: '{env.authWordmark}',
      alt: '',
      a11y: { hidden: true },
      when: [{ test: 'env.authWordmark' }],
      motion: 'enter0',
      style: { position: 'relative', height: '56px', width: 'auto', 'max-width': '100%' },
    },
    {
      type: 'image',
      src: 'assets/brand/vela-stacked.svg',
      alt: '',
      a11y: { hidden: true },
      when: [{ test: 'env.authWordmark', not: true }],
      motion: 'enter0',
      style: { position: 'relative', width: '60px', height: '104px' },
    },
    {
      type: 'box',
      layoutTransition: '560ms ease-out',
      motion: 'enter0',
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'column',
        width: '100%',
        'max-width': '448px',
        'margin-top': '32px',
        'box-sizing': 'border-box',
        padding: 'clamp(28px, 5vw, 44px) clamp(22px, 4.5vw, 40px)',
        'border-radius': '28px',
        'background-color': '$glass',
        'backdrop-filter': 'blur(28px) saturate(1.4)',
        border: '1px solid $glass-edge',
        'box-shadow': '0px 40px 120px $card-shadow, inset 0px 1px 0px $ring',
      },
      children: [
        notice(
          [{ test: 'env.auth', is: 'eq', value: 'offline' }],
          [
            { type: 'icon', symbol: 'alert', style: { width: '28px', height: '28px', color: '$warm' } },
            {
              type: 'text',
              text: '{s:unreachableTitle}',
              role: 'heading',
              level: 1,
              style: { ...display, 'font-size': '34px' },
            },
            {
              type: 'text',
              text: '{s:unreachableBody}',
              style: { color: '$stage-secondary', 'font-size': '15px', 'line-height': '1.55' },
            },
          ],
          'alert',
        ),
        notice(
          [{ test: 'env.auth', is: 'eq', value: 'connecting' }],
          [
            glow([]),
            { type: 'text', text: '{s:connecting}', style: { color: '$stage-secondary', 'font-size': '15px' } },
          ],
          'status',
        ),
        notice(
          [{ test: 'env.auth', is: 'eq', value: 'redeeming' }],
          [
            glow([]),
            { type: 'text', text: '{s:redeeming}', style: { color: '$stage-secondary', 'font-size': '15px' } },
          ],
          'status',
        ),
        ...signIn,
        ...quick,
      ],
    },
  ],
};

// ---------------------------------------------------------------- title
const section = (heading: string, when: Condition[], children: Node[], gap: string): Node => ({
  type: 'box',
  when,
  style: { display: 'flex', 'flex-direction': 'column', padding: '0px 7%', gap },
  children: [
    { type: 'text', text: heading, role: 'heading', level: 2, style: { 'font-size': '24px', 'font-weight': '700' } },
    ...children,
  ],
});
// A pressable block whose text is its accessible name, as a compiled button with a text child.
const playButton = (text: string, when: Condition[]): Node => ({
  type: 'box',
  when,
  press: { action: 'play', arg: '{detail.id}' },
  testId: 'detail-play',
  label: text,
  style: {
    display: 'flex',
    'flex-direction': 'column',
    'align-self': 'start',
    padding: '12px 20px',
    'text-align': 'center',
    'background-color': '$ink',
    color: '$page',
  },
  ...inkWash,
  children: [{ type: 'text', text }],
});
// An extra keeps its place in server order whether or not it is ready; one that is not is shown, disabled.
// Exact dims a disabled button to half opacity; the box carries that here.
const extraButton = (text: string, ready: boolean): Node => ({
  type: 'box',
  when: [{ test: 'extra.ready', not: !ready }],
  press: { action: 'playExtra', arg: '{extra.id}' },
  label: text,
  ...(ready ? {} : { disabled: [{ test: 'extra.ready', not: true }], disabledStyle: { opacity: '0.5' } }),
  style: { display: 'flex', 'flex-direction': 'column', padding: '16px', 'text-align': 'left', 'background-color': '$rail' },
  ...inkWash,
  children: [{ type: 'text', text }],
});

const detail: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column', gap: '28px', 'padding-bottom': '48px' },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', padding: '32px 4%', gap: '24px', 'align-items': 'start' },
      children: [
        {
          type: 'image',
          src: '{detail.poster}',
          alt: '',
          when: [wide, { test: 'detail.poster' }],
          style: { width: '180px', height: '270px', 'object-fit': 'cover' },
        },
        {
          type: 'box',
          style: { display: 'flex', 'flex-direction': 'column', flex: '1', gap: '16px' },
          children: [
            { type: 'text', text: '{detail.kindLabel}', style: { 'font-size': '11px', 'letter-spacing': '2px' } },
            {
              type: 'text',
              text: '{detail.name}',
              role: 'heading',
              level: 1,
              ...responsive({ 'font-size': '48px', 'font-weight': '700' }, { 'font-size': '32px' }),
            },
            { type: 'use', template: 'velaEpisodeContext' },
            { type: 'text', text: '{detail.facts}', style: { 'font-size': '13px' } },
            { type: 'use', template: 'velaSummary', style: { 'font-size': '16px', 'line-height': '1.6' } },
            { type: 'box', style: { 'flex-direction': 'row', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '10px' }, children: [
              playButton('{s:resume}', [{ test: 'detail.canPlay' }, { test: 'detail.hasResume' }]),
              playButton('{s:play}', [{ test: 'detail.canPlay' }, { test: 'detail.hasResume', not: true }]),
              { type: 'widget', widget: 'titleActions' },
            ] },
          ],
        },
      ],
    },
    section('{s:seasons}', [{ test: 'detail.seasonCount', is: 'gt', value: '0' }], [{
      type: 'repeat', over: 'detail.seasons', item: {
        type: 'box', role: 'tab', label: '{card.name}', press: { action: 'select', arg: '{season.pick}' },
        a11y: { selected: [{ test: 'season.on' }] },
        style: { padding: '12px 16px', 'border-radius': '3px' },
        states: [{ when: [{ test: 'season.on' }], style: { padding: '12px 16px', 'border-radius': '3px', 'background-color': '$ink', color: '$page' } }],
        focus: { 'box-shadow': '0px 0px 0px 3px $ink' },
        children: [{ type: 'text', text: '{card.name}' }],
      },
    }], '4px'),
    catalogue('{s:episodes}', 'detail.episodes', [{ test: 'detail.hasEpisodes' }]),
    section(
      '{s:extras}',
      [{ test: 'detail.hasExtras' }],
      [
        {
          type: 'repeat',
          over: 'detail.extras',
          item: {
            type: 'box',
            style: { display: 'flex', 'flex-direction': 'column' },
            children: [extraButton('{extra.name}', true), extraButton('{s:notAvailable}', false)],
          },
        },
      ],
      '14px',
    ),
    section(
      '{s:featuring}',
      [{ test: 'detail.castLine' }],
      [{ type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '12px' }, children: [{ type: 'repeat', over: 'detail.cast', item: { type: 'box', press: { action: 'person', arg: '{person.name}' }, label: '{person.name}', focus: { 'box-shadow': '0px 0px 0px 4px $ui.accent' }, style: { padding: '4px', color: '$secondary' }, children: [{ type: 'text', text: '{person.name}' }] } }] }],
      '12px',
    ),
    section(
      '{s:behind}',
      [{ test: 'detail.crewLine' }],
      [{ type: 'text', text: '{detail.crewLine}', style: { 'line-height': '1.6' } }],
      '12px',
    ),
    { type: 'repeat', over: 'detail.related', item: { type: 'use', template: 'row' } },
  ],
};

// The flat title page: the page ground, the round close control, one scroll region.
const title: Node = {
  type: 'box',
  style: {
    width: '100%',
    height: '100%',
    display: 'flex',
    'flex-direction': 'column',
    'background-color': '$page',
    color: '$ink',
  },
  children: [
    {
      type: 'box',
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'column',
        flex: '1',
        'min-height': '0px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$page',
      },
      children: [
        {
          type: 'box',
          press: { action: 'back' },
          label: '{s:closeTitle}',
          testId: 'detail-close',
          id: 'back',
          style: {
            position: 'absolute',
            top: '20px',
            right: '20px',
            'z-index': '10',
            width: '44px',
            height: '44px',
            'box-sizing': 'border-box',
            padding: '13px',
            border: '1px solid $close-line',
            'border-radius': '22px',
            'background-color': '$glass-close',
            'backdrop-filter': 'blur(20px) saturate(1.3)',
            color: '$stage-ink',
          },
          ...inkWash,
          children: [{ type: 'icon', symbol: 'close', style: { width: '19.2px', height: '19.2px' } }],
        },
        {
          type: 'box',
          id: '{env.route}-scroll-{env.entry}',
          role: 'region',
          label: '{s:titleDetails}',
          style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px', 'overflow-x': 'auto', 'overflow-y': 'auto' },
          children: [
            status('{env.loadMessage}', [{ test: 'env.load', is: 'eq', value: 'failed' }], true),
            status('{s:opening}', [{ test: 'env.load', is: 'eq', value: 'loading' }]),
            { ...detail, when: [{ test: 'env.load', is: 'eq', value: 'ready' }] },
          ],
        },
      ],
    },
  ],
};

export default {
  schema: 1,
  renderer: 18,
  status: true,
  id,
  name: 'Index',
  version,
  tagline: 'A quiet printed catalogue: light paper, serif type, plain lists.',
  preview: asset('preview.jpg'),
  swatches: ['#f3f0e8', '#22221e', '#813b31', '#e3dfd3', '#bcb8ae'],
  // Sections cut rather than slide; nothing fades under a bar.
  fonts: {
    display: { family: 'Index Display', files: [{ url: asset('instrument-serif.ttf'), weight: 400, style: 'normal' }] },
  },
  traits: { panSections: false, barMask: false, page: '$page', ink: '$ink', splashOnPaper: true },
  // Index's paper, ink and oxblood accent, for the routes it inherits (search).
  ui: {
    page: '#f3f0e8', raised: '#ffffff', ink: '#22221e', inkSecondary: '#55554d', inkQuiet: '#76746b',
    inkInverse: '#f3f0e8', inkHover: '#3d3d36', accent: '#813b31', onAccent: '#f3f0e8', control: '#22221e0f',
    controlHover: '#22221e1a', glass: '#f3f0e8d9', glassEdge: '#d6d1c6', glassEdgeStrong: '#bcb8ae',
    popover: '#fffffff7', scrim: '#22221e66', track: '#22221e1f', trackStrong: '#22221e38',
    focusHalo: '#813b3133', shadow: '#22221e33', skeleton: '#e9e1d3', skeletonLight: '#f7f3ea',
    alert: '#813b311a', live: '#b3261e',
    font: 'system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif',
    fontDisplay: '"Index Display", "Iowan Old Style", Georgia, serif', radiusControl: 999, radiusCard: 4,
    radiusPanel: 14,
  },
  tokens: {
    // The signed-out stage and the title page's close control keep the default skin's night palette.
    stage: '#090b0e',
    'stage-ink': '#f5f1e9',
    'stage-secondary': '#b6b8bb',
    'stage-quiet': '#858d98',
    'stage-inverse': '#111419',
    warm: '#dcb998',
    ember: '#c0703f',
    tide: '#1f5a6b',
    dusk: '#5b2a4a',
    clear: '#090b0e00',
    vignette: '#000000b3',
    glass: '#12151bb3',
    'glass-deep': '#0c0e12e6',
    'glass-edge': '#ffffff1a',
    'glass-edge-strong': '#ffffff33',
    'glass-close': '#1b2028dd',
    'close-line': '#ffffff24',
    ring: '#ffffff2e',
    'card-shadow': '#00000088',
    control: '#ffffff16',
    'control-hover': '#ffffff26',
    'primary-hover': '#ffffff',
    'field-ground': '#ffffff12',
    'focus-halo': '#dcb99833',
    alert: '#c0703f1f',
    'alert-edge': '#c0703f4d',
    secure: '#dcb99812',
    'secure-edge': '#dcb99840',
    page: '#f3f0e8',
    ink: '#22221e',
    placeholder: 'rgba(60, 60, 67, 0.3)',
    rail: '#e3dfd3',
    field: '#ffffff',
    secondary: '#55554d',
    line: '#bcb8ae',
    accent: '#813b31',
    separator: '#d6d1c6',
    airing: '#e9e1d3',
    'video-header': '#000000dd',
    'video-footer': '#000000ee',
    'on-video': '#f5f1e9',
    'video-line': '#ffffff24',
    'video-ground': '#090b0e',
  },
  strings: {
    en: {
      mainNavigation: 'Main navigation',
      vela: 'vela',
      home: 'Home',
      search: 'Search',
      live: 'Live TV',
      choose: 'Change appearance',
      install: 'Install Vela',
      update: 'Update ready, reload',
      signOut: 'Sign out',
      findingEvening: 'Finding your evening…',
      unreachable: "Your library couldn't be reached. Check your server connection.",
      viewingIndex: 'THE VIEWING INDEX',
      searchLabel: 'SEARCH',
      searchPlaceholder: 'Title, person, or description',
      searchLibrary: 'Search your library',
      clearSearch: 'Clear search',
      clear: 'Clear',
      featured: 'FEATURED',
      loadingMore: 'Loading more…',
      film: 'Film',
      series: 'Series',
      episode: 'Episode',
      season: 'Season',
      collection: 'Collection',
      noYear: '—',
      closeTitle: 'Close title',
      titleDetails: 'Title details',
      opening: 'Opening title…',
      failed: "This title couldn't be opened. It may no longer be available.",
      back: 'Back',
      tryAgain: 'Try again',
      openingCollection: 'Opening collection…',
      collectionFailed: "This collection couldn't be opened.",
      showMore: 'Show more',
      findingTitles: 'Finding titles…',
      libraryFailed: "This library couldn't be opened. Check your connection and try again.",
      welcome: 'Sign in',
      signInTo: 'Sign in to your library.',
      username: 'Username',
      password: 'Password',
      signIn: 'Sign in',
      signingIn: 'Signing in…',
      or: 'or',
      withCode: 'Connect with a code',
      noMethods:
        "This server doesn't offer a way to sign in from Vela yet. Ask its owner to enable password or code sign-in.",
      unreachableTitle: "Can't reach your server",
      unreachableBody: 'Your server could not be reached. Reopen Vela when the connection is restored.',
      connecting: 'Connecting to your library…',
      redeeming: 'Signing you in…',
      secureTitle: 'A secure address is available',
      secureBody:
        'Your server also answers at {signin.secureOrigin}. Continue there so your password and viewing stay private.',
      secureAction: 'Switch to the secure address',
      easierWay: 'An easier way in.',
      approve: 'Approve this code from a signed-in Ether device.',
      waiting: 'Waiting for approval…',
      expires: 'This code expires at {quick.expires}.',
      cancel: 'Cancel',
      play: 'Play',
      resume: 'Resume watching',
      seasons: 'Seasons',
      episodes: 'Episodes',
      extras: 'Extras',
      notAvailable: '{extra.name} · Not available',
      featuring: 'Featuring',
      behind: 'Behind the story',
    },
  },
  motion: {
    enter0: {
      keyframes: 'rise',
      duration: 640,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    enter60: {
      keyframes: 'rise',
      duration: 640,
      delay: 60,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    enter120: {
      keyframes: 'rise',
      duration: 640,
      delay: 120,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    ...Object.fromEntries(
      [0, 180, 360].map(d => [
        `pulse${d}`,
        {
          keyframes: 'breathe',
          duration: 1400,
          delay: d,
          easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
          iterations: 'infinite' as const,
          fill: 'none' as const,
          still: { keyframes: 'none', duration: 0 },
        },
      ]),
    ),
    auroraA: {
      keyframes: 'auroraA',
      duration: 34000,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      direction: 'alternate',
      fill: 'none',
      still: { keyframes: 'none', duration: 0 },
    },
    auroraB: {
      keyframes: 'auroraB',
      duration: 41000,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      direction: 'alternate',
      fill: 'none',
      still: { keyframes: 'none', duration: 0 },
    },
    auroraC: {
      keyframes: 'auroraC',
      duration: 47000,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      direction: 'alternate',
      fill: 'none',
      still: { keyframes: 'none', duration: 0 },
    },
  },
  templates: { card, row },
  slots: { shell, home },
  routes: { title: episodePage(title, { card }), library, collection, auth },
  // Below 900 px the title page covers home; from 900 it stacks beside a 360 px home pane.
  detail: { from: 900, small: 'fullscreen', wide: 'stack', split: '360', frame: { flat: true } },
} satisfies SkinDocument;

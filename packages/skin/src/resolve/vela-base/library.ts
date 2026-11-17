import type { Condition, Node, Style } from '../../../../protocol/skin';
import { gridCard, titleGrid } from './cards';
import {
  bone,
  display,
  emptyState,
  eyebrow,
  failure,
  focusRing,
  gutter,
  gutterSmall,
  is,
  pill,
  pulse,
  ready,
  rowSkeleton,
  small,
  veil,
} from './look';

// A library page (compiled cinematic's Library): its art faint behind a sticky toolbar of
// filters and sort, then its titles in a grid, with "Show more" while the server has more.
export const libChip = (on: Condition[], arg: string, label: string): Node => {
  const base: Style = {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'row',
    'align-items': 'center',
    height: '34px',
    padding: '0px 14px',
    'border-radius': '$ui.radiusControl',
    'background-color': veil(0),
    color: '$ui.inkSecondary',
    'font-size': '13px',
    'font-weight': '600',
    'flex-shrink': '0',
    transition: 'background-color 180ms linear, color 180ms linear',
  };
  return {
    type: 'box',
    press: { action: 'libraryFilter', arg },
    label,
    a11y: { pressed: on },
    style: base,
    states: [{ when: on, style: { ...base, 'background-color': '$ui.ink', color: '$ui.inkInverse' } }],
    hover: { opacity: '0.92' },
    focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' },
    children: [{ type: 'text', text: label }],
  };
};
export const chipGroup = (label: string, children: Node[], when?: Condition[]): Node => ({
  type: 'box',
  ...(when ? { when } : {}),
  role: 'group',
  label,
  style: {
    display: 'flex',
    'flex-direction': 'row',
    gap: '4px',
    padding: '4px',
    'border-radius': '$ui.radiusControl',
    'background-color': '$ui.control',
    border: '1px solid $ui.glassEdge',
    'flex-shrink': '0',
  },
  children,
});
export const glassSelect: Style = {
  'box-sizing': 'border-box',
  height: '42px',
  padding: '0px 14px',
  border: '1px solid $ui.glassEdge',
  'border-radius': '$ui.radiusControl',
  'background-color': '$ui.control',
  color: '$ui.ink',
  'font-size': '14px',
};
export const favOn: Condition = { test: 'library.favoriteFilter' };
export const favBase: Style = {
  ...pill(false, 42),
  position: 'relative',
  'padding-left': '16px',
  'padding-right': '18px',
  'flex-shrink': '0',
  transition: 'background-color 180ms linear, color 180ms linear',
};
export const favourites: Node = {
  type: 'box',
  when: [{ test: 'library.canFavorite' }],
  press: { action: 'libraryFilter', arg: 'favorite|' },
  label: '{t:library.filter.favorites}',
  a11y: { pressed: [favOn] },
  style: favBase,
  states: [{ when: [favOn], style: { ...favBase, 'background-color': '$ui.ink', color: '$ui.inkInverse' } }],
  hover: { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
  focus: { 'box-shadow': focusRing },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: '8px', 'align-items': 'center' },
      children: [
        { type: 'icon', when: [favOn], symbol: 'heart-fill', style: { width: '15px', height: '15px' } },
        {
          type: 'icon',
          when: [{ ...favOn, not: true }],
          symbol: 'heart',
          style: { width: '15px', height: '15px' },
        },
        { type: 'text', text: '{t:library.filter.favorites}', style: { 'font-size': '14px' } },
      ],
    },
  ],
};
export const favouritesOff: Node = {
  ...favourites,
  when: [{ test: 'library.canFavorite' }, { ...favOn, not: true }],
  press: { action: 'libraryFilter', arg: 'favorite|true' },
} as Node;
export const favouritesOn: Node = { ...favourites, when: [{ test: 'library.canFavorite' }, favOn] } as Node;
export const ascending: Condition = { test: 'library.direction', is: 'eq', value: 'asc' };
// Sort: its label, the server's sort options and, when the sort has both directions, a flip.
// They sit in the toolbar row itself (a select stays near the top of its tree); the label's
// 4 px and the group's 6 px gap are the row's 10, and the flip draws in 4 px to its 6.
export const sorting: Condition = { test: 'library.sortCount', is: 'gt', value: '1' };
// The flip names the current direction; its glyph turns over for ascending (one button,
// so the turn animates).
export const flipBase: Style = {
  position: 'relative',
  width: '42px',
  height: '42px',
  padding: '12px',
  'margin-left': '-4px',
  'box-sizing': 'border-box',
  border: '1px solid $ui.glassEdge',
  'border-radius': '$ui.radiusControl',
  'background-color': '$ui.control',
  'backdrop-filter': 'blur(20px) saturate(1.3)',
  color: '$ui.ink',
  'flex-shrink': '0',
} as Style;
export const turn = 'rotate 360ms cubic-bezier(0.16, 1, 0.3, 1)';
export const flip: Node = {
  type: 'box',
  when: [sorting, { test: 'library.canFlip' }],
  press: { action: 'librarySortFlip' },
  label: '{t:library.direction.desc}',
  style: flipBase,
  states: [{ when: [ascending], style: flipBase, label: '{t:library.direction.asc}' }],
  hover: { 'background-color': '$ui.controlHover' },
  focus: { 'box-shadow': focusRing },
  children: [
    {
      type: 'icon',
      symbol: 'sort',
      style: { width: '18px', height: '18px', rotate: '0', transition: turn },
      states: [
        { when: [ascending], style: { width: '18px', height: '18px', rotate: '180', transition: turn } },
      ],
    },
  ],
};
export const sortControls: Node[] = [
  {
    type: 'text',
    when: [sorting],
    text: '{t:library.sortBy}',
    style: { ...eyebrow, 'font-size': '10px', color: '$ui.inkQuiet', 'flex-shrink': '0' } as Style,
  },
  {
    type: 'widget',
    widget: 'select',
    when: [sorting],
    params: { options: 'library.sorts', action: 'librarySort', label: '{t:library.sortBy}' },
    style: glassSelect,
  },
  flip,
];

const viewTab = (id: string, label: string): Node => {
  const on: Condition[] = [{ test: 'library.view', is: 'eq', value: id }];
  const style: Style = { position: 'relative', padding: '10px 14px', 'flex-shrink': '0', color: '$ui.inkSecondary', 'font-size': '14px', 'border-radius': '$ui.radiusControl' };
  const available = id === 'recommended' ? 'library.canRecommend' : id === 'collections' ? 'library.canCollections' : '';
  const unavailable: Condition[] = available ? [{ test: available, not: true }] : [];
  // Filtering support alone does not provide the choices needed to browse genres.
  return { type: 'box', id: `vela-library-view-${id}`, ...(id === 'genres' ? { when: [{ test: 'library.genresCount', is: 'gt' as const, value: '0' }] } : available ? { disabled: unavailable, disabledStyle: { opacity: '0.45' } } : {}), role: 'tab', press: { action: 'libraryView', arg: id }, label, a11y: { selected: on }, style,
    states: [{ when: on, style: { ...style, color: '$ui.ink', 'background-color': '$ui.control' } }],
    focus: { 'box-shadow': focusRing }, children: [{ type: 'text', text: label }] };
};

/** Shared tabs and content for skins which provide their own library header. */
export const libraryViews: Node = {
  type: 'box', id: 'vela-library-views', role: 'tablist', label: '{t:ui.library}',
  style: { display: 'flex', 'flex-direction': 'row', 'overflow-x': 'auto', 'padding-top': '6px', 'padding-bottom': '12px', gap: '4px', ...gutter }, small: { ...gutterSmall },
  children: [viewTab('recommended', '{t:library.view.recommended}'), viewTab('library', '{t:ui.library}'), viewTab('collections', '{t:library.view.collections}'), viewTab('genres', '{t:library.view.genres}'),
    { type: 'box', when: [{ test: 'env.libraryExtrasFailed' }], press: { action: 'retry' }, label: '{t:library.view.failed}',
      style: { padding: '8px', color: '$ui.inkSecondary', 'flex-shrink': '0' }, focus: { 'box-shadow': focusRing }, children: [{ type: 'text', text: '{t:library.view.failed}' }] }],
};

export const libraryFilters: Node = {
  type: 'box', when: [is('library.view', 'library')],
  style: { display: 'flex', 'flex-direction': 'row', 'overflow-x': 'auto', 'align-items': 'center', gap: '8px', ...gutter }, small: { ...gutterSmall },
  children: [
    chipGroup('{t:library.filter.all}', [
      libChip([is('library.playedFilter', '')], 'played|', '{t:library.filter.all}'),
      libChip([is('library.playedFilter', 'false')], 'played|false', '{t:library.filter.unwatched}'),
      libChip([is('library.playedFilter', 'true')], 'played|true', '{t:library.filter.watched}'),
    ], [{ test: 'library.canPlayed' }]),
    favouritesOff, favouritesOn,
    { type: 'widget', widget: 'select', when: [{ test: 'library.genreCount', is: 'gt', value: '0' }],
      params: { options: 'library.genres', action: 'libraryFilter', arg: 'genre|{value}', none: '{t:library.anyGenre}', label: '{t:library.genre}' }, style: glassSelect },
    ...sortControls,
  ],
};

export const libraryAlternative: Node = {
  type: 'box', id: 'vela-library-alternative', when: [ready, { test: 'library.view', is: 'ne', value: 'library' }],
  style: { display: 'flex', 'flex-direction': 'column', 'padding-top': '24px', 'padding-bottom': '60px', gap: '16px' },
  children: [
    { type: 'repeat', over: 'library.rows', when: [is('library.view', 'recommended')], item: { type: 'use', template: 'velaRow' } },
    { type: 'text', when: [is('library.view', 'recommended'), is('library.recommendationCount', '0'), { test: 'env.libraryExtrasLoading', not: true }], text: '{t:ui.yourLibraryHasNoRowsYet}', style: { ...gutter, color: '$ui.inkSecondary' } },
    { ...titleGrid, when: [is('library.view', 'collections')], children: [{ type: 'repeat', over: 'library.collections', item: gridCard }] } as Node,
    { type: 'text', when: [is('library.view', 'collections'), is('library.collectionCount', '0')], text: '{t:library.view.emptyCollections}', style: { ...gutter, color: '$ui.inkSecondary' } },
    { type: 'box', when: [is('library.view', 'collections'), { test: 'library.collectionsMore' }], press: { action: 'libraryMore' }, disabled: [{ test: 'env.libraryMoreLoading' }], label: '{t:library.loadMore}', style: { ...pill(false, 48), 'align-self': 'center' }, focus: { 'box-shadow': focusRing }, children: [{ type: 'text', text: '{t:library.loadMore}' }] },
    { type: 'box', when: [is('library.view', 'genres')], style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '10px', ...gutter }, small: { ...gutterSmall }, children: [{ type: 'repeat', over: 'library.genreViews', item: libChip([{ test: 'opt.on' }], 'genre|{opt.id}', '{opt.label}') }] },
    { type: 'text', when: [is('library.view', 'genres'), is('library.genresCount', '0')], text: '{t:library.view.emptyGenres}', style: { ...gutter, color: '$ui.inkSecondary' } },
  ],
};
export const toolbar: Node = {
  type: 'box',
  style: {
    position: 'sticky',
    top: '0px',
    'z-index': '5',
    display: 'flex',
    'flex-direction': 'column',
    'padding-top': '84px',
    'background-color': veil(82),
    'backdrop-filter': 'blur(20px) saturate(1.3)',
    'border-width': '0px',
    'border-style': 'solid',
    'border-bottom-width': '1px',
    'border-bottom-color': '$ui.glassEdge',
  } as Style,
  small: { 'padding-top': '104px' } as Style,
  children: [
    {
      type: 'text',
      text: '{library.name}',
      role: 'heading',
      level: 1,
      style: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        opacity: '0',
        'pointer-events': 'none',
      },
    },
    { type: 'use', template: 'velaLibraryViews' },
    {
      type: 'box',
      when: [is('library.view', 'library')],
      style: {
        display: 'flex',
        'flex-direction': 'row',
        'overflow-x': 'auto',
        'overflow-y': 'hidden',
        'scrollbar-width': 'none',
      },
      small: { 'mask-image': 'linear-gradient(90deg, black 0%, black 90%, transparent 100%)' },
      children: [
        {
          type: 'box',
          style: {
            display: 'flex',
            'flex-direction': 'row',
            gap: '10px',
            'align-items': 'center',
            'padding-top': '10px',
            'padding-bottom': '10px',
            ...gutter,
            'min-width': '100%',
            'box-sizing': 'border-box',
          } as Style,
          small: { ...gutterSmall },
          children: [
            chipGroup(
              '{t:library.filter.all}',
              [
                libChip(
                  [{ test: 'library.kindFilter', is: 'eq', value: '' }],
                  'kind|',
                  '{t:library.filter.all}',
                ),
                {
                  type: 'repeat',
                  over: 'library.kinds',
                  item: libChip([{ test: 'opt.on' }], 'kind|{opt.id}', '{opt.label}'),
                },
              ],
              [{ test: 'library.kindCount', is: 'gt', value: '1' }],
            ),
            chipGroup(
              '{t:library.filter.unwatched}',
              [
                libChip(
                  [{ test: 'library.playedFilter', is: 'eq', value: '' }],
                  'played|',
                  '{t:library.filter.all}',
                ),
                libChip(
                  [{ test: 'library.playedFilter', is: 'eq', value: 'false' }],
                  'played|false',
                  '{t:library.filter.unwatched}',
                ),
                libChip(
                  [{ test: 'library.playedFilter', is: 'eq', value: 'true' }],
                  'played|true',
                  '{t:library.filter.watched}',
                ),
              ],
              [{ test: 'library.canPlayed' }],
            ),
            favouritesOff,
            favouritesOn,
            {
              type: 'widget',
              widget: 'select',
              when: [{ test: 'library.genreCount', is: 'gt', value: '0' }],
              params: {
                options: 'library.genres',
                action: 'libraryFilter',
                arg: 'genre|{value}',
                none: '{t:library.anyGenre}',
                label: '{t:library.genre}',
              },
              style: glassSelect,
            },
            { type: 'box', style: { flex: '1' } },
            ...sortControls,
          ],
        },
      ],
    },
  ],
};
export const libraryLoading: Node = {
  type: 'box',
  when: [is('env.load', 'loading')],
  role: 'status',
  label: '{t:ui.findingTitles}',
  motion: 'velaStatusOpen',
  style: { display: 'flex', 'flex-direction': 'column', gap: '28px', 'padding-top': '128px' },
  small: { 'padding-top': '120px' },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '16px', ...gutter } as Style,
      small: { ...gutterSmall },
      children: [
        bone('90px', '10px', 4),
        bone('380px', '68px', 10, { width: '70%', height: '44px' }),
        {
          type: 'box',
          style: { display: 'flex', 'flex-direction': 'row', gap: '10px' },
          children: [bone('220px', '42px', 21), bone('160px', '42px', 21)],
        },
      ],
    },
    rowSkeleton,
    rowSkeleton,
  ],
};
export const noItems: Condition = { test: 'library.itemCount', is: 'eq', value: '0' };
// The route paints its own page: a document whose shell leaves the ground to its home (Kids)
// still reads its ink on its paper here.
const makeLibrary = (flowHeader: boolean): Node => ({
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'min-height': '100vh',
    'background-color': '$ui.page',
  },
  children: [
    flowHeader ? { ...libraryLoading, style: { ...libraryLoading.style, 'padding-top': '24px' }, small: { 'padding-top': '18px' } } : libraryLoading,
    failure('{t:library.couldNotOpen}'),
    {
      type: 'box',
      when: [ready, { test: 'library.backdrop' }],
      style: {
        position: 'absolute',
        top: '0px',
        left: '0px',
        right: '0px',
        height: '320px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'pointer-events': 'none',
        'mask-image': 'linear-gradient(180deg, black 0%, transparent 100%)',
        opacity: '0.22',
      },
      small: { height: '260px' },
      children: [
        {
          type: 'image',
          src: '{library.backdrop}',
          alt: '',
          fade: true,
          style: {
            position: 'absolute',
            inset: '0px',
            width: '100%',
            height: '100%',
            'object-fit': 'cover',
          },
        },
      ],
    },
    // The toolbar is a direct child of the route root, where native draws sticky.
    { ...toolbar, when: [ready], ...(flowHeader ? { style: { ...toolbar.style, 'padding-top': '0px' }, small: { ...toolbar.small, 'padding-top': '0px' } } : {}) },
    { type: 'use', template: 'velaLibraryAlternative' },
    {
      type: 'box',
      when: [ready, is('library.view', 'library')],
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'column',
        gap: '26px',
        'padding-top': '26px',
        'padding-bottom': '80px',
      },
      small: { gap: '18px', 'padding-top': '18px' },
      children: [
        {
          type: 'box',
          when: [{ test: 'env.libraryLoading' }, noItems],
          role: 'status',
          label: '{t:ui.findingTitles}',
          style: { display: 'flex', 'flex-direction': 'column' },
          children: [rowSkeleton, rowSkeleton],
        },
        {
          ...emptyState('filter', '{t:library.empty}', '{t:library.emptyHint}'),
          when: [{ test: 'env.libraryLoading', not: true }, noItems],
        } as Node,
        {
          ...titleGrid,
          when: [{ ...noItems, not: true }],
          children: [
            {
              type: 'repeat',
              over: 'library.items',
              item: { ...gridCard, motion: 'velaCard', stagger: { step: 30, cap: 18 } } as Node,
            },
          ],
        } as Node,
        {
          type: 'box',
          when: [{ ...noItems, not: true }, { test: 'library.more' }],
          style: {
            display: 'flex',
            'flex-direction': 'row',
            'justify-content': 'center',
            'padding-top': '12px',
          },
          children: [
            { ...pulse, when: [{ test: 'env.libraryMoreLoading' }] } as Node,
            {
              type: 'box',
              when: [{ test: 'env.libraryMoreLoading', not: true }],
              press: { action: 'libraryMore' },
              label: '{t:library.loadMore}',
              style: {
                ...pill(false, 48),
                position: 'relative',
                'padding-left': '28px',
                'padding-right': '28px',
              },
              hover: { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
              focus: { 'box-shadow': focusRing },
              children: [{ type: 'text', text: '{t:library.loadMore}', style: { 'font-size': '15px' } }],
            },
          ],
        },
      ],
    },
  ],
});

export const library = makeLibrary(false);
export const libraryBelowHeader = makeLibrary(true);

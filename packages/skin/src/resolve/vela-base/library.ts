import { castPerson } from './person-tile';
import type { BoxNode, Condition, Node, Style } from '../../../../protocol/skin';
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
export const libChip = (on: Condition[], arg: string, label: string): BoxNode => {
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
export const libraryViews: Node = { type: 'widget', widget: 'libraryToolbar', style: { ...gutter, 'padding-top': '8px', 'padding-bottom': '8px', 'min-width': '0px' }, small: { ...gutterSmall } };

// Kept as an empty compatibility template for older documents placing both templates.
export const libraryFilters: Node = { type: 'box' };

function peopleTile(node: Node): Node {
  if (node.type !== 'box') return node;
  return { ...node, ...(node.press ? { press: { action: 'select', arg: '{person.id}|person' } } : {}), children: node.children?.map(peopleTile) };
}

export const libraryAlternative: Node = {
  type: 'box', id: 'vela-library-alternative', when: [ready, { test: 'library.view', is: 'ne', value: 'library' }],
  style: { display: 'flex', 'flex-direction': 'column', 'padding-top': '24px', 'padding-bottom': '60px', gap: '16px' },
  children: [
    { type: 'widget', widget: 'contentLoader', when: [is('library.viewLoad', 'loading')] },
    { type: 'widget', widget: 'contentLoader', when: [is('library.viewLoad', 'idle')] },
    { ...failure('{t:library.couldNotOpen}'), when: [is('library.viewLoad', 'failed')] },
    { ...pulse, when: [{ test: 'env.libraryMoreLoading' }] },
    { type: 'repeat', over: 'library.rows', when: [is('library.view', 'recommended')], item: { type: 'use', template: 'velaRow' } },
    { type: 'text', when: [is('library.view', 'recommended'), is('library.recommendationCount', '0'), is('library.viewLoad', 'ready')], text: '{t:ui.yourLibraryHasNoRowsYet}', style: { ...gutter, color: '$ui.inkSecondary' } },
    { ...titleGrid, when: [is('library.view', 'collections')], children: [{ type: 'repeat', over: 'library.collections', item: gridCard }] } as Node,
    { type: 'text', when: [is('library.view', 'collections'), is('library.collectionCount', '0'), is('library.viewLoad', 'ready')], text: '{t:library.view.emptyCollections}', style: { ...gutter, color: '$ui.inkSecondary' } },
    { type: 'widget', widget: 'sentinel', params: { on: 'library' }, when: [is('library.view', 'collections'), { test: 'library.collectionsMore' }, { test: 'env.libraryMoreLoading', not: true }, { test: 'env.libraryExtrasFailed', not: true }] },
    { type: 'box', when: [is('library.view', 'collections'), { test: 'library.collectionsMore' }], press: { action: 'libraryMore' }, disabled: [{ test: 'env.libraryMoreLoading' }], label: '{t:library.loadMore}', style: { ...pill(false, 48), 'align-self': 'center' }, focus: { 'box-shadow': focusRing }, children: [{ type: 'text', text: '{t:library.loadMore}' }] },
    { ...titleGrid, style: { ...titleGrid.style, 'grid-template-columns': 'repeat(auto-fill, minmax(124px, 1fr))' }, small: { ...titleGrid.small, 'grid-template-columns': 'repeat(auto-fill, minmax(96px, 1fr))' }, when: [is('library.view', 'people')], children: [{ type: 'repeat', over: 'library.people', item: peopleTile(castPerson) }] } as Node,
    { type: 'text', when: [is('library.view', 'people'), is('library.collectionCount', '0'), is('library.viewLoad', 'ready')], text: '{t:library.view.emptyPeople}', style: { ...gutter, color: '$ui.inkSecondary' } },
    { type: 'widget', widget: 'sentinel', params: { on: 'library' }, when: [is('library.view', 'people'), { test: 'library.collectionsMore' }, { test: 'env.libraryMoreLoading', not: true }, { test: 'env.libraryExtrasFailed', not: true }] },
    { type: 'box', when: [is('library.view', 'people'), { test: 'library.collectionsMore' }], press: { action: 'libraryMore' }, disabled: [{ test: 'env.libraryMoreLoading' }], label: '{t:library.loadMore}', style: { ...pill(false, 48), 'align-self': 'center' }, focus: { 'box-shadow': focusRing }, children: [{ type: 'text', text: '{t:library.loadMore}' }] },
    { type: 'box', when: [is('library.view', 'genres')], style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '10px', ...gutter }, small: { ...gutterSmall }, children: [{ type: 'repeat', over: 'library.genreViews', item: libChip([{ test: 'opt.on' }], 'genre|{opt.id}', '{opt.label}') }] },
    { type: 'text', when: [is('library.view', 'genres'), is('library.genresCount', '0'), is('library.viewLoad', 'ready')], text: '{t:library.view.emptyGenres}', style: { ...gutter, color: '$ui.inkSecondary' } },
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
    'padding-top': 'calc(56px + env(safe-area-inset-top))',
    'background-color': veil(82),
    'backdrop-filter': 'blur(20px) saturate(1.3)',
    'border-width': '0px',
    'border-style': 'solid',
    'border-bottom-width': '1px',
    'border-bottom-color': '$ui.glassEdge',
  } as Style,
  small: { 'padding-top': 'calc(56px + env(safe-area-inset-top))' } as Style,
  children: [
    {
      type: 'text',
      text: '{library.name}',
      role: 'heading',
      level: 1,
      states: [{ when: [{ test: 'library.facetTitle' }], style: { position: 'relative', width: '100%', height: 'auto', opacity: '1', 'font-size': '24px', 'font-weight': '650', ...gutter, 'padding-top': '12px', 'padding-bottom': '12px' } }],
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
  ],
};

export const libraryLoading: Node = {
  type: 'box',
  when: [is('env.load', 'loading')],
  role: 'status',
  label: '{t:ui.findingTitles}',
  motion: 'velaStatusOpen',
  style: { display: 'flex', 'flex-direction': 'column', gap: '28px', 'padding-top': 'calc(128px + env(safe-area-inset-top))' },
  small: { 'padding-top': 'calc(120px + env(safe-area-inset-top))' },
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
          when: [is('library.viewLoad', 'ready'), noItems],
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

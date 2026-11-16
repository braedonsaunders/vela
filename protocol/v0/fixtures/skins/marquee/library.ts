// Library pages: the sticky toolbar of filters, then the titles as a grid or a list.
import type { Condition, Node, Style } from '../../../skin';
import {
  sans,
  gutter,
  gutterSmall,
  is,
  isnt,
  set,
  unset,
  glyph,
  ring,
  round,
  secondary,
  label,
  oneLine,
} from './look';
import { block, art, progress, tri, card, spinner } from './cards';
import { empty } from './home';

// Browsing a library: a sticky toolbar (name, poster size, grid or list; type, sort,
// direction, genre, watch status and favourites), then the titles in server order.
export const gridCard: Node = {
  ...card,
  style: { ...card.style, width: '100%' },
  small: { ...card.small, width: '100%' },
};
const posterMin = { normal: '128px', small: '104px' };
const libraryGrid = (rowGap: string, rowGapSmall: string): Style => ({
  display: 'grid',
  'grid-template-columns': `repeat(auto-fill, minmax(${posterMin.normal}, 1fr))`,
  'column-gap': '20px',
  'row-gap': rowGap,
  padding: '24px 40px',
});
const libraryGridSmall = (rowGap: string): Style => ({
  'grid-template-columns': `repeat(auto-fill, minmax(${posterMin.small}, 1fr))`,
  'column-gap': '12px',
  'row-gap': rowGap,
  padding: '16px 14px',
});
// A dropdown: the platform's select drawn as a flat label; the select draws its own chevron.
const pick = (params: Record<string, string>, when: Condition[]): Node => ({
  type: 'box',
  when,
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'row',
    'align-items': 'center',
    'flex-shrink': '0',
    'line-height': 'normal',
  },
  children: [
    {
      type: 'widget',
      widget: 'select',
      params,
      style: {
        'box-sizing': 'border-box',
        height: '34px',
        padding: '0px 12px',
        border: 'none',
        'border-radius': '4px',
        'background-color': 'transparent',
        color: '$ink',
        'font-size': '14px',
        'font-weight': '600',
        'line-height': 'normal',
        'font-family': sans,
        cursor: 'pointer',
      },
    },
  ],
});
// Grid or list: each button shows its view (the one on show is lit).
const viewButton = (list: boolean): Node => {
  const lit: Condition = { test: 'flag:list', not: !list };
  return {
    type: 'box',
    press: { action: list ? 'open' : 'close', arg: 'list' },
    label: list ? '{s:listView}' : '{s:gridView}',
    a11y: { pressed: [lit] },
    ...round(36),
    style: { ...round(36).style, color: '$ink-dim' },
    states: [{ when: [lit], style: { ...round(36).style, color: '$amber' } }],
    children: [glyph(list ? 'rows' : 'grid', 20)],
  } as Node;
};
const favouriteStyle = (on: boolean): Style => ({
  position: 'relative',
  outline: 'auto',
  display: 'flex',
  'flex-direction': 'row',
  gap: '6px',
  'align-items': 'center',
  'box-sizing': 'border-box',
  height: '34px',
  padding: '0px 12px',
  'border-radius': '4px',
  color: on ? '$amber' : '$ink',
});
const libraryToolbar: Node = {
  type: 'box',
  style: {
    position: 'sticky',
    top: '0px',
    'z-index': '5',
    display: 'flex',
    'flex-direction': 'column',
    'background-color': '$page',
    'border-style': 'solid',
    'border-width': '0px',
    'border-bottom-width': '1px',
    'border-bottom-color': '$line',
    'flex-shrink': '0',
  } as Style,
  children: [
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        'align-items': 'center',
        gap: '14px',
        'min-height': '56px',
        ...gutter,
      },
      small: { gap: '8px', 'min-height': '48px', ...gutterSmall },
      children: [
        {
          type: 'text',
          text: '{library.name}',
          role: 'heading',
          level: 1,
          style: {
            'font-size': '20px',
            'font-weight': '700',
            ...oneLine,
            'min-width': '0px',
            'flex-shrink': '0',
          },
          small: { 'font-size': '18px', 'flex-shrink': '1' },
        },
        spinner(18, {
          when: [set('env.libraryLoading'), { test: 'library.itemCount', is: 'gt', value: '0' }],
        }),
        { type: 'box', style: { flex: '1' } },
        {
          type: 'box',
          role: 'group',
          label: '{s:view}',
          style: { display: 'flex', 'flex-direction': 'row', gap: '2px' },
          children: [viewButton(false), viewButton(true)],
        },
      ],
    },
    {
      type: 'box',
      style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' },
      children: [
        {
          type: 'box',
          role: 'toolbar',
          label: '{s:libraryControls}',
          style: {
            display: 'flex',
            'flex-direction': 'row',
            gap: '4px',
            'align-items': 'center',
            'padding-left': '28px',
            'padding-right': '40px',
            'padding-bottom': '8px',
          },
          small: { 'padding-left': '4px', 'padding-right': '14px' },
          children: [
            pick(
              {
                options: 'library.kinds',
                action: 'libraryFilter',
                arg: 'kind|{value}',
                none: '{s:allTypes}',
                label: '{s:type}',
              },
              [{ test: 'library.kindCount', is: 'gt', value: '1' }],
            ),
            pick({ options: 'library.sorts', action: 'librarySort', label: '{s:sortBy}' }, [
              { test: 'library.sortCount', is: 'gt', value: '1' },
            ]),
            {
              type: 'box',
              when: [set('library.canFlip')],
              press: { action: 'librarySortFlip' },
              label: '{s:ascending}',
              ...round(34),
              states: [
                {
                  when: [isnt('library.direction', 'asc')],
                  style: round(34).style!,
                  label: '{s:descending}',
                },
              ],
              children: [
                glyph('up', 18, {
                  style: {
                    width: '18px',
                    height: '18px',
                    'flex-shrink': '0',
                    rotate: '0',
                    transition: 'rotate 160ms linear',
                  },
                  states: [
                    {
                      when: [isnt('library.direction', 'asc')],
                      style: {
                        width: '18px',
                        height: '18px',
                        'flex-shrink': '0',
                        rotate: '180',
                        transition: 'rotate 160ms linear',
                      },
                    },
                  ],
                } as Partial<Node>),
              ],
            } as Node,
            pick(
              {
                options: 'library.genres',
                action: 'libraryFilter',
                arg: 'genre|{value}',
                none: '{s:anyGenre}',
                label: '{s:genre}',
              },
              [{ test: 'library.genreCount', is: 'gt', value: '0' }],
            ),
            pick(
              {
                options: 'library.played',
                action: 'libraryFilter',
                arg: 'played|{value}',
                label: '{s:watchStatus}',
                choices: '|{s:anyStatus};false|{s:unwatched};true|{s:watched}',
              },
              [set('library.canPlayed')],
            ),
            {
              type: 'box',
              when: [set('library.canFavorite'), unset('library.favoriteFilter')],
              press: { action: 'libraryFilter', arg: 'favorite|true' },
              label: '{s:favourites}',
              a11y: { pressed: [set('library.favoriteFilter')] },
              style: favouriteStyle(false),
              hover: { 'background-color': '$hover' },
              focus: { 'box-shadow': ring('$amber') },
              children: [
                glyph('heart', 16),
                {
                  type: 'text',
                  text: '{s:favourites}',
                  style: { 'font-size': '14px', 'font-weight': '600' },
                },
              ],
            } as Node,
            {
              type: 'box',
              when: [set('library.canFavorite'), set('library.favoriteFilter')],
              press: { action: 'libraryFilter', arg: 'favorite|' },
              label: '{s:favourites}',
              a11y: { pressed: [set('library.favoriteFilter')] },
              style: favouriteStyle(true),
              hover: { 'background-color': '$hover' },
              focus: { 'box-shadow': ring('$amber') },
              children: [
                {
                  type: 'icon',
                  symbol: 'heart-fill',
                  style: { width: '16px', height: '16px', 'flex-shrink': '0' },
                },
                {
                  type: 'text',
                  text: '{s:favourites}',
                  style: { 'font-size': '14px', 'font-weight': '600' },
                },
              ],
            } as Node,
          ],
        },
      ],
    },
  ],
};
// The list view: one title per row with columns.
const listCell = (text: string, w: string, extra: Style = {}): Node => ({
  type: 'text',
  text,
  style: { width: w, 'flex-shrink': '0', 'font-size': '14px', color: '$ink-dim', ...extra },
  small: { display: 'none' },
});
const listRow: Node = {
  type: 'box',
  role: 'listitem',
  press: { action: 'select', arg: '{card.kindId}' },
  label: '{card.label}',
  testId: 'title-{card.id}',
  style: {
    position: 'relative',
    outline: 'auto',
    display: 'flex',
    'flex-direction': 'row',
    gap: '16px',
    'align-items': 'center',
    'box-sizing': 'border-box',
    width: '100%',
    padding: '8px 12px',
    'border-style': 'solid',
    'border-width': '0px',
    'border-bottom-width': '1px',
    'border-bottom-color': '$line',
    color: '$ink',
  } as Style,
  hover: { 'background-color': '$hover' },
  focus: { 'box-shadow': 'inset 0px 0px 0px 2px $amber' },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    {
      type: 'box',
      style: {
        position: 'relative',
        width: '40px',
        height: '60px',
        'flex-shrink': '0',
        'border-radius': '3px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$raised',
      },
      children: [
        { ...art('{card.poster}'), when: [set('card.poster')] },
        { type: 'box', when: [set('card.unwatched')], style: tri(12) },
        progress(3, '{card.progressPct}', [set('card.hasProgress')]),
      ],
    },
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-width': '0px', gap: '2px' },
      children: [
        {
          type: 'text',
          text: '{card.name}',
          style: { 'font-size': '15px', 'font-weight': '600', ...oneLine },
        },
        {
          type: 'text',
          when: [set('env.small')],
          text: '{card.facts}',
          style: { 'font-size': '13px', color: '$ink-faint', ...oneLine },
        },
      ],
    },
    listCell('{card.yearLabel}', '64px', { 'font-variant-numeric': 'tabular-nums' }),
    listCell('{card.rating}', '72px'),
    listCell('{card.genresComma}', '200px', oneLine),
  ],
};
const titleList: Node = {
  type: 'box',
  role: 'list',
  style: { display: 'flex', 'flex-direction': 'column', padding: '12px 28px' },
  small: { padding: '8px 0px' },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: '16px', padding: '8px 12px', ...label },
      small: { display: 'none' },
      children: [
        { type: 'box', style: { width: '40px', 'flex-shrink': '0' } },
        { type: 'text', text: '{s:titleColumn}', style: { flex: '1' } },
        { type: 'text', text: '{s:year}', style: { width: '64px', 'flex-shrink': '0' } },
        { type: 'text', text: '{s:ratingColumn}', style: { width: '72px', 'flex-shrink': '0' } },
        { type: 'text', text: '{s:genresColumn}', style: { width: '200px', 'flex-shrink': '0' } },
      ],
    },
    { type: 'repeat', over: 'library.items', item: listRow },
  ],
};
const libraryItems: Node = {
  type: 'box',
  when: [{ test: 'library.itemCount', is: 'gt', value: '0' }],
  style: { display: 'flex', 'flex-direction': 'column', opacity: '1', transition: 'opacity 160ms linear' },
  states: [
    {
      when: [set('env.libraryLoading')],
      style: {
        display: 'flex',
        'flex-direction': 'column',
        opacity: '0.6',
        transition: 'opacity 160ms linear',
      },
    },
  ],
  children: [
    { ...titleList, when: [set('flag:list')] },
    {
      type: 'box',
      when: [unset('flag:list')],
      style: libraryGrid('28px', '18px'),
      small: libraryGridSmall('18px'),
      children: [{ type: 'repeat', over: 'library.items', item: { type: 'use', template: 'gridCard' } }],
    },
    {
      type: 'box',
      when: [set('library.more')],
      style: { display: 'flex', 'flex-direction': 'row', 'justify-content': 'center', 'padding-top': '16px' },
      children: [
        spinner(28, { when: [set('env.libraryMoreLoading')] }),
        {
          type: 'box',
          when: [unset('env.libraryMoreLoading')],
          press: { action: 'libraryMore' },
          label: '{s:loadMore}',
          ...secondary(40, '0px 22px'),
          children: [{ type: 'text', text: '{s:loadMore}', style: { 'font-size': '14px' } }],
        },
      ],
    },
  ],
};
export const libraryRoute: Node = {
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'padding-bottom': '60px',
    'background-color': '$page',
    color: '$ink',
    'font-family': sans,
  },
  children: [
    libraryToolbar,
    // Waiting for the first titles: the grid in outline.
    {
      type: 'box',
      when: [set('env.libraryLoading'), is('library.itemCount', '0')],
      role: 'status',
      label: '{s:findingTitles}',
      style: { ...libraryGrid('20px', '12px'), gap: '20px' },
      small: { ...libraryGridSmall('12px'), gap: '12px' },
      children: Array.from({ length: 12 }, (): Node => ({
        type: 'box',
        style: { 'aspect-ratio': '2 / 3', display: 'flex' },
        children: [block('100%', '100%', 4)],
      })),
    },
    {
      type: 'box',
      when: [unset('env.libraryLoading'), is('library.itemCount', '0')],
      style: { display: 'flex', 'flex-direction': 'column', gap: '14px', 'align-items': 'center' },
      children: [empty('filter', '{s:libraryEmpty}', '{s:libraryEmptyHint}')],
    },
    libraryItems,
  ],
};

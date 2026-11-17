// Library pages: the sticker heading, filter chips and pickers, and the poster grid.
import type { Action, Condition, Node, Style } from '../../../skin';
import { card } from './cards';
import {
  boing,
  Bubble,
  bubble,
  candy,
  Candy,
  col,
  emptyState,
  fadeIn,
  fredoka,
  gutter,
  gutterSmall,
  icon,
  is,
  Label,
  loader,
  not,
  ready,
  row,
  set,
  stillC,
  sz,
  Title,
} from './look';
import { failed } from './status';

// A card in a wrapping grid fills its column (TitleCard fill).
export const gridCard: Node = {
  ...card,
  stagger: { step: 28, cap: 18 },
  style: { ...card.style, width: '100%' },
  small: {},
} as Node;

// A page heading as a sticker label: the artwork stuck on at a tilt, a pixel eyebrow, the name
// (library.contract PageHeading).
export const pageHeading = (eyebrow: string, name: string, backdrop?: string, back = false): Node => ({
  type: 'box',
  motion: 'hop40',
  style: {
    ...row,
    position: 'relative',
    gap: '16px',
    'align-items': 'center',
    ...gutter,
    'padding-top': '18px',
  },
  small: { gap: '12px', ...gutterSmall, 'padding-top': '10px' },
  children: [
    ...(back
      ? [
          {
            type: 'box',
            press: { action: 'back' },
            label: '{s:back}',
            style: { ...Bubble, ...sz(46) },
            ...bubble,
            children: [icon('back', 15)],
          } as Node,
        ]
      : []),
    ...(backdrop
      ? [
          {
            type: 'box',
            when: [set(backdrop.slice(1, -1)), not('env.small')],
            style: {
              ...col,
              position: 'relative',
              ...sz(96, 60),
              'border-radius': '16px',
              'overflow-x': 'hidden',
              'overflow-y': 'hidden',
              border: '3px solid $ink',
              'box-shadow': '4px 4px 0px $lavender',
              rotate: '-3',
            },
            children: [{ type: 'image', src: backdrop, alt: '', fade: true, style: fadeIn }],
          } as Node,
        ]
      : []),
    {
      type: 'box',
      style: { ...col, gap: '4px', 'min-width': '0px' },
      children: [
        {
          type: 'box',
          style: { ...row, gap: '6px', 'align-items': 'center', color: '$pink-deep' },
          children: [
            icon('sparkle', 11),
            { type: 'text', text: eyebrow, style: { ...Label, 'font-size': '11px' } },
          ],
        },
        {
          type: 'text',
          text: name,
          role: 'heading',
          level: 1,
          style: { ...Title, 'font-size': '42px', 'line-clamp': '1' },
          small: { 'font-size': '30px' },
        },
      ],
    },
  ],
});

// One choice in a segmented candy group (library.contract Chip).
export const chipBase: Style = {
  ...row,
  position: 'relative',
  'align-items': 'center',
  height: '38px',
  'box-sizing': 'border-box',
  padding: '0px 14px',
  border: '2px solid $page-clear',
  'border-radius': '999px',
  'background-color': '$page-clear',
  color: '$ink',
  'font-family': fredoka,
  'font-size': '14px',
  'font-weight': '550',
  cursor: 'pointer',
  'white-space': 'nowrap',
  transition: 'background-color 160ms linear',
};
export const chipOn: Style = {
  ...chipBase,
  'border-color': '$ink',
  'background-color': '$pink',
  'font-weight': '650',
};
export const chip = (label: string, on: Condition[], arg: string, when: Condition[] = []): Node => ({
  type: 'box',
  when,
  press: { action: 'libraryFilter' as Action, arg },
  label,
  a11y: { pressed: on },
  style: chipBase,
  states: [{ when: on, style: chipOn }],
  hover: { 'border-color': '$ink' },
  focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 2px $card, 0px 0px 0px 5px $focus' },
  children: [{ type: 'text', text: label }],
});
export const chipGroup = (label: string, when: Condition[], children: Node[]): Node => ({
  type: 'box',
  role: 'group',
  label,
  when,
  style: {
    ...row,
    gap: '4px',
    padding: '4px',
    'flex-shrink': '0',
    'border-radius': '999px',
    'background-color': '$card',
    border: '2.5px solid $ink',
  },
  children,
});
// A native picker in Mochi's pill (look.contract Picker).
export const Picker: Style = {
  height: '44px',
  'flex-shrink': '0',
  'box-sizing': 'border-box',
  padding: '0px 14px',
  border: '2.5px solid $ink',
  'border-radius': '999px',
  'background-color': '$card',
  color: '$ink',
  'font-family': fredoka,
  'font-size': '14px',
  'font-weight': '600',
};
export const favourite: Style = {
  ...Bubble,
  ...row,
  height: '44px',
  'padding-left': '14px',
  'padding-right': '18px',
  gap: '8px',
  'background-color': '$card',
};

export const toolbar: Node = {
  type: 'box',
  motion: 'hop90',
  style: {
    ...row,
    position: 'relative',
    gap: '10px',
    'align-items': 'center',
    'flex-wrap': 'wrap',
    'padding-top': '4px',
    'padding-bottom': '8px',
    ...gutter,
    'min-width': '100%',
    'box-sizing': 'border-box',
  },
  small: {
    'flex-wrap': 'nowrap',
    ...gutterSmall,
    'overflow-x': 'auto',
    'overflow-y': 'hidden',
    'scrollbar-width': 'none',
  },
  children: [
    chipGroup(
      '{s:all}',
      [{ test: 'library.kindCount', is: 'gt', value: '1' }],
      [
        chip('{s:all}', [is('library.kindFilter', '')], 'kind|'),
        {
          type: 'repeat',
          over: 'library.kinds',
          item: chip('{opt.label}', [set('opt.on')], 'kind|{opt.id}'),
        },
      ],
    ),
    chipGroup(
      '{s:unwatched}',
      [set('library.canPlayed')],
      [
        chip('{s:all}', [is('library.playedFilter', '')], 'played|'),
        chip('{s:unwatched}', [is('library.playedFilter', 'false')], 'played|false'),
        chip('{s:watchedFilter}', [is('library.playedFilter', 'true')], 'played|true'),
      ],
    ),
    ...[true, false].map(
      on =>
        ({
          type: 'box',
          when: [
            set('library.canFavorite'),
            on ? set('library.favoriteFilter') : not('library.favoriteFilter'),
          ],
          press: { action: 'libraryFilter' as Action, arg: on ? 'favorite|' : 'favorite|true' },
          label: '{s:favourites}',
          a11y: { pressed: [set('library.favoriteFilter')] },
          style: on ? { ...favourite, 'background-color': '$pink' } : favourite,
          ...bubble,
          children: [
            icon('heart', 14, on ? 'ink' : 'pink-deep'),
            { type: 'text', text: '{s:favourites}', style: { 'font-size': '15px', 'font-weight': '600' } },
          ],
        }) as Node,
    ),
    {
      type: 'widget',
      widget: 'select',
      when: [{ test: 'library.genreCount', is: 'gt', value: '0' }],
      params: {
        options: 'library.genres',
        action: 'libraryFilter',
        arg: 'genre|{value}',
        none: '{s:anyGenre}',
        label: '{s:genre}',
      },
      style: Picker,
    },
    { type: 'box', style: { flex: '1' } },
    {
      type: 'box',
      when: [{ test: 'library.sortCount', is: 'gt', value: '1' }],
      style: { ...row, gap: '8px', 'align-items': 'center', 'flex-shrink': '0' },
      children: [
        { type: 'text', text: '{s:sortBy}', style: { ...Label, 'font-size': '11px', color: '$ink-soft' } },
        {
          type: 'widget',
          widget: 'select',
          params: { options: 'library.sorts', action: 'librarySort', label: '{s:sortBy}' },
          style: Picker,
        },
        // The flip turns its arrow over with a bounce; its name says the current direction.
        {
          type: 'box',
          when: [set('library.canFlip')],
          press: { action: 'librarySortFlip' as Action },
          label: '{s:descending}',
          style: { ...Bubble, ...sz(44) },
          ...bubble,
          states: [
            {
              when: [is('library.direction', 'asc')],
              style: { ...Bubble, ...sz(44) },
              label: '{s:ascending}',
            },
          ],
          children: [
            {
              type: 'box',
              style: { ...col, rotate: '0', transition: `rotate 320ms ${boing}` },
              states: [
                {
                  when: [stillC, is('library.direction', 'asc')],
                  style: { ...col, rotate: '180', transition: 'none' },
                },
                { when: [stillC], style: { ...col, rotate: '0', transition: 'none' } },
                {
                  when: [is('library.direction', 'asc')],
                  style: { ...col, rotate: '180', transition: `rotate 320ms ${boing}` },
                },
              ],
              children: [icon('sort', 15)],
            },
          ],
        },
      ],
    },
  ],
};

export const libraryGrid: Node = {
  type: 'box',
  style: { ...col, transition: 'opacity 200ms linear' },
  states: [
    {
      when: [set('env.libraryLoading')],
      style: { ...col, transition: 'opacity 200ms linear', opacity: '0.6' },
    },
  ],
  children: [
    {
      type: 'box',
      style: {
        display: 'grid',
        'grid-template-columns': 'repeat(auto-fill, minmax(176px, 1fr))',
        'column-gap': '24px',
        'row-gap': '34px',
        ...gutter,
        'padding-top': '8px',
      },
      small: {
        'grid-template-columns': 'repeat(auto-fill, minmax(136px, 1fr))',
        'column-gap': '14px',
        'row-gap': '24px',
        ...gutterSmall,
      },
      children: [{ type: 'repeat', over: 'library.items', item: { type: 'use', template: 'gridCard' } }],
    },
  ],
};

// A library: its name, the server's sort and filter choices, then its titles in a grid.
export const library: Node = {
  type: 'box',
  style: { ...col, position: 'relative', color: '$ink', 'font-family': fredoka },
  children: [
    // Before the page's first answer (library.contract Status kind "library", or a failure).
    {
      type: 'box',
      when: [is('env.load', 'loading')],
      role: 'status',
      label: '{s:findingTitles}',
      motion: 'statusIn',
      style: { ...col, 'padding-top': '72px', 'align-items': 'center' },
      small: { 'padding-top': '48px' },
      children: [
        { ...loader('{s:findingTitles}', 80), small: { display: 'none' } } as Node,
        {
          ...loader('{s:findingTitles}', 64),
          style: { display: 'none' },
          small: { ...col, 'align-items': 'center', gap: '14px' },
        } as Node,
      ],
    },
    failed('{s:libraryFailed}'),
    {
      type: 'box',
      when: [ready],
      style: { ...col, position: 'relative', gap: '20px', 'padding-bottom': '80px' },
      small: { gap: '14px' },
      children: [
        pageHeading('{s:library}', '{library.name}', '{library.backdrop}'),
        { type: 'use', template: 'velaLibraryViews' },
        { type: 'use', template: 'velaLibraryAlternative' },
        { ...toolbar, when: [is('library.view', 'library')] } as Node,
        {
          type: 'box',
          when: [is('library.view', 'library'), set('env.libraryLoading'), is('library.itemCount', '0')],
          style: { ...col, 'align-items': 'center', padding: '48px 0px' },
          children: [loader('{s:findingTitles}', 64)],
        },
        {
          ...emptyState('sleepy', '{s:libraryEmpty}', '{s:libraryEmptyHint}'),
          when: [is('library.view', 'library'), not('env.libraryLoading'), is('library.itemCount', '0')],
        } as Node,
        { ...libraryGrid, when: [is('library.view', 'library'), { test: 'library.itemCount', is: 'gt', value: '0' }] } as Node,
        {
          type: 'box',
          when: [is('library.view', 'library'), { test: 'library.itemCount', is: 'gt', value: '0' }, set('library.more')],
          style: { ...row, 'justify-content': 'center', 'padding-top': '18px' },
          children: [
            { ...loader('{s:loadingMore}', 44), when: [set('env.libraryMoreLoading')] } as Node,
            {
              type: 'box',
              when: [not('env.libraryMoreLoading')],
              press: { action: 'libraryMore' as Action },
              label: '{s:loadMore}',
              style: {
                ...Candy,
                height: '58px',
                'padding-left': '30px',
                'padding-right': '30px',
                gap: '10px',
              },
              ...candy,
              children: [
                icon('sparkle', 14),
                { type: 'text', text: '{s:loadMore}', style: { 'font-size': '16px' } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

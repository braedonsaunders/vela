// Library pages: the sticker heading, filter chips and pickers, and the poster grid.
import type { Action, Node } from '../../../skin';
import { card } from './cards';
import { Bubble, bubble, candy, Candy, col, emptyState, fadeIn, fredoka, gutter, gutterSmall, icon, is, Label, loader, not, ready, row, set, sz, Title } from './look';
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

// Collection pages (box sets, folders, playlists): a way back, the heading, and the poster grid.
import type { Node } from '../../../skin';
import { pageHeading } from './library';
import { col, emptyState, fredoka, gutter, gutterSmall, inset0, is, loader, ready } from './look';
import { failed } from './status';

// A collection's titles in server order, with a way back (library.contract Collection).
export const collection: Node = {
  type: 'box',
  id: '{env.route}-scroll-{env.entry}',
  style: {
    ...col,
    ...inset0,
    'overflow-y': 'auto',
    'overflow-x': 'hidden',
    'background-color': '$page',
    color: '$ink',
    'font-family': fredoka,
  },
  children: [
    {
      type: 'box',
      when: [is('env.load', 'loading')],
      role: 'status',
      label: '{s:openingCollection}',
      motion: 'statusIn',
      style: { ...col, 'padding-top': '72px', 'align-items': 'center' },
      small: { 'padding-top': '48px' },
      children: [
        { ...loader('{s:openingCollection}', 80), small: { display: 'none' } } as Node,
        {
          ...loader('{s:openingCollection}', 64),
          style: { display: 'none' },
          small: { ...col, 'align-items': 'center', gap: '14px' },
        } as Node,
      ],
    },
    failed('{s:collectionFailed}'),
    {
      type: 'box',
      when: [ready],
      style: { ...col, gap: '26px', 'padding-bottom': '80px', 'padding-top': '10px' },
      small: { gap: '18px', 'padding-top': '6px' },
      children: [
        pageHeading('{collection.kindLabel}', '{collection.name}', undefined, true),
        {
          ...emptyState('sleepy', '{s:nothingHereYet}', ''),
          when: [is('collection.itemCount', '0')],
        } as Node,
        {
          type: 'box',
          when: [{ test: 'collection.itemCount', is: 'gt', value: '0' }],
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
          children: [
            { type: 'repeat', over: 'collection.items', item: { type: 'use', template: 'gridCard' } },
          ],
        },
      ],
    },
  ],
};

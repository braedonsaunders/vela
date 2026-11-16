import type { Node } from '../../../skin';
import { gutter, gutterSmall } from './look';

export const pageEnd: Node[] = [
  {
    type: 'box',
    when: [{ test: 'row.hasMore' }, { test: 'row.presentation', is: 'ne', value: 'ranked' }],
    style: { position: 'relative', 'align-self': 'stretch', width: '2px', 'flex-shrink': '0' },
    children: [{ type: 'widget', widget: 'sentinel', params: { on: 'row' } }],
  },
  {
    type: 'box',
    when: [{ test: 'row.loadingMore' }],
    role: 'status',
    label: '{s:loadingMore}',
    motion: 'pulse',
    style: {
      width: 'clamp(150px, 11.2vw, 252px)',
      'aspect-ratio': '2 / 3',
      'flex-shrink': '0',
      'border-radius': 'clamp(12px, 0.9vw, 18px)',
      'background-color': 'rgba(255, 255, 255, 0.06)',
      'box-shadow': 'inset 0px 0px 0px 1px rgba(255, 255, 255, 0.08)',
    },
    small: { width: '128px' },
  },
];

// A row of the home feed pages in more items as its end comes into view; related rows on a
// title page show what they have.
export const rowOf = (paged: boolean): Node => ({
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'padding-bottom': 'clamp(8px, 1vw, 20px)',
  },
  children: [
    {
      type: 'text',
      text: '{row.name}',
      role: 'heading',
      level: 2,
      style: {
        'font-size': 'clamp(21px, 1.6vw, 32px)',
        'font-weight': '700',
        'letter-spacing': '-0.01em',
        'text-shadow': '0px 1px 12px rgba(0, 0, 0, 0.5)',
        ...gutter,
      },
      small: { 'font-size': '19px', ...gutterSmall },
    },
    // Room above and below the track lets a focused poster grow without being clipped.
    {
      type: 'box',
      style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' },
      children: [
        {
          type: 'box',
          style: {
            display: 'flex',
            'flex-direction': 'row',
            'align-items': 'flex-start',
            gap: 'clamp(20px, 1.9vw, 40px)',
            'padding-top': 'clamp(26px, 2.2vw, 44px)',
            'padding-bottom': 'clamp(30px, 2.6vw, 52px)',
            ...gutter,
          },
          small: { gap: '14px', 'padding-top': '18px', 'padding-bottom': '22px', ...gutterSmall },
          children: [
            {
              type: 'repeat',
              over: 'row.items',
              when: [
                { test: 'row.presentation', is: 'ne', value: 'ranked' },
                { test: 'row.landscape', not: true },
              ],
              item: { type: 'use', template: 'poster', motion: 'cardIn', stagger: { step: 40, cap: 8 } },
            },
            {
              type: 'repeat',
              over: 'row.items',
              when: [{ test: 'row.presentation', is: 'ne', value: 'ranked' }, { test: 'row.landscape' }],
              item: { type: 'use', template: 'wide', motion: 'cardIn', stagger: { step: 40, cap: 8 } },
            },
            {
              type: 'repeat',
              over: 'row.items',
              limit: 10,
              when: [{ test: 'row.presentation', is: 'eq', value: 'ranked' }],
              item: { type: 'use', template: 'ranked', motion: 'cardIn', stagger: { step: 40, cap: 8 } },
            },
            ...(paged ? pageEnd : []),
          ],
        },
      ],
    },
  ],
});

export const row = rowOf(true),
  relatedRow = rowOf(false);

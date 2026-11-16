// A collection page: a bar with a way back, then its titles in server order.
import type { Node } from '../../../skin';
import {
  sans,
  side,
  sideSmall,
  row,
  col,
  fill,
  glyph,
  jelly,
  iconBtn,
  iconBtnHover,
  iconBtnFocus,
  emptyState,
  ready,
  waiting,
  failure,
} from './look';

// A collection: a header with a way back, then its titles in server order.
export const collection: Node = {
  type: 'box',
  style: col({
    'min-height': '100%',
    'background-color': '$page',
    color: '$ink',
    'font-family': sans,
    'padding-bottom': '48px',
  }),
  children: [
    waiting(140, '{s:openingCollection}'),
    failure('{s:collectionFailed}'),
    ...(
      [
        {
          type: 'box',
          style: row({
            position: 'sticky',
            top: '0px',
            'z-index': '5',
            height: '58px',
            'align-items': 'center',
            gap: '8px',
            'padding-left': '10px',
            'padding-right': '14px',
            'background-color': '$header',
            'backdrop-filter': 'blur(12px)',
            'box-shadow': '0px 2px 6px $shadow',
            'flex-shrink': '0',
          }),
          small: { height: '52px', 'padding-left': '4px' },
          children: [
            {
              type: 'box',
              press: { action: 'back' },
              label: '{s:back}',
              style: iconBtn(44),
              hover: iconBtnHover,
              focus: iconBtnFocus,
              children: [glyph('back', 24)],
            },
            {
              type: 'text',
              text: '{collection.name}',
              role: 'heading',
              level: 1,
              style: { 'font-size': '20px', 'font-weight': '600', color: '$ink-strong', 'line-clamp': '1' },
              small: { 'font-size': '18px' },
            },
          ],
        },
        {
          type: 'box',
          style: col({ 'padding-top': '24px' }),
          small: { 'padding-top': '16px' },
          children: [
            emptyState(jelly('folder', 44), '{s:nothingHere}', '', [
              { test: 'collection.itemCount', is: 'eq', value: '0' },
            ]),
            {
              type: 'box',
              when: [{ test: 'collection.itemCount', is: 'gt', value: '0' }],
              style: {
                display: 'grid',
                'grid-template-columns': 'repeat(auto-fill, minmax(160px, 1fr))',
                'column-gap': '18px',
                'row-gap': '26px',
                ...side,
              },
              small: {
                'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
                'column-gap': '10px',
                'row-gap': '16px',
                ...sideSmall,
              },
              children: [
                { type: 'repeat', over: 'collection.items', item: { type: 'use', template: 'gridPoster' } },
              ],
            },
            // A longer collection loads its next page as its end comes into view.
            {
              type: 'box',
              when: [{ test: 'collection.more' }],
              style: { position: 'relative', height: '1px' },
              children: [{ type: 'widget', widget: 'sentinel', params: { on: 'collection' }, style: fill }],
            },
          ],
        },
      ] as Node[]
    ).map(n => ({ ...n, when: [ready, ...(n.when ?? [])] }) as Node),
  ],
};

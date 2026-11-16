// Collection pages: a back bar with the collection's name over its titles.
import type { Node } from '../../../skin';
import { sans, bar, fill, px, is, set, glyph, round, oneLine } from './look';
import { glassBar } from './shell';
import { spinner } from './cards';
import { empty, ready, loading, failure } from './home';

// A collection: a way back, its name and its titles in server order.
export const collectionRoute: Node = {
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    height: '100%',
    'min-height': '0px',
    'background-color': '$page',
    color: '$ink',
    'font-family': sans,
  },
  children: [
    {
      type: 'box',
      id: '{env.route}-scroll-{env.entry}',
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'column',
        flex: '1',
        'min-height': '0px',
        'overflow-x': 'hidden',
        'overflow-y': 'auto',
      },
      children: [
        // Opening: the amber ring and what is happening, below the bar's height.
        {
          type: 'box',
          when: [loading],
          motion: 'statusIn',
          style: { display: 'flex', 'flex-direction': 'column', 'padding-top': px(bar.normal) },
          small: { 'padding-top': px(bar.small) },
          children: [
            {
              type: 'box',
              role: 'status',
              style: {
                display: 'flex',
                'flex-direction': 'column',
                'align-items': 'center',
                gap: '16px',
                padding: '96px 24px',
              },
              children: [
                spinner(40),
                {
                  type: 'text',
                  text: '{s:openingCollection}',
                  style: { color: '$ink-dim', 'font-size': '15px' },
                },
              ],
            },
          ],
        },
        failure('{s:collectionFailed}'),
        // The back bar pins to the top of the page's scroll.
        {
          type: 'box',
          when: [ready],
          style: {
            position: 'sticky',
            top: '0px',
            'z-index': '5',
            display: 'flex',
            'flex-direction': 'row',
            'align-items': 'center',
            gap: '10px',
            height: '60px',
            'flex-shrink': '0',
            'padding-left': '24px',
            'padding-right': '40px',
            ...glassBar,
          },
          small: { height: '52px', 'padding-left': '4px', 'padding-right': '14px' },
          children: [
            {
              type: 'box',
              press: { action: 'back' },
              label: '{s:back}',
              ...round(44),
              children: [glyph('back', 22)],
            },
            {
              type: 'box',
              style: { display: 'flex', 'flex-direction': 'column', 'min-width': '0px', gap: '1px' },
              children: [
                {
                  type: 'text',
                  text: '{s:collection}',
                  style: {
                    'font-size': '11px',
                    'font-weight': '700',
                    'letter-spacing': '0.06em',
                    'text-transform': 'uppercase',
                    color: '$amber',
                  },
                },
                {
                  type: 'text',
                  text: '{collection.name}',
                  role: 'heading',
                  level: 1,
                  style: { 'font-size': '20px', 'font-weight': '700', ...oneLine },
                  small: { 'font-size': '17px' },
                },
              ],
            },
          ],
        },
        {
          type: 'box',
          when: [ready],
          style: {
            display: 'flex',
            'flex-direction': 'column',
            'min-height': 'calc(100% - 60px)',
            'padding-bottom': '60px',
            'flex-shrink': '0',
          },
          small: { 'min-height': 'calc(100% - 52px)' },
          children: [
            empty('stack', '{s:emptyCollection}', '', { when: [is('collection.itemCount', '0')] }),
            {
              type: 'box',
              when: [{ test: 'collection.itemCount', is: 'gt', value: '0' }],
              style: {
                display: 'grid',
                'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))',
                'column-gap': '20px',
                'row-gap': '28px',
                padding: '24px 40px',
              },
              small: {
                'grid-template-columns': 'repeat(auto-fill, minmax(104px, 1fr))',
                'column-gap': '12px',
                'row-gap': '18px',
                padding: '16px 14px',
              },
              children: [
                { type: 'repeat', over: 'collection.items', item: { type: 'use', template: 'gridCard' } },
              ],
            },
            // The rest of a long collection arrives as its end comes into view.
            {
              type: 'box',
              when: [set('collection.more')],
              style: { position: 'relative', height: '1px' },
              children: [
                { type: 'widget', widget: 'sentinel', params: { on: 'collection' }, style: { ...fill } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

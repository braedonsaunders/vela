import type { Node, Style } from '../../../../protocol/skin';
import { gridCard, titleGrid } from './cards';
import {
  display,
  enter,
  eyebrow,
  failure,
  focusRing,
  gutter,
  gutterSmall,
  is,
  pulse,
  ready,
  small,
} from './look';

// A collection page (compiled cinematic's Collection: BrowsePage under a Collection
// eyebrow): a way back and the name over a faint aura, the titles in a grid, and more as
// the end comes near.
// The route paints its own page: a document whose shell leaves the ground to its home (Kids)
// still reads its ink on its paper here.
export const collection: Node = {
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'min-height': '100vh',
    'background-color': '$ui.page',
  },
  children: [
    {
      type: 'box',
      when: [is('env.load', 'loading')],
      role: 'status',
      label: '{t:ui.openingCollection}',
      style: {
        display: 'flex',
        'flex-direction': 'column',
        padding: '96px 24px',
        'align-items': 'center',
        gap: '16px',
      },
      children: [
        pulse,
        {
          type: 'text',
          text: '{t:ui.openingCollection}',
          style: { color: '$ui.inkSecondary', 'font-size': '15px' },
        },
      ],
    },
    failure('{t:ui.thisCollectionCouldnTBeOpened}'),
    {
      type: 'box',
      when: [ready],
      style: { display: 'flex', 'flex-direction': 'column', gap: '32px', 'padding-bottom': '80px' },
      small: { gap: '22px' },
      children: [
        {
          type: 'box',
          style: {
            position: 'relative',
            display: 'flex',
            'flex-direction': 'column',
            gap: '12px',
            'padding-top': '112px',
            'padding-bottom': '8px',
            ...gutter,
            'background-image': 'radial-gradient(ellipse 70% 120% at 15% 0%, #77533525 0%, #77533500 70%)',
          } as Style,
          small: { gap: '10px', 'padding-top': '120px', 'padding-bottom': '4px', ...gutterSmall } as Style,
          children: [
            {
              type: 'box',
              motion: enter(60),
              style: {
                position: 'relative',
                display: 'flex',
                'flex-direction': 'row',
                gap: '14px',
                'align-items': 'center',
              },
              children: [
                {
                  type: 'box',
                  press: { action: 'back' },
                  label: '{t:ui.back}',
                  style: {
                    position: 'relative',
                    width: '40px',
                    height: '40px',
                    padding: '11px',
                    'box-sizing': 'border-box',
                    border: '1px solid $ui.glassEdge',
                    'border-radius': '$ui.radiusControl',
                    'background-color': '$ui.control',
                    'backdrop-filter': 'blur(20px) saturate(1.3)',
                    color: '$ui.ink',
                    'flex-shrink': '0',
                  } as Style,
                  hover: { 'background-color': '$ui.controlHover' },
                  focus: { 'box-shadow': focusRing },
                  children: [{ type: 'icon', symbol: 'back', style: { width: '18px', height: '18px' } }],
                },
                {
                  type: 'text',
                  text: '{t:ui.collection}',
                  style: { ...eyebrow, 'font-size': '10px', color: '$ui.accent' } as Style,
                },
              ],
            },
            {
              type: 'text',
              text: '{collection.name}',
              role: 'heading',
              level: 1,
              motion: enter(120),
              style: { ...display, position: 'relative', 'font-size': '44px' } as Style,
              small: { 'font-size': '34px' },
            },
          ],
        },
        {
          ...titleGrid,
          children: [
            {
              type: 'repeat',
              over: 'collection.items',
              item: { ...gridCard, motion: 'velaCard', stagger: { step: 30, cap: 18 } } as Node,
            },
          ],
        } as Node,
      ],
    },
    {
      type: 'box',
      when: [ready, { test: 'collection.more' }],
      style: {
        display: 'flex',
        'flex-direction': 'column',
        height: '120px',
        'align-items': 'center',
        'justify-content': 'center',
      },
      children: [
        { type: 'widget', widget: 'sentinel', params: { on: 'collection' } },
        { ...pulse, when: [{ test: 'env.collectionMoreLoading' }] } as Node,
      ],
    },
  ],
};

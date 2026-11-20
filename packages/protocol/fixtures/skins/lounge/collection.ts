import type { Node, Style } from '../../../skin';
import { gridSmall, gridStyle, gridWide } from './cards';
import { capsule, capsuleFocus, gutter, gutterSmall, sans } from './look';
import { posterBone } from './skeletons';

// A box set, folder or playlist: pushed over home, with its own Back.
export const collection: Node = {
  type: 'box',
  style: {
    position: 'absolute',
    inset: '0px',
    display: 'flex',
    'flex-direction': 'column',
    'background-color': '$ground',
    color: '$ink',
    'font-family': sans,
  },
  children: [
    {
      type: 'box',
      a11y: { hidden: true },
      style: {
        position: 'absolute',
        left: '-10%',
        top: '-30%',
        width: '80%',
        height: '80%',
        'background-color': '#dcb998',
        opacity: '0.1',
        'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)',
        'pointer-events': 'none',
      },
    },
    {
      type: 'box',
      id: '{env.route}-scroll-{env.entry}',
      role: 'region',
      label: '{collection.name}',
      style: {
        position: 'relative',
        flex: '1',
        'min-height': '0px',
        'overflow-y': 'auto',
        'overflow-x': 'hidden',
        'padding-bottom': 'max(64px, 8vh)',
      },
      children: [
        {
          type: 'box',
          style: {
            display: 'flex',
            'flex-direction': 'column',
            'align-items': 'flex-start',
            gap: 'clamp(14px, 1.3vw, 24px)',
            'padding-top': 'max(36px, 5vh)',
            'padding-bottom': 'clamp(24px, 2vw, 40px)',
            ...gutter,
          },
          small: { 'padding-top': '24px', ...gutterSmall },
          children: [
            {
              type: 'box',
              press: { action: 'back' },
              controlStates: false,
              label: '{s:back}',
              testId: 'collection-back',
              style: capsule('clamp(50px, 3.8vw, 72px)'),
              focus: capsuleFocus,
              active: { scale: '0.97' },
              hover: { 'background-color': 'rgba(255, 255, 255, 0.24)' },
              children: [
                {
                  type: 'icon',
                  symbol: 'back',
                  style: { width: 'clamp(16px, 1.2vw, 24px)', height: 'clamp(16px, 1.2vw, 24px)' },
                },
                { type: 'text', text: '{s:back}' },
              ],
            },
            {
              type: 'text',
              text: '{collection.kindLabel}',
              motion: 'copy0',
              style: {
                'margin-top': 'clamp(18px, 2vw, 40px)',
                'font-size': 'clamp(13px, 0.95vw, 18px)',
                'font-weight': '700',
                'letter-spacing': '0.16em',
                'text-transform': 'uppercase',
                color: '$amber',
              } as Style,
            },
            {
              type: 'text',
              text: '{collection.name}',
              role: 'heading',
              level: 1,
              motion: 'copy1',
              style: {
                'font-size': 'clamp(44px, 4.4vw, 92px)',
                'font-weight': '800',
                'letter-spacing': '-0.025em',
                'line-height': '1',
                'max-width': '24ch',
              },
              small: { 'font-size': '34px' },
            },
            {
              type: 'text',
              when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
              text: '{s:collectionCount}',
              motion: 'copy2',
              style: {
                'font-size': 'clamp(16px, 1.2vw, 23px)',
                'font-weight': '600',
                color: '$ink-dim',
                'font-variant-numeric': 'tabular-nums',
              },
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
          style: { ...gridStyle, 'padding-top': 'clamp(12px, 1vw, 20px)' } as Style,
          wide: gridWide,
          small: gridSmall,
          children: [
            {
              type: 'repeat',
              over: 'collection.items',
              item: { type: 'use', template: 'gridPoster', motion: 'cardIn', stagger: { step: 30, cap: 12 } },
            },
          ],
        },
        // After the grid, across its width: the next page's sentinel, its loading line, the empty state.
        {
          type: 'box',
          when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
          style: { display: 'flex', 'flex-direction': 'column', gap: '12px', 'padding-top': '12px', ...gutter },
          small: { ...gutterSmall },
          children: [
            {
              type: 'box',
              when: [{ test: 'collection.more' }],
              style: { position: 'relative', height: '2px' },
              children: [{ type: 'widget', widget: 'sentinel', params: { on: 'collection' } }],
            },
            {
              type: 'text',
              when: [{ test: 'env.collectionMoreLoading' }],
              text: '{s:loadingMore}',
              role: 'status',
              motion: 'pulse',
              style: { 'font-size': 'clamp(15px, 1.1vw, 21px)', color: '$ink-quiet' },
            },
            {
              type: 'text',
              when: [{ test: 'collection.itemCount', is: 'eq', value: '0' }, { test: 'collection.complete' }],
              text: '{s:collectionEmpty}',
              role: 'status',
              style: { 'font-size': 'clamp(20px, 1.6vw, 32px)', 'font-weight': '700' },
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'env.load', is: 'eq', value: 'loading' }],
          role: 'status',
          label: '{s:loadingCollection}',
          style: {
            ...gridStyle,
            'padding-top': 'clamp(12px, 1vw, 20px)',
            'max-height': '70vh',
            'overflow-y': 'hidden',
          } as Style,
          wide: gridWide,
          small: gridSmall,
          children: Array.from({ length: 12 }, () => ({
            ...posterBone,
            style: { ...posterBone.style, width: '100%' } as Style,
            small: {},
          })),
        },
        {
          type: 'box',
          when: [{ test: 'env.load', is: 'eq', value: 'failed' }],
          role: 'alert',
          style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start', gap: '20px', ...gutter },
          small: { ...gutterSmall },
          children: [
            {
              type: 'text',
              text: '{s:collectionFailed}',
              style: { 'font-size': 'clamp(24px, 2vw, 40px)', 'font-weight': '700' },
            },
            {
              type: 'box',
              when: [{ test: 'env.canRetry' }],
              press: { action: 'retry' },
              controlStates: false,
              label: '{s:tryAgain}',
              style: capsule('clamp(58px, 4.4vw, 84px)'),
              focus: capsuleFocus,
              active: { scale: '0.97' },
              children: [{ type: 'text', text: '{s:tryAgain}' }],
            },
          ],
        },
      ],
    },
  ],
};

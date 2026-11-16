import type { BoxNode, Node, Style } from '../../../wire/v0/skin';
import { display, gutter, gutterSmall, is, placeholder, pulse, small, veil } from './look';

export const card: Node = {
  type: 'box',
  group: true,
  press: { action: 'select', arg: '{card.kindId}' },
  label: '{card.label}',
  testId: 'title-{card.id}',
  controlStates: false,
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    width: 'clamp(150px, 12.4vw, 232px)',
    'flex-shrink': '0',
    gap: '12px',
  },
  small: { width: '132px' },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    {
      type: 'box',
      style: {
        position: 'relative',
        width: '100%',
        'aspect-ratio': '2 / 3',
        'background-color': '$ui.raised',
        'border-radius': '12px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        scale: '1',
        translate: '0px 0px',
        'box-shadow': '0px 10px 24px -12px $ui.shadow, 0px 0px 0px 1px $ui.glassEdge',
        transition: [
          'scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
          'translate 360ms cubic-bezier(0.16, 1, 0.3, 1)',
          'box-shadow 360ms cubic-bezier(0.16, 1, 0.3, 1)',
        ].join(', '),
      },
      small: { 'border-radius': '10px' },
      groupHover: {
        scale: '1.045',
        translate: '0px -6px',
        'box-shadow': '0px 28px 50px -14px $ui.shadow, 0px 0px 0px 1px $ui.glassEdgeStrong',
      },
      groupFocus: {
        scale: '1.045',
        translate: '0px -6px',
        'box-shadow': '0px 0px 0px 3px $ui.ink, 0px 28px 50px -14px $ui.shadow',
      },
      children: [
        {
          type: 'image',
          when: [{ test: 'card.poster' }],
          src: '{card.poster}',
          alt: '',
          fade: true,
          style: {
            position: 'absolute',
            inset: '0px',
            width: '100%',
            height: '100%',
            'object-fit': 'cover',
            transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)',
          },
        },
        {
          type: 'box',
          when: [{ test: 'card.poster', not: true }],
          style: {
            position: 'absolute',
            inset: '0px',
            padding: '16px',
            display: 'flex',
            'flex-direction': 'column',
            'justify-content': 'flex-end',
            'background-image': placeholder(160),
          },
          children: [
            {
              type: 'text',
              text: '{card.name}',
              style: {
                'font-family': '$ui.fontDisplay',
                'font-size': '24px',
                'line-clamp': '4',
                'line-height': '0.98',
              },
              small: { 'font-size': '20px' },
            },
          ],
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            'pointer-events': 'none',
            'background-image': 'linear-gradient(145deg, #ffffff21 0%, #ffffff00 42%)',
            opacity: '0',
            transition: 'opacity 360ms cubic-bezier(0.16, 1, 0.3, 1)',
          },
          groupHover: { opacity: '1' },
          groupFocus: { opacity: '1' },
        },
        {
          type: 'box',
          when: [{ test: 'card.played' }],
          style: {
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '24px',
            height: '24px',
            'border-radius': '12px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'background-color': '$ui.glass',
            'backdrop-filter': 'blur(12px)',
          },
          children: [
            { type: 'icon', symbol: 'checkmark', style: { width: '12px', height: '12px', color: '$ui.ink' } },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'card.hasProgress' }, { test: 'card.played', not: true }],
          style: {
            position: 'absolute',
            left: '0px',
            right: '0px',
            bottom: '0px',
            height: '36px',
            'background-image': `linear-gradient(0deg, ${veil(85)} 0%, ${veil(0)} 100%)`,
          },
        },
        {
          type: 'box',
          when: [{ test: 'card.hasProgress' }, { test: 'card.played', not: true }],
          style: {
            position: 'absolute',
            left: '10px',
            right: '10px',
            bottom: '10px',
            height: '3px',
            'border-radius': '2px',
            'background-color': '$ui.trackStrong',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
          },
          children: [
            {
              type: 'box',
              style: { height: '3px', width: '{card.progressPct}%', 'background-color': '$ui.accent' },
            },
          ],
        },
      ],
    },
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'column',
        gap: '4px',
        padding: '0px 2px',
        opacity: '0.86',
        transition: 'opacity 180ms linear',
      },
      groupHover: { opacity: '1' },
      children: [
        {
          type: 'text',
          text: '{card.name}',
          style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1', color: '$ui.ink' },
          small: { 'font-size': '13px' },
        },
        {
          type: 'text',
          text: '{card.facts}',
          style: {
            'font-size': '12px',
            color: '$ui.inkQuiet',
            'line-clamp': '1',
            'font-variant-numeric': 'tabular-nums',
          },
        },
      ],
    },
  ],
};

// A Top 10 row's numeral: large, outlined, fading toward its foot, the poster overlapping
// its right edge. "10" sits tighter so both digits fit beside the card.
export const numeral = (ten: boolean): Node => ({
  type: 'text',
  text: '{index.label}',
  when: [
    { test: 'row.presentation', is: 'eq', value: 'ranked' },
    { test: 'index', is: ten ? 'eq' : 'lt', value: '9' },
  ],
  style: {
    'font-family': '"Arial Black", "Helvetica Neue", Arial, sans-serif',
    'font-weight': '900',
    'font-size': '348px',
    'line-height': '0.74',
    'letter-spacing': ten ? '-0.2em' : '-0.09em',
    color: '$ui.page',
    'text-shadow': '0px 0px 5px color-mix(in srgb, $ui.ink 88%, $ui.page)',
    'mask-image': 'linear-gradient(180deg, black 0%, black 50%, rgba(0, 0, 0, 0.25) 100%)',
    'margin-right': '-50px',
    'padding-bottom': '52px',
    'flex-shrink': '0',
  },
  small: {
    'font-size': '220px',
    'text-shadow': '0px 0px 3px color-mix(in srgb, $ui.ink 88%, $ui.page)',
    'margin-right': '-30px',
    'padding-bottom': '44px',
  },
});
export const rowItem: Node = {
  type: 'box',
  motion: 'velaCard',
  stagger: { step: 45, cap: 8 },
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-end' },
  children: [numeral(false), numeral(true), { type: 'use', template: 'velaCard' }],
};
// The row's end cell: its next page loads as the end comes near (home rows only).
export const rowEnd: Node = {
  type: 'box',
  when: [{ test: 'row.hasMore' }],
  style: {
    position: 'relative',
    display: 'flex',
    width: '96px',
    'align-self': 'stretch',
    'flex-shrink': '0',
    'align-items': 'center',
    'justify-content': 'center',
  },
  small: { width: '60px' },
  children: [
    { type: 'widget', widget: 'sentinel', params: { on: 'row' } },
    { ...pulse, when: [{ test: 'row.loadingMore' }] } as Node,
  ],
};
// A shelf scrolls sideways; ranked shelves space their cards wider, room for the numerals.
export const shelf = (ranked: boolean, paged: boolean): Node => ({
  type: 'box',
  when: [{ test: 'row.presentation', is: ranked ? 'eq' : 'ne', value: 'ranked' }],
  style: {
    display: 'flex',
    'flex-direction': 'row',
    gap: ranked ? '40px' : '18px',
    'align-items': 'flex-start',
    'overflow-x': 'auto',
    'overflow-y': 'hidden',
    'scrollbar-width': 'none',
    'mask-image': 'linear-gradient(90deg, black 0%, black 94%, transparent 100%)',
    'padding-top': '16px',
    'padding-bottom': '22px',
    ...gutter,
  },
  small: { gap: ranked ? '22px' : '12px', 'padding-top': '14px', 'padding-bottom': '18px', ...gutterSmall },
  children: [{ type: 'repeat', over: 'row.items', item: rowItem }, ...(paged ? [rowEnd] : [])],
});

export const shelfRow = (paged: boolean): Node => ({
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    gap: '4px',
    'padding-bottom': '28px',
  },
  small: { gap: '2px', 'padding-bottom': '18px' },
  children: [
    {
      type: 'text',
      text: '{row.name}',
      role: 'heading',
      level: 2,
      style: { 'font-size': '21px', 'font-weight': '650', 'letter-spacing': '-0.012em', ...gutter },
      small: { 'font-size': '18px', ...gutterSmall },
    },
    shelf(false, paged),
    shelf(true, paged),
  ],
});
export const row = shelfRow(true);
export const relatedRow = shelfRow(false);

// The browse grid (compiled cinematic's TitleGrid); library and collection pages fill it.
export const titleGrid: Node = {
  type: 'box',
  style: {
    display: 'grid',
    'grid-template-columns': 'repeat(auto-fill, minmax(190px, 1fr))',
    'column-gap': '20px',
    'row-gap': '34px',
    ...gutter,
  } as Style,
  small: {
    'grid-template-columns': 'repeat(auto-fill, minmax(140px, 1fr))',
    'column-gap': '12px',
    'row-gap': '22px',
    ...gutterSmall,
  } as Style,
  children: [],
};
export const gridCard: Node = {
  ...card,
  style: { ...(card as BoxNode).style, width: '100%' },
  small: { width: '100%' },
} as Node;

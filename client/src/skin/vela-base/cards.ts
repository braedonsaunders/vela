import type { BoxNode, Condition, Node, Style } from '../../../wire/v0/skin';
import { cardRadius, display, gutter, gutterSmall, is, placeholder, pulse, small, veil } from './look';

// A muted trailer preview: a landscape card that opens over the poster while the card's preview
// plays (home rows that preview on focus). It stays mounted while idle, since the widget inside
// reports the card's hover and focus as the intent to preview; only its state shows it. A press
// lands on the card underneath.
const previewOverlay = (shown: boolean): Style => ({
  position: 'absolute',
  left: '0px',
  top: '0px',
  'z-index': '6',
  width: '190%',
  'aspect-ratio': '16 / 9',
  translate: '-23.7% 20%',
  'border-radius': '$ui.radiusCard',
  'overflow-x': 'hidden',
  'overflow-y': 'hidden',
  'background-color': '$ui.raised',
  'box-shadow': '0px 40px 80px -20px $ui.shadow, 0px 0px 0px 1px $ui.glassEdgeStrong',
  // Never under the pointer: the card's hover is its press button's, which the overlay is not
  // inside, so taking the pointer would end the hover and with it the preview.
  'pointer-events': 'none',
  opacity: shown ? '1' : '0',
  scale: shown ? '1' : '0.94',
  transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1), scale 420ms cubic-bezier(0.16, 1, 0.3, 1)',
});
const previewing: Condition = { test: 'card.previewing' };
const fill: Style = { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' };
export const cardPreview: Node = {
  type: 'box',
  a11y: { hidden: true },
  style: previewOverlay(false),
  states: [{ when: [previewing], style: previewOverlay(true) }],
  children: [
    {
      type: 'image',
      when: [previewing, { test: 'card.backdrop' }],
      src: '{card.backdrop}',
      alt: '',
      style: fill,
    },
    {
      type: 'image',
      when: [previewing, { test: 'card.backdrop', not: true }],
      src: '{card.poster}',
      alt: '',
      style: fill,
    },
    { type: 'widget', widget: 'cardPreview', style: { position: 'absolute', inset: '0px' } },
    {
      type: 'box',
      when: [previewing],
      style: {
        position: 'absolute',
        left: '0px',
        right: '0px',
        bottom: '0px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '3px',
        padding: '40px 14px 12px',
        'background-image': `linear-gradient(0deg, ${veil(94)} 0%, ${veil(0)} 100%)`,
      },
      children: [
        {
          type: 'text',
          text: '{card.name}',
          style: { 'font-size': '14px', 'font-weight': '650', 'line-clamp': '1', color: '$ui.ink' },
        },
        {
          type: 'text',
          text: '{card.facts}',
          style: {
            'font-size': '11px',
            color: '$ui.inkSecondary',
            'line-clamp': '1',
            'font-variant-numeric': 'tabular-nums',
          },
        },
      ],
    },
  ],
};

// Portrait art filling the card, centred: a poster, or landscape art cropped to the portrait frame.
const posterArt: Style = {
  position: 'absolute',
  inset: '0px',
  width: '100%',
  height: '100%',
  'object-fit': 'cover',
  transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)',
};

// A scrim over the art behind the progress bar: dark in every document, unlike a fade to the page.
const progressFoot = 'linear-gradient(0deg, $ui.scrim 0%, color-mix(in srgb, $ui.scrim 0%, transparent) 100%)';

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
        'border-radius': cardRadius(2),
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
      small: { 'border-radius': cardRadius(4) },
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
        // The portrait art: the poster (an episode's is its series poster), else the landscape
        // art (an episode's still) cropped to the portrait frame; the named card only without art.
        {
          type: 'image',
          when: [{ test: 'card.poster' }],
          src: '{card.poster}',
          alt: '',
          fade: true,
          style: posterArt,
        },
        {
          type: 'image',
          when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop' }],
          src: '{card.backdrop}',
          alt: '',
          fade: true,
          style: posterArt,
        },
        {
          type: 'box',
          when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop', not: true }],
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
            'background-image': progressFoot,
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
    cardPreview,
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
const rowItemStyle = (layer: string): Style => ({
  position: 'relative',
  display: 'flex',
  'flex-direction': 'row',
  'align-items': 'flex-end',
  'z-index': layer,
});
export const rowItem: Node = {
  type: 'box',
  motion: 'velaCard',
  stagger: { step: 45, cap: 8 },
  style: rowItemStyle('0'),
  // The previewing card's overlay opens over its neighbours.
  states: [{ when: [previewing], style: rowItemStyle('5') }],
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
// Browse grids never preview: the grid card leaves the overlay out.
export const gridCard: Node = {
  ...card,
  children: ((card as BoxNode).children ?? []).filter(child => child !== cardPreview),
  style: { ...(card as BoxNode).style, width: '100%' },
  small: { width: '100%' },
} as Node;

// Title cards as stickers and the named shelves that hold them.
import type { Node, Style } from '../../../skin';
import {
  ACCENTS,
  Accent,
  Pixel,
  Title,
  asset,
  byAccent,
  col,
  fadeIn,
  gutter,
  gutterSmall,
  hopper,
  icon,
  inset0,
  lift,
  liftStill,
  mod,
  moving,
  not,
  row,
  set,
  stillC,
  sz,
  twinkle,
} from './look';

// A poster sticker (slots.contract TitleCard): white-edged with a hard pastel shadow; on
// hover or focus it bounces up, tilts toward the viewer and a sparkle pops in.
export const SHADOW: Record<Accent, string> = { pink: '$shadow-pink', lavender: '$shadow', mint: '$mint' };
// One element whose accent (pink, lavender, mint) and lean (left, right) follow the name, as
// states, so a card stays a handful of nodes.
export const stickerLook = (accent: Accent, still: boolean): Style => ({
  ...col,
  position: 'relative',
  // The poster area is the column's width; the 3px edge sits outside it, as on compiled Mochi.
  width: 'calc(100% + 6px)',
  'box-sizing': 'border-box',
  border: '3px solid $ink',
  'border-radius': '20px',
  'overflow-x': 'hidden',
  'overflow-y': 'hidden',
  'background-color': `$${accent}`,
  color: '$ink',
  'text-align': 'left',
  translate: '0px 0px',
  rotate: '0',
  scale: '1',
  'box-shadow': `4px 5px 0px ${SHADOW[accent]}`,
  transition: still ? liftStill : lift,
});
export const stickerStates = [true, false].flatMap(still =>
  ACCENTS.flatMap((accent, i) =>
    [-2.2, 2.2].map((tilt, j) => {
      const up: Style = {
        translate: '0px -8px',
        rotate: `${tilt}`,
        scale: '1.03',
        'box-shadow': `7px 10px 0px ${SHADOW[accent]}`,
      };
      return {
        when: [...(still ? [stillC] : []), mod('card', 3, i), mod('card', 2, j)],
        style: stickerLook(accent, still),
        hover: up,
        focus: { ...up, outline: 'auto', 'box-shadow': '0px 0px 0px 3px $card, 0px 0px 0px 7px $focus' },
      };
    }),
  ),
);
// The sticker is the card's button (so the focus ring leans and lifts with it); its poster area
// keeps the 2:3 shape inside the edge.
export const sticker = (): Node => {
  return {
    type: 'box',
    group: true,
    press: { action: 'select', arg: '{card.kindId}' },
    label: '{card.label}',
    testId: 'title-{card.id}',
    style: stickerLook('pink', false),
    small: { 'border-radius': '16px' },
    states: stickerStates,
    children: [
      {
        type: 'box',
        style: { ...col, position: 'relative', width: '100%', 'aspect-ratio': '2 / 3' },
        children: [
          {
            type: 'image',
            when: [set('card.poster')],
            src: '{card.poster}',
            alt: '',
            fade: true,
            style: fadeIn,
          },
          // No poster: the name on a soft wash under a pixel star.
          {
            type: 'box',
            when: [not('card.poster')],
            style: {
              ...col,
              ...inset0,
              padding: '14px',
              gap: '10px',
              'justify-content': 'flex-end',
              'background-image': 'linear-gradient(160deg, $card 0%, $page-clear 70%)',
            },
            children: [
              icon('star', 18, 'ink'),
              {
                type: 'text',
                text: '{card.name}',
                style: { ...Title, 'font-size': '21px', 'line-clamp': '4' },
                small: { 'font-size': '18px' },
              },
            ],
          },
          {
            type: 'box',
            style: {
              ...inset0,
              'pointer-events': 'none',
              'border-radius': '17px',
              'box-shadow': 'inset 0px 0px 0px 3px $edge',
            },
            small: { 'border-radius': '13px' },
          },
          {
            type: 'box',
            when: [set('card.played')],
            style: {
              ...row,
              position: 'absolute',
              top: '8px',
              right: '8px',
              ...sz(26),
              'border-radius': '13px',
              'align-items': 'center',
              'justify-content': 'center',
              'background-color': '$mint',
              border: '2px solid $ink',
              'box-sizing': 'border-box',
              color: '$ink',
            },
            children: [icon('check', 12)],
          },
          {
            type: 'box',
            when: [set('card.hasProgress'), not('card.played')],
            style: {
              ...col,
              position: 'absolute',
              left: '10px',
              right: '10px',
              bottom: '10px',
              height: '10px',
              'border-radius': '5px',
              'background-color': '$card',
              border: '2px solid $ink',
              'box-sizing': 'border-box',
              'overflow-x': 'hidden',
              'overflow-y': 'hidden',
            },
            children: [
              {
                type: 'box',
                style: {
                  height: '100%',
                  width: '{card.progressPct}%',
                  'background-color': '$pink',
                  'background-image':
                    'repeating-linear-gradient(135deg, $pink 0px, $pink 4px, $pink-hover 4px, $pink-hover 8px)',
                },
              },
            ],
          },
          // Shown (and so popping in) only while lifted.
          {
            type: 'box',
            when: [moving],
            motion: 'sparklePop',
            style: { position: 'absolute', top: '10px', left: '10px', color: '$card', display: 'none' },
            groupHover: { display: 'flex' },
            groupFocus: { display: 'flex' },
            children: [twinkle('card', 14)],
          },
        ],
      },
    ],
  } as Node;
};

export const card: Node = {
  type: 'box',
  motion: 'hop0',
  stagger: { step: 45, cap: 8 },
  style: {
    ...col,
    position: 'relative',
    width: 'clamp(146px, 11.6vw, 208px)',
    'flex-shrink': '0',
    gap: '10px',
  },
  small: { width: '132px' },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    sticker(),
    {
      type: 'box',
      style: { ...col, gap: '3px', padding: '0px 4px' },
      children: [
        {
          type: 'text',
          text: '{card.name}',
          style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '1', color: '$ink' },
          small: { 'font-size': '14px' },
        },
        {
          type: 'text',
          text: '{card.facts}',
          style: {
            'font-size': '12.5px',
            color: '$ink-soft',
            'line-clamp': '1',
            'font-variant-numeric': 'tabular-nums',
          },
        },
      ],
    },
  ],
};

// A named shelf in server order (slots.contract Shelf): a pixel star in the row's
// colour, pixel type, a squiggle, then the cards sliding horizontally.
export const shelf = (paged: boolean): Node => ({
  type: 'box',
  style: { ...col, position: 'relative', gap: '0px', 'padding-bottom': '18px' },
  small: { 'padding-bottom': '10px' },
  children: [
    {
      type: 'box',
      style: { ...row, gap: '10px', 'align-items': 'center', ...gutter },
      small: gutterSmall,
      children: [
        ...byAccent('row', a => ({
          type: 'box',
          style: { ...col, 'flex-shrink': '0', color: `$${a}`, filter: 'drop-shadow(1.5px 1.5px 0px $ink)' },
          children: [icon('star', 18, undefined, { small: sz(16) })],
        })),
        {
          type: 'box',
          style: { ...col, gap: '2px', 'min-width': '0px' },
          children: [
            {
              type: 'text',
              text: '{row.name}',
              role: 'heading',
              level: 2,
              style: {
                ...Pixel,
                'font-size': '23px',
                color: '$ink',
                'white-space': 'nowrap',
                'overflow-x': 'hidden',
                'text-overflow': 'ellipsis',
              },
              small: { 'font-size': '19px' },
            },
            ...byAccent('row', a => ({
              type: 'image',
              src: asset(`squiggle-${a}.svg`),
              alt: '',
              style: sz(72, 7),
            })),
          ],
        },
      ],
    },
    // The scroller is the track (a flex scroll box keeps its end padding).
    {
      type: 'box',
      style: {
        ...row,
        'overflow-x': 'auto',
        'overflow-y': 'hidden',
        'scrollbar-width': 'none',
        gap: '20px',
        'align-items': 'flex-start',
        'padding-top': '22px',
        'padding-bottom': '24px',
        ...gutter,
      },
      small: { gap: '14px', 'padding-top': '18px', 'padding-bottom': '18px', ...gutterSmall },
      children: [
        { type: 'repeat', over: 'row.items', item: { type: 'use', template: 'card' } },
        // A home row's end: a sentinel that asks for more, with Mochi hopping while it loads.
        ...(paged
          ? [
              {
                type: 'box',
                when: [set('row.hasMore')],
                style: {
                  ...col,
                  position: 'relative',
                  width: '104px',
                  'align-self': 'stretch',
                  'flex-shrink': '0',
                  'align-items': 'center',
                  'justify-content': 'center',
                },
                small: { width: '72px' },
                children: [
                  { type: 'widget', widget: 'sentinel', params: { on: 'row' } },
                  { ...hopper(36), when: [set('row.loadingMore')] } as Node,
                ],
              } as Node,
            ]
          : []),
      ],
    },
  ],
});

import type { Node, Style } from '../../../skin';
import { ease, gutter, gutterSmall, lift, rest, ring, glint } from './look';

// A poster: the focused one lifts, grows and catches the light; the art inside moves
// against the frame, which reads as depth (the remote's parallax).
export const poster: Node = {
  type: 'box',
  group: true,
  press: { action: 'select', arg: '{card.kindId}' },
  controlStates: false,
  label: '{card.label}',
  testId: 'title-{card.id}',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    width: 'clamp(150px, 11.2vw, 252px)',
    'flex-shrink': '0',
    gap: 'clamp(12px, 1vw, 20px)',
  },
  small: { width: '128px', gap: '10px' },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    {
      type: 'box',
      style: {
        position: 'relative',
        width: '100%',
        'aspect-ratio': '2 / 3',
        'border-radius': 'clamp(12px, 0.9vw, 18px)',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$raised',
        'box-shadow': rest,
        scale: '1',
        translate: '0px 0px',
        transition: lift,
      },
      groupHover: { scale: '1.12', translate: '0px -10px', 'box-shadow': ring },
      small: { 'border-radius': '10px' },
      children: [
        {
          type: 'box',
          when: [{ test: 'card.poster' }],
          style: {
            position: 'absolute',
            inset: '0px',
            scale: '1.02',
            translate: '0px 0px',
            transition: `scale 600ms ${ease}, translate 600ms ${ease}`,
          },
          groupHover: { scale: '1.08', translate: '0px 3%' },
          children: [
            {
              type: 'image',
              src: '{card.poster}',
              alt: '',
              fade: true,
              style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' },
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'card.poster', not: true }],
          style: {
            position: 'absolute',
            inset: '0px',
            padding: 'clamp(14px, 1.1vw, 22px)',
            display: 'flex',
            'flex-direction': 'column',
            'justify-content': 'flex-end',
            'background-image': 'linear-gradient(160deg, #262b34 0%, #121419 100%)',
          },
          children: [
            {
              type: 'text',
              text: '{card.name}',
              style: {
                'font-size': 'clamp(18px, 1.4vw, 28px)',
                'font-weight': '750',
                'line-height': '1.05',
                'line-clamp': '4',
                'letter-spacing': '-0.01em',
              },
            },
          ],
        },
        // The glint: a band of light crosses the poster as it takes focus.
        {
          type: 'box',
          style: {
            position: 'absolute',
            top: '-20%',
            bottom: '-20%',
            left: '-60%',
            width: '60%',
            'pointer-events': 'none',
            'background-image': glint('0.22'),
            opacity: '0',
            translate: '0px 0px',
            transition: `translate 900ms ${ease}, opacity 900ms ${ease}`,
          },
          groupHover: { opacity: '1', translate: '330% 0px' },
        },
        {
          type: 'box',
          when: [{ test: 'card.played' }],
          style: {
            position: 'absolute',
            top: '10px',
            right: '10px',
            width: 'clamp(26px, 1.8vw, 36px)',
            height: 'clamp(26px, 1.8vw, 36px)',
            'border-radius': '999px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            // A solid badge, no blur: a filter per card is costly on a TV's GPU.
            'background-color': 'rgba(10, 12, 16, 0.82)',
          },
          children: [{ type: 'icon', symbol: 'checkmark', style: { width: '50%', height: '50%', color: '$ink' } }],
        },
        {
          type: 'box',
          when: [{ test: 'card.hasProgress' }],
          style: {
            position: 'absolute',
            left: '0px',
            right: '0px',
            bottom: '0px',
            height: '30%',
            'background-image': 'linear-gradient(0deg, rgba(5, 6, 9, 0.85) 0%, rgba(5, 6, 9, 0) 100%)',
          },
        },
        {
          type: 'box',
          when: [{ test: 'card.hasProgress' }],
          style: {
            position: 'absolute',
            left: '12px',
            right: '12px',
            bottom: '12px',
            height: '5px',
            'border-radius': '3px',
            'background-color': 'rgba(255, 255, 255, 0.24)',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
          },
          children: [
            { type: 'box', style: { height: '5px', width: '{card.progressPct}%', 'background-color': '$ink' } },
          ],
        },
      ],
    },
    // The caption brightens and rises with its poster.
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'column',
        gap: '4px',
        padding: '0px 2px',
        opacity: '0.62',
        translate: '0px 0px',
        transition: `opacity 260ms linear, translate 420ms ${ease}`,
      },
      groupHover: { opacity: '1', translate: '0px 8px' },
      children: [
        {
          type: 'text',
          text: '{card.name}',
          style: { 'font-size': 'clamp(15px, 1.1vw, 22px)', 'font-weight': '650', 'line-clamp': '1' },
          small: { 'font-size': '14px' },
        },
        {
          type: 'text',
          text: '{card.facts}',
          style: {
            'font-size': 'clamp(13px, 0.9vw, 18px)',
            color: '$ink-quiet',
            'line-clamp': '1',
            'font-variant-numeric': 'tabular-nums',
          },
          small: { 'font-size': '12px' },
        },
      ],
    },
  ],
};

// A row of things in progress (continue watching, next up) draws wide 16:9 stills:
// the frame you left, the time left, and the episode under it.
export const wide: Node = {
  type: 'box',
  group: true,
  press: { action: 'select', arg: '{card.kindId}' },
  controlStates: false,
  label: '{card.label}',
  testId: 'title-{card.id}',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    width: 'clamp(280px, 22vw, 470px)',
    'flex-shrink': '0',
    gap: 'clamp(12px, 1vw, 20px)',
  },
  small: { width: '240px', gap: '10px' },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    {
      type: 'box',
      style: {
        position: 'relative',
        width: '100%',
        'aspect-ratio': '16 / 9',
        'border-radius': 'clamp(12px, 0.9vw, 18px)',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$raised',
        'box-shadow': rest,
        scale: '1',
        translate: '0px 0px',
        transition: lift,
      },
      groupHover: { scale: '1.08', translate: '0px -8px', 'box-shadow': ring },
      small: { 'border-radius': '10px' },
      children: [
        {
          type: 'box',
          when: [{ test: 'card.backdrop' }],
          style: { position: 'absolute', inset: '0px', scale: '1.02', transition: `scale 600ms ${ease}` },
          groupHover: { scale: '1.07' },
          children: [
            {
              type: 'image',
              src: '{card.backdrop}',
              alt: '',
              fade: true,
              style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' },
            },
          ],
        },
        {
          type: 'image',
          when: [{ test: 'card.backdrop', not: true }, { test: 'card.poster' }],
          src: '{card.poster}',
          alt: '',
          style: {
            position: 'absolute',
            top: '-30%',
            left: '-10%',
            width: '120%',
            height: '160%',
            'object-fit': 'cover',
            filter: 'blur(28px) saturate(1.3)',
            opacity: '0.8',
          },
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            'background-image': 'linear-gradient(0deg, rgba(5, 6, 9, 0.8) 0%, rgba(5, 6, 9, 0) 55%)',
          },
        },
        {
          type: 'text',
          when: [{ test: 'card.backdrop', not: true }],
          text: '{card.name}',
          style: {
            position: 'absolute',
            left: 'clamp(14px, 1.1vw, 22px)',
            right: 'clamp(14px, 1.1vw, 22px)',
            top: 'clamp(12px, 1vw, 20px)',
            'font-size': 'clamp(18px, 1.4vw, 28px)',
            'font-weight': '750',
            'line-height': '1.05',
            'line-clamp': '2',
          },
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            top: '-20%',
            bottom: '-20%',
            left: '-60%',
            width: '50%',
            'pointer-events': 'none',
            'background-image': glint('0.18'),
            opacity: '0',
            translate: '0px 0px',
            transition: `translate 900ms ${ease}, opacity 900ms ${ease}`,
          },
          groupHover: { opacity: '1', translate: '420% 0px' },
        },
        {
          type: 'text',
          when: [{ test: 'card.progressLabel' }, { test: 'card.played', not: true }],
          text: '{card.progressLabel}',
          style: {
            position: 'absolute',
            right: '12px',
            bottom: '20px',
            'font-size': 'clamp(12px, 0.85vw, 16px)',
            'font-weight': '700',
            'font-variant-numeric': 'tabular-nums',
            color: '$ink-dim',
            'text-shadow': '0px 1px 8px rgba(0, 0, 0, 0.8)',
          },
        },
        {
          type: 'box',
          when: [{ test: 'card.hasProgress' }],
          style: {
            position: 'absolute',
            left: '12px',
            right: '12px',
            bottom: '10px',
            height: '5px',
            'border-radius': '3px',
            'background-color': 'rgba(255, 255, 255, 0.24)',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
          },
          children: [
            { type: 'box', style: { height: '5px', width: '{card.progressPct}%', 'background-color': '$ink' } },
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
        opacity: '0.62',
        translate: '0px 0px',
        transition: `opacity 260ms linear, translate 420ms ${ease}`,
      },
      groupHover: { opacity: '1', translate: '0px 6px' },
      children: [
        {
          type: 'text',
          text: '{card.name}',
          style: { 'font-size': 'clamp(15px, 1.1vw, 22px)', 'font-weight': '650', 'line-clamp': '1' },
          small: { 'font-size': '14px' },
        },
        {
          type: 'text',
          text: '{card.facts}',
          style: {
            'font-size': 'clamp(13px, 0.9vw, 18px)',
            color: '$ink-quiet',
            'line-clamp': '1',
            'font-variant-numeric': 'tabular-nums',
          },
          small: { 'font-size': '12px' },
        },
      ],
    },
  ],
};

// A ranked row puts a tall outlined numeral beside each poster.
export const ranked: Node = {
  type: 'box',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-end' },
  children: [
    {
      type: 'text',
      text: '{index.label}',
      style: {
        'font-size': 'clamp(120px, 10vw, 220px)',
        'font-weight': '800',
        'line-height': '0.8',
        'letter-spacing': '-0.06em',
        color: 'rgba(245, 241, 233, 0.2)',
        'text-shadow': '0px 0px 30px rgba(0, 0, 0, 0.5)',
        'margin-right': '-0.1em',
        'padding-bottom': 'clamp(44px, 3.4vw, 70px)',
      },
      small: { 'font-size': '96px' },
    },
    { type: 'use', template: 'poster' },
  ],
};

// In a grid the poster takes its cell's width at every size.
export const gridPoster: Node = {
  ...poster,
  style: { ...poster.style, width: '100%' } as Style,
  small: { ...poster.small, width: '100%' } as Style,
};

export const gridStyle: Style = {
  display: 'grid',
  'grid-template-columns': 'repeat(auto-fill, minmax(176px, 1fr))',
  'column-gap': 'clamp(20px, 1.9vw, 40px)',
  'row-gap': 'clamp(28px, 2.6vw, 52px)',
  ...gutter,
} as Style;

export const gridWide: Style = { 'grid-template-columns': 'repeat(auto-fill, minmax(220px, 1fr))' } as Style;

export const gridSmall: Style = {
  'grid-template-columns': 'repeat(auto-fill, minmax(104px, 1fr))',
  'column-gap': '12px',
  'row-gap': '20px',
  ...gutterSmall,
} as Style;

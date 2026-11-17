import type { Node, Style } from '../../../skin';
import { capsule, capsuleFocus, ease, gutter, gutterSmall, lift, rest, ring, sans, side } from './look';

export const section = (heading: string, when: Node['when'], children: Node[]): Node => ({
  type: 'box',
  when,
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'padding-bottom': 'clamp(10px, 1.2vw, 24px)',
  },
  children: [
    {
      type: 'text',
      text: heading,
      role: 'heading',
      level: 2,
      style: { 'font-size': 'clamp(21px, 1.6vw, 32px)', 'font-weight': '700', 'letter-spacing': '-0.01em', ...gutter },
      small: { 'font-size': '19px', ...gutterSmall },
    },
    ...children,
  ],
});

// A horizontal track with room for a focused item to grow.
export const track = (items: Node, gap = 'clamp(20px, 1.9vw, 40px)'): Node => ({
  type: 'box',
  style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' },
  children: [
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        'align-items': 'flex-start',
        gap,
        'padding-top': 'clamp(22px, 2vw, 40px)',
        'padding-bottom': 'clamp(26px, 2.4vw, 48px)',
        ...gutter,
      },
      small: { gap: '14px', 'padding-top': '16px', 'padding-bottom': '20px', ...gutterSmall },
      children: [items],
    },
  ],
});

// An episode: a 16:9 still, its number and name, and the time left.
export const episode: Node = {
  type: 'box',
  group: true,
  press: { action: 'play', arg: '{card.id}' },
  controlStates: false,
  label: '{episode.playLabel}: {card.label}',
  testId: 'episode-{card.id}',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    width: 'clamp(260px, 21vw, 440px)',
    'flex-shrink': '0',
    gap: 'clamp(12px, 1vw, 20px)',
  },
  small: { width: '240px', gap: '10px' },
  children: [
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
      children: [
        {
          type: 'image',
          when: [{ test: 'card.backdrop' }],
          src: '{card.backdrop}',
          alt: '',
          fade: true,
          style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' },
        },
        {
          type: 'image',
          when: [{ test: 'card.backdrop', not: true }, { test: 'card.poster' }],
          src: '{card.poster}',
          alt: '',
          fade: true,
          style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' },
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            'background-image': 'linear-gradient(0deg, rgba(5, 6, 9, 0.7) 0%, rgba(5, 6, 9, 0) 55%)',
          },
        },
        // A play glyph appears on the focused still.
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            opacity: '0',
            transition: 'opacity 260ms linear',
          },
          groupHover: { opacity: '1' },
          children: [
            {
              type: 'box',
              style: {
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                width: 'clamp(52px, 3.8vw, 76px)',
                height: 'clamp(52px, 3.8vw, 76px)',
                'border-radius': '999px',
                'background-color': 'rgba(245, 241, 233, 0.92)',
                color: '$ground',
              },
              children: [{ type: 'icon', symbol: 'play-fill', style: { width: '40%', height: '40%' } }],
            },
          ],
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
          children: [{ type: 'icon', symbol: 'checkmark', style: { width: '50%', height: '50%' } }],
        },
        {
          type: 'text',
          when: [{ test: 'card.durationLabel' }],
          text: '{card.durationLabel}',
          style: {
            position: 'absolute',
            right: '12px',
            bottom: '14px',
            'font-size': 'clamp(13px, 0.9vw, 18px)',
            'font-weight': '650',
            'font-variant-numeric': 'tabular-nums',
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
        gap: '6px',
        padding: '0px 2px',
        opacity: '0.7',
        translate: '0px 0px',
        transition: `opacity 260ms linear, translate 420ms ${ease}`,
      },
      groupHover: { opacity: '1', translate: '0px 6px' },
      children: [
        {
          type: 'text',
          text: '{episode.numberTitle}',
          style: { 'font-size': 'clamp(15px, 1.1vw, 22px)', 'font-weight': '650', 'line-clamp': '1' },
        },
        {
          type: 'text',
          when: [{ test: 'card.summary' }],
          text: '{card.summary}',
          style: {
            'font-size': 'clamp(13px, 0.9vw, 18px)',
            'line-height': '1.4',
            color: '$ink-quiet',
            'line-clamp': '2',
          },
        },
      ],
    },
  ],
};

// The season picker: capsules, the selected one filled.
export const season: Node = {
  type: 'box',
  press: { action: 'select', arg: '{season.pick}' },
  controlStates: false,
  label: '{card.name}',
  testId: 'season-{card.id}',
  a11y: { selected: [{ test: 'season.on' }] },
  style: {
    ...capsule('clamp(46px, 3.4vw, 64px)'),
    'background-color': 'rgba(255, 255, 255, 0.08)',
    color: '$ink-dim',
    'font-size': 'clamp(15px, 1.15vw, 22px)',
  },
  focus: capsuleFocus,
  active: { scale: '0.97' },
  hover: { 'background-color': 'rgba(255, 255, 255, 0.18)' },
  children: [
    // The chosen season, or the first while none is chosen yet.
    {
      type: 'box',
      when: [{ test: 'season.on' }],
      style: {
        position: 'absolute',
        inset: '0px',
        'border-radius': '999px',
        'background-color': 'rgba(255, 255, 255, 0.2)',
        'box-shadow': 'inset 0px 0px 0px 2px rgba(255, 255, 255, 0.5)',
      },
    },
    {
      type: 'box',
      when: [
        { test: 'detail.selectedSeason', not: true },
        { test: 'index', is: 'eq', value: '0' },
      ],
      style: {
        position: 'absolute',
        inset: '0px',
        'border-radius': '999px',
        'background-color': 'rgba(255, 255, 255, 0.2)',
        'box-shadow': 'inset 0px 0px 0px 2px rgba(255, 255, 255, 0.5)',
      },
    },
    { type: 'text', text: '{card.name}', style: { position: 'relative', 'white-space': 'nowrap' } },
  ],
};

export const person: Node = {
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    gap: '10px',
    width: 'clamp(116px, 8.6vw, 170px)',
    'flex-shrink': '0',
    'text-align': 'center',
  },
  small: { width: '96px' },
  children: [
    {
      type: 'box',
      style: {
        position: 'relative',
        width: '100%',
        'aspect-ratio': '1 / 1',
        'border-radius': '999px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-image': 'linear-gradient(140deg, #2a2f39 0%, #15181e 100%)',
        'box-shadow': rest,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
      },
      children: [
        {
          type: 'text',
          when: [{ test: 'person.portrait', not: true }],
          text: '{person.initials}',
          style: { 'font-size': 'clamp(26px, 2vw, 40px)', 'font-weight': '700', color: '$ink-dim' },
        },
        {
          type: 'image',
          when: [{ test: 'person.portrait' }],
          src: '{person.portrait}',
          alt: '',
          fade: true,
          style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' },
        },
      ],
    },
    {
      type: 'text',
      text: '{person.name}',
      style: { 'font-size': 'clamp(14px, 1vw, 20px)', 'font-weight': '650', 'line-clamp': '2', 'line-height': '1.2' },
    },
    {
      type: 'text',
      when: [{ test: 'person.role' }],
      text: '{person.role}',
      style: { 'font-size': 'clamp(12px, 0.85vw, 17px)', color: '$ink-quiet', 'line-clamp': '1' },
    },
  ],
};

export const extra: Node = {
  type: 'box',
  when: [{ test: 'extra.ready' }],
  press: { action: 'playExtra', arg: '{extra.id}' },
  controlStates: false,
  label: '{s:playExtra}: {extra.name}',
  testId: 'extra-{extra.id}',
  style: {
    ...capsule('clamp(54px, 4vw, 76px)'),
    'justify-content': 'flex-start',
    'max-width': 'clamp(260px, 24vw, 460px)',
  },
  focus: capsuleFocus,
  active: { scale: '0.97' },
  hover: { 'background-color': 'rgba(255, 255, 255, 0.24)' },
  children: [
    {
      type: 'icon',
      symbol: 'play-fill',
      style: { width: 'clamp(16px, 1.1vw, 22px)', height: 'clamp(16px, 1.1vw, 22px)', 'flex-shrink': '0' },
    },
    { type: 'text', text: '{extra.name}', style: { 'line-clamp': '1' } },
  ],
};

export const titleCopy: Node = {
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    'justify-content': 'flex-end',
    'box-sizing': 'border-box',
    'min-height': 'max(560px, 82vh)',
    gap: 'clamp(14px, 1.3vw, 24px)',
    'padding-top': 'clamp(110px, 10vw, 180px)',
    'padding-bottom': 'clamp(20px, 2.6vh, 44px)',
    ...gutter,
  },
  small: { 'min-height': '520px', 'padding-top': '120px', gap: '12px', ...gutterSmall },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{detail.receipt}' } },
    {
      type: 'text',
      text: '{detail.kindLabel}',
      motion: 'copy0',
      style: {
        'font-size': 'clamp(13px, 0.95vw, 18px)',
        'font-weight': '700',
        'letter-spacing': '0.16em',
        'text-transform': 'uppercase',
        color: '$amber',
      },
    },
    {
      type: 'image',
      when: [{ test: 'detail.logo' }],
      src: '{detail.logo}',
      alt: '{detail.name}',
      role: 'heading',
      level: 1,
      motion: 'copy1',
      style: {
        height: 'clamp(120px, 11vw, 210px)',
        width: '80%',
        'max-width': 'min(640px, 80%)',
        'object-fit': 'contain',
        'align-self': 'flex-start',
      },
      small: { height: '92px' },
    },
    {
      type: 'text',
      when: [{ test: 'detail.logo', not: true }],
      text: '{detail.name}',
      role: 'heading',
      level: 1,
      motion: 'copy1',
      style: {
        'font-size': 'clamp(52px, 5.4vw, 112px)',
        'font-weight': '800',
        'letter-spacing': '-0.025em',
        'line-height': '0.96',
        'max-width': 'min(60rem, 70vw)',
        'text-shadow': '0px 6px 50px rgba(0, 0, 0, 0.55)',
      },
      small: { 'font-size': '40px', 'max-width': 'none' },
    },
    { type: 'use', template: 'velaEpisodeContext' },
    {
      type: 'text',
      text: '{detail.factsLine}',
      motion: 'copy2',
      style: {
        'font-size': 'clamp(16px, 1.25vw, 24px)',
        'font-weight': '600',
        color: '$ink-dim',
        'font-variant-numeric': 'tabular-nums',
      },
      small: { 'font-size': '14px' },
    },
    {
      type: 'text',
      when: [{ test: 'detail.summary' }],
      text: '{detail.summary}',
      motion: 'copy2',
      style: {
        'font-size': 'clamp(17px, 1.3vw, 25px)',
        'line-height': '1.45',
        color: '$ink-dim',
        'line-clamp': '4',
        'max-width': '46rem',
        'text-shadow': '0px 1px 16px rgba(0, 0, 0, 0.7)',
      },
      small: { 'font-size': '15px' },
    },
    {
      type: 'text',
      when: [{ test: 'detail.crewLine' }],
      text: '{detail.crewLine}',
      motion: 'copy2',
      style: { 'font-size': 'clamp(14px, 1vw, 19px)', color: '$ink-quiet', 'max-width': '46rem', 'line-clamp': '2' },
    },
    {
      type: 'box',
      motion: 'copy3',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        'flex-wrap': 'wrap',
        gap: 'clamp(14px, 1.2vw, 24px)',
        'align-items': 'center',
        'margin-top': 'clamp(8px, 1vw, 18px)',
      } as Style,
      children: [
        {
          type: 'box',
          when: [{ test: 'detail.canPlay' }],
          press: { action: 'play', arg: '{detail.id}' },
          controlStates: false,
          label: '{detail.playLabel}',
          testId: 'detail-play',
          style: {
            ...capsule('clamp(58px, 4.4vw, 84px)'),
            'background-color': 'rgba(245, 241, 233, 0.92)',
            color: '$ground',
          },
          focus: capsuleFocus,
          active: { scale: '0.97' },
          hover: { 'background-color': '$ink' },
          small: { height: '54px' },
          children: [
            {
              type: 'icon',
              symbol: 'play-fill',
              style: { width: 'clamp(18px, 1.3vw, 26px)', height: 'clamp(18px, 1.3vw, 26px)' },
            },
            { type: 'text', text: '{detail.playLabel}', style: { 'font-weight': '700' } },
            {
              type: 'box',
              when: [{ test: 'detail.hasResume' }],
              style: {
                width: 'clamp(48px, 4vw, 76px)',
                height: '5px',
                'border-radius': '3px',
                'background-color': 'rgba(9, 11, 14, 0.22)',
                'overflow-x': 'hidden',
                'overflow-y': 'hidden',
              },
              children: [
                { type: 'box', style: { height: '5px', width: '{detail.resumePct}%', 'background-color': '$ground' } },
              ],
            },
          ],
        },
        {
          type: 'repeat',
          over: 'detail.upNext',
          when: [{ test: 'detail.canPlay', not: true }],
          item: {
            type: 'box',
            press: { action: 'play', arg: '{card.id}' },
            controlStates: false,
            label: '{episode.playLabel}: {card.label}',
            testId: 'detail-up-next',
            style: {
              ...capsule('clamp(58px, 4.4vw, 84px)'),
              'background-color': 'rgba(245, 241, 233, 0.92)',
              color: '$ground',
              'max-width': 'min(640px, 80vw)',
            },
            focus: capsuleFocus,
            active: { scale: '0.97' },
            hover: { 'background-color': '$ink' },
            small: { height: '54px' },
            children: [
              {
                type: 'icon',
                symbol: 'play-fill',
                style: { width: 'clamp(18px, 1.3vw, 26px)', height: 'clamp(18px, 1.3vw, 26px)', 'flex-shrink': '0' },
              },
              {
                type: 'box',
                style: {
                  display: 'flex',
                  'flex-direction': 'column',
                  gap: '3px',
                  'align-items': 'flex-start',
                  'min-width': '0px',
                },
                children: [
                  {
                    type: 'text',
                    text: '{episode.numberTitle}',
                    style: { 'line-height': '1.05', 'font-weight': '700', 'line-clamp': '1' },
                  },
                  {
                    type: 'text',
                    text: '{episode.upNextLabel}',
                    style: { 'font-size': '0.62em', 'font-weight': '600', opacity: '0.62', 'line-height': '1' },
                  },
                ],
              },
              {
                type: 'box',
                when: [{ test: 'card.hasProgress' }],
                small: { display: 'none' },
                style: {
                  width: 'clamp(48px, 4vw, 76px)',
                  height: '5px',
                  'flex-shrink': '0',
                  'border-radius': '3px',
                  'background-color': 'rgba(9, 11, 14, 0.22)',
                  'overflow-x': 'hidden',
                  'overflow-y': 'hidden',
                },
                children: [
                  {
                    type: 'box',
                    style: { height: '5px', width: '{card.progressPct}%', 'background-color': '$ground' },
                  },
                ],
              },
            ],
          },
        },

      ],
    },
    {
      type: 'box',
      when: [{ test: 'detail.hasMediaFacts' }],
      style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '10px' } as Style,
      children: [
        {
          type: 'repeat',
          over: 'detail.mediaFacts',
          item: {
            type: 'text',
            text: '{fact.text}',
            style: {
              padding: '6px 12px',
              'border-radius': '8px',
              'font-size': 'clamp(12px, 0.85vw, 16px)',
              'font-weight': '700',
              'letter-spacing': '0.04em',
              color: '$ink-dim',
              'box-shadow': 'inset 0px 0px 0px 1.5px rgba(245, 241, 233, 0.35)',
            },
          },
        },
      ],
    },
  ],
};

export const title: Node = {
  type: 'box',
  style: {
    position: 'absolute',
    inset: '0px',
    width: '100%',
    height: '100%',
    display: 'flex',
    'flex-direction': 'column',
    'background-color': '$ground',
    color: '$ink',
    'font-family': sans,
  },
  children: [
        {
          type: 'box',
          press: { action: 'back' },
          controlStates: false,
          label: '{s:back}',
          testId: 'detail-back',
          style: { ...capsule('clamp(58px, 4.4vw, 84px)'), position: 'absolute', top: '24px', right: 'max(24px, 4vw)', 'z-index': '30' },
          focus: capsuleFocus,
          active: { scale: '0.97' },
          hover: { 'background-color': 'rgba(255, 255, 255, 0.24)' },
          small: { height: '54px' },
          children: [
            {
              type: 'icon',
              symbol: 'back',
              style: { width: 'clamp(16px, 1.2vw, 24px)', height: 'clamp(16px, 1.2vw, 24px)' },
            },
            { type: 'text', text: '{s:back}' },
          ],
        },
    // The title's backdrop fills the screen and stays while the page scrolls over it.
    {
      type: 'box',
      when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
      motion: 'backdropIn',
      style: {
        position: 'absolute',
        inset: '0px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'pointer-events': 'none',
      },
      children: [
        {
          type: 'image',
          when: [{ test: 'detail.backdrop' }],
          src: '{detail.backdrop}',
          alt: '',
          fade: true,
          style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' },
        },
        {
          type: 'image',
          when: [{ test: 'detail.backdrop', not: true }, { test: 'detail.poster' }],
          src: '{detail.poster}',
          alt: '',
          style: {
            position: 'absolute',
            top: '-20%',
            left: '-20%',
            width: '140%',
            height: '140%',
            'object-fit': 'cover',
            filter: 'blur(80px) saturate(1.5)',
            opacity: '0.6',
          },
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            'background-image': [
              'linear-gradient(90deg, rgba(5, 6, 9, 0.9) 0%, rgba(5, 6, 9, 0.6) 34%, rgba(5, 6, 9, 0) 66%)',
              'linear-gradient(0deg, rgba(5, 6, 9, 0.97) 0%, rgba(5, 6, 9, 0.7) 32%, rgba(5, 6, 9, 0) 64%)',
            ].join(', '),
          },
        },
      ],
    },
    {
      type: 'box',
      id: '{env.route}-scroll-{env.entry}',
      role: 'region',
      label: '{detail.name}',
      style: {
        position: 'relative',
        flex: '1',
        'min-height': '0px',
        'overflow-y': 'auto',
        'overflow-x': 'hidden',
        'padding-bottom': 'max(48px, 6vh)',
      },
      children: [
        {
          type: 'text',
          when: [{ test: 'env.load', is: 'eq', value: 'loading' }],
          text: '{s:opening}',
          role: 'status',
          motion: 'fadeIn',
          style: {
            padding: `clamp(140px, 14vw, 240px) ${side}`,
            'font-size': 'clamp(18px, 1.4vw, 28px)',
            color: '$ink-quiet',
          },
        },
        {
          type: 'box',
          when: [{ test: 'env.load', is: 'eq', value: 'failed' }],
          role: 'alert',
          style: {
            display: 'flex',
            'flex-direction': 'column',
            'align-items': 'flex-start',
            gap: '28px',
            padding: `clamp(140px, 14vw, 240px) ${side}`,
          },
          children: [
            {
              type: 'text',
              text: '{s:failed}',
              style: { 'font-size': 'clamp(22px, 1.8vw, 36px)', 'font-weight': '700' },
            },
            {
              type: 'box',
              press: { action: 'back' },
              controlStates: false,
              label: '{s:back}',
              style: capsule('clamp(58px, 4.4vw, 84px)'),
              focus: capsuleFocus,
              active: { scale: '0.97' },
              children: [
                { type: 'icon', symbol: 'back', style: { width: '22px', height: '22px' } },
                { type: 'text', text: '{s:back}' },
              ],
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
          style: { display: 'flex', 'flex-direction': 'column' },
          children: [
            titleCopy,
            section(
              '{s:episodes}',
              [{ test: 'detail.hasEpisodes' }],
              [
                {
                  type: 'box',
                  when: [{ test: 'detail.hasSeasons' }],
                  style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' },
                  children: [
                    {
                      type: 'box',
                      role: 'group',
                      label: '{s:seasons}',
                      style: {
                        display: 'flex',
                        'flex-direction': 'row',
                        gap: '12px',
                        'padding-top': 'clamp(14px, 1.2vw, 24px)',
                        'padding-bottom': '4px',
                        ...gutter,
                      },
                      small: { ...gutterSmall },
                      children: [{ type: 'repeat', over: 'detail.seasons', item: season }],
                    },
                  ],
                },
                track({
                  type: 'repeat',
                  over: 'detail.episodes',
                  item: { ...episode, motion: 'cardIn', stagger: { step: 40, cap: 8 } },
                }),
              ],
            ),
            section(
              '{s:extras}',
              [{ test: 'detail.hasExtras' }],
              [track({ type: 'repeat', over: 'detail.extras', item: extra }, 'clamp(14px, 1.2vw, 24px)')],
            ),
            section(
              '{s:cast}',
              [{ test: 'detail.hasCast' }],
              [track({ type: 'repeat', over: 'detail.cast', item: person }, 'clamp(18px, 1.6vw, 32px)')],
            ),
            { type: 'repeat', over: 'detail.related', item: { type: 'use', template: 'relatedRow' } },
          ],
        },
      ],
    },
  ],
};

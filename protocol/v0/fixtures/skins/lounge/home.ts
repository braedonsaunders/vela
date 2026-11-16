import type { Node, Style } from '../../../skin';
import { capsule, capsuleFocus, gutter, gutterSmall, lift, ring, sans } from './look';
import { bone, boneRow } from './skeletons';

// The backdrop: full-screen, pinned behind everything while the rows scroll over it. It
// leaves while a query is open (it would cover the results that follow the home).
// Each featured title mounts its own layer, which dissolves in over the last.
export const backdrop: Node = {
  type: 'box',
  when: [{ test: 'env.searching', not: true }],
  style: {
    position: 'sticky',
    top: '0px',
    height: '100vh',
    'margin-bottom': '-100vh',
    'z-index': '0',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    'pointer-events': 'none',
    'background-color': '$ground',
  },
  children: [
    {
      type: 'repeat',
      over: 'home.hero',
      item: {
        type: 'box',
        motion: 'backdropIn',
        style: { position: 'absolute', inset: '0px' },
        children: [
          {
            type: 'box',
            when: [{ test: 'hero.backdrop' }],
            motion: 'drift',
            style: { position: 'absolute', inset: '0px', 'transform-origin': '70% 30%' },
            children: [
              {
                type: 'image',
                src: '{hero.backdrop}',
                alt: '',
                fade: true,
                style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' },
              },
            ],
          },
          {
            type: 'image',
            when: [{ test: 'hero.backdrop', not: true }, { test: 'hero.poster' }],
            src: '{hero.poster}',
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
          // The title's own colour glows up from the floor where the backdrop has one.
          {
            type: 'box',
            when: [{ test: 'hero.accent' }],
            style: {
              position: 'absolute',
              left: '-10%',
              right: '-10%',
              bottom: '-30%',
              height: '70%',
              'background-color': '{hero.accent}',
              opacity: '0.28',
              'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)',
            },
          },
        ],
      },
    },
    // Shade: the copy's side, the floor the rows sit on, and a vignette.
    {
      type: 'box',
      style: {
        position: 'absolute',
        inset: '0px',
        'background-image': [
          'linear-gradient(90deg, rgba(5, 6, 9, 0.88) 0%, rgba(5, 6, 9, 0.55) 30%, rgba(5, 6, 9, 0) 62%)',
          'linear-gradient(0deg, rgba(5, 6, 9, 0.96) 0%, rgba(5, 6, 9, 0.72) 30%, rgba(5, 6, 9, 0) 62%)',
          'radial-gradient(ellipse 120% 90% at 65% 30%, rgba(5, 6, 9, 0) 55%, rgba(5, 6, 9, 0.6) 100%)',
        ].join(', '),
      },
    },
  ],
};

export const heroPlay: Node = {
  type: 'box',
  press: { action: 'play', arg: '{hero.id}' },
  controlStates: false,
  label: '{heroAct.actionLabel}',
  testId: 'hero-primary',
  when: [{ test: 'heroAct.playable' }],
  style: { ...capsule('clamp(58px, 4.4vw, 84px)'), 'background-color': 'rgba(245, 241, 233, 0.92)', color: '$ground' },
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
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '3px', 'align-items': 'flex-start' },
      children: [
        { type: 'text', text: '{heroAct.actionLabel}', style: { 'line-height': '1.05', 'font-weight': '700' } },
        {
          type: 'text',
          when: [{ test: 'heroAct.actionDetail' }],
          text: '{heroAct.actionDetail}',
          style: { 'font-size': '0.62em', 'font-weight': '600', opacity: '0.62', 'line-height': '1' },
        },
      ],
    },
    {
      type: 'box',
      when: [{ test: 'heroAct.hasProgress' }],
      small: { display: 'none' },
      style: {
        width: 'clamp(48px, 4vw, 76px)',
        height: '5px',
        'border-radius': '3px',
        'background-color': 'rgba(9, 11, 14, 0.22)',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
      },
      children: [
        { type: 'box', style: { height: '5px', width: '{heroAct.progressPct}%', 'background-color': '$ground' } },
      ],
    },
  ],
};

export const heroMore = (primary: boolean): Node => ({
  type: 'box',
  press: { action: 'select', arg: '{hero.kindId}' },
  controlStates: false,
  label: '{s:moreInfo}',
  testId: 'hero-more',
  when: [{ test: 'heroAct.playable', not: primary }],
  style: capsule('clamp(58px, 4.4vw, 84px)'),
  focus: capsuleFocus,
  active: { scale: '0.97' },
  hover: { 'background-color': 'rgba(255, 255, 255, 0.24)' },
  small: { height: '54px' },
  children: [
    { type: 'icon', symbol: 'info', style: { width: 'clamp(18px, 1.3vw, 26px)', height: 'clamp(18px, 1.3vw, 26px)' } },
    { type: 'text', text: '{s:moreInfo}' },
  ],
});

// The top shelf: the featured title's name, facts and two large actions, low on the screen.
export const shelf: Node = {
  type: 'box',
  when: [{ test: 'env.searching', not: true }],
  style: {
    position: 'relative',
    'z-index': '1',
    display: 'flex',
    'flex-direction': 'column',
    'justify-content': 'flex-end',
    'box-sizing': 'border-box',
    'min-height': 'max(500px, 64vh)',
    'padding-top': 'clamp(110px, 10vw, 180px)',
    'padding-bottom': 'clamp(18px, 2.4vh, 40px)',
    ...gutter,
  },
  small: { 'min-height': '470px', 'padding-top': '92px', ...gutterSmall },
  children: [
    {
      type: 'repeat',
      over: 'home.hero',
      item: {
        type: 'box',
        style: {
          display: 'flex',
          'flex-direction': 'column',
          gap: 'clamp(14px, 1.3vw, 24px)',
          'max-width': 'min(54rem, 58vw)',
        },
        small: { 'max-width': 'none', gap: '12px' },
        children: [
          { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
          {
            type: 'text',
            text: '{heroAct.reasonLabel}',
            motion: 'copy0',
            style: {
              'font-size': 'clamp(13px, 0.95vw, 18px)',
              'font-weight': '700',
              'letter-spacing': '0.16em',
              'text-transform': 'uppercase',
              color: '$amber',
              'text-shadow': '0px 1px 16px rgba(0, 0, 0, 0.6)',
            },
          },
          {
            type: 'image',
            when: [{ test: 'hero.logo' }],
            src: '{hero.logo}',
            alt: '{hero.name}',
            role: 'heading',
            level: 1,
            motion: 'copy1',
            style: {
              height: 'clamp(120px, 11vw, 210px)',
              width: 'auto',
              'max-width': 'min(640px, 80%)',
              'object-fit': 'contain',
              'align-self': 'flex-start',
            } as Style,
            small: { height: '92px' },
          },
          {
            type: 'text',
            when: [{ test: 'hero.logo', not: true }],
            text: '{hero.name}',
            role: 'heading',
            level: 1,
            motion: 'copy1',
            style: {
              'font-size': 'clamp(52px, 5.4vw, 112px)',
              'font-weight': '800',
              'letter-spacing': '-0.025em',
              'line-height': '0.96',
              'line-clamp': '2',
              'text-shadow': '0px 6px 50px rgba(0, 0, 0, 0.55)',
            },
            small: { 'font-size': '42px' },
          },
          {
            type: 'text',
            text: '{hero.factsLine}',
            motion: 'copy2',
            style: {
              'font-size': 'clamp(16px, 1.25vw, 24px)',
              'font-weight': '600',
              color: '$ink-dim',
              'font-variant-numeric': 'tabular-nums',
              'text-shadow': '0px 1px 14px rgba(0, 0, 0, 0.6)',
            },
            small: { 'font-size': '14px' },
          },
          {
            type: 'text',
            when: [{ test: 'hero.summary' }],
            text: '{hero.summary}',
            motion: 'copy2',
            style: {
              'font-size': 'clamp(17px, 1.3vw, 25px)',
              'line-height': '1.45',
              color: '$ink-dim',
              'line-clamp': '3',
              'max-width': '44rem',
              'text-shadow': '0px 1px 16px rgba(0, 0, 0, 0.7)',
            },
            small: { 'font-size': '15px', 'line-clamp': '2' },
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
            children: [heroPlay, heroMore(false), heroMore(true)],
          },
        ],
      },
    },
    // Featured titles: one large focusable dot each, the current one long and filling.
    {
      type: 'box',
      role: 'group',
      label: '{s:featured}',
      when: [{ test: 'env.heroCount', is: 'gt', value: '1' }],
      motion: 'copy3',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '6px',
        'align-items': 'center',
        'margin-top': 'clamp(14px, 1.6vw, 30px)',
        'margin-left': '-8px',
      } as Style,
      children: [
        {
          type: 'repeat',
          over: 'home.heroes',
          item: {
            type: 'box',
            press: { action: 'pickHero', arg: '{index}' },
            controlStates: false,
            label: '{hero.name}',
            a11y: { current: [{ test: 'index.current' }] },
            style: {
              position: 'relative',
              display: 'flex',
              'align-items': 'center',
              padding: '10px 8px',
              'border-radius': '999px',
              transition: lift,
            },
            focus: { 'background-color': 'rgba(255, 255, 255, 0.16)', scale: '1.15' },
            children: [
              {
                type: 'box',
                when: [{ test: 'index.current' }],
                style: {
                  position: 'relative',
                  width: 'clamp(36px, 2.6vw, 52px)',
                  height: 'clamp(7px, 0.5vw, 10px)',
                  'border-radius': '999px',
                  'background-color': 'rgba(255, 255, 255, 0.28)',
                  'overflow-x': 'hidden',
                  'overflow-y': 'hidden',
                },
                children: [
                  {
                    type: 'box',
                    when: [{ test: 'env.rotating' }],
                    motion: 'heroFill',
                    style: { position: 'absolute', inset: '0px', 'background-color': '$ink' },
                  },
                  {
                    type: 'box',
                    when: [{ test: 'env.rotating', not: true }],
                    style: { position: 'absolute', inset: '0px', 'background-color': '$ink' },
                  },
                ],
              },
              {
                type: 'box',
                when: [{ test: 'index.current', not: true }],
                style: {
                  width: 'clamp(7px, 0.5vw, 10px)',
                  height: 'clamp(7px, 0.5vw, 10px)',
                  'border-radius': '999px',
                  'background-color': 'rgba(255, 255, 255, 0.34)',
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

export const loading: Node = {
  type: 'box',
  when: [{ test: 'env.load', is: 'eq', value: 'loading' }],
  role: 'status',
  label: '{s:loadingHome}',
  style: { display: 'flex', 'flex-direction': 'column', 'min-height': '100vh', 'overflow-y': 'hidden' },
  children: [
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'column',
        'justify-content': 'flex-end',
        gap: 'clamp(16px, 1.4vw, 26px)',
        'box-sizing': 'border-box',
        'min-height': 'max(500px, 64vh)',
        'padding-bottom': 'clamp(40px, 4vw, 80px)',
        ...gutter,
      },
      small: { 'min-height': '470px', ...gutterSmall },
      children: [
        bone({ width: 'clamp(120px, 9vw, 180px)', height: 'clamp(12px, 0.9vw, 18px)' } as Style),
        bone({ width: 'min(640px, 70vw)', height: 'clamp(52px, 5vw, 100px)', 'border-radius': '20px' } as Style),
        bone({ width: 'min(420px, 60vw)', height: 'clamp(16px, 1.25vw, 24px)' } as Style),
        {
          type: 'box',
          style: {
            display: 'flex',
            'flex-direction': 'row',
            gap: 'clamp(14px, 1.2vw, 24px)',
            'margin-top': 'clamp(8px, 1vw, 18px)',
          } as Style,
          children: [
            bone({ width: 'clamp(160px, 12vw, 240px)', height: 'clamp(58px, 4.4vw, 84px)' } as Style),
            bone({ width: 'clamp(140px, 10vw, 200px)', height: 'clamp(58px, 4.4vw, 84px)' } as Style),
          ],
        },
      ],
    },
    boneRow,
    boneRow,
  ],
};

export const failed: Node = {
  type: 'box',
  when: [{ test: 'env.load', is: 'eq', value: 'failed' }],
  role: 'alert',
  motion: 'fadeIn',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'flex-start',
    'justify-content': 'center',
    gap: 'clamp(18px, 1.6vw, 30px)',
    'box-sizing': 'border-box',
    'min-height': '100vh',
    ...gutter,
  },
  small: { ...gutterSmall },
  children: [
    {
      type: 'image',
      src: 'assets/brand/vela-symbol.svg',
      alt: '',
      style: { width: 'clamp(44px, 3.4vw, 64px)', height: 'clamp(44px, 3.4vw, 64px)', opacity: '0.9' },
    },
    {
      type: 'text',
      text: '{s:homeFailed}',
      role: 'heading',
      level: 1,
      style: {
        'font-size': 'clamp(32px, 3vw, 60px)',
        'font-weight': '800',
        'letter-spacing': '-0.02em',
        'line-height': '1.05',
        'max-width': '22ch',
      },
    },
    {
      type: 'text',
      text: '{s:homeFailedDetail}',
      style: {
        'font-size': 'clamp(17px, 1.3vw, 25px)',
        'line-height': '1.45',
        color: '$ink-dim',
        'max-width': '40rem',
      },
    },
    {
      type: 'box',
      when: [{ test: 'env.canRetry' }],
      press: { action: 'retry' },
      controlStates: false,
      label: '{s:tryAgain}',
      testId: 'home-retry',
      style: {
        ...capsule('clamp(58px, 4.4vw, 84px)'),
        'background-color': 'rgba(245, 241, 233, 0.92)',
        color: '$ground',
        'margin-top': 'clamp(6px, 0.8vw, 14px)',
      } as Style,
      focus: capsuleFocus,
      active: { scale: '0.97' },
      hover: { 'background-color': '$ink' },
      children: [{ type: 'text', text: '{s:tryAgain}', style: { 'font-weight': '700' } }],
    },
  ],
};

// No minimum height: while a query is open the home is only its search bar, and the results
// follow right under it.
export const home: Node = {
  type: 'box',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', color: '$ink', 'font-family': sans },
  children: [
    loading,
    failed,
    backdrop,
    shelf,
    // Search: a wide field between the shelf and the rows; it rises to the top while a query is open.
    // Search: Lounge's own ten-foot bar between the shelf and the rows; with a query open the
    // shelf and rows give way and it rises under the top bar.
    {
      type: 'box',
      when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
      style: {
        position: 'relative',
        'z-index': '1',
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'padding-bottom': 'clamp(4px, 0.6vw, 12px)',
        ...gutter,
      } as Style,
      small: { ...gutterSmall, 'padding-top': '8px' } as Style,
      states: [
        {
          when: [{ test: 'env.searching' }],
          style: {
            position: 'relative',
            'z-index': '1',
            display: 'flex',
            'flex-direction': 'column',
            'align-items': 'center',
            'padding-top': 'clamp(120px, 10.5vw, 200px)',
            'padding-bottom': 'clamp(10px, 1vw, 20px)',
            ...gutter,
          } as Style,
        },
      ],
      children: [
        {
          type: 'box',
          role: 'search',
          style: {
            position: 'relative',
            display: 'flex',
            'flex-direction': 'row',
            'align-items': 'center',
            gap: 'clamp(14px, 1.1vw, 22px)',
            width: '100%',
            'max-width': '1100px',
            'box-sizing': 'border-box',
            height: 'clamp(60px, 4.6vw, 88px)',
            padding: '0px clamp(10px, 0.8vw, 14px) 0px clamp(22px, 1.7vw, 32px)',
            'border-radius': '999px',
            'background-color': 'rgba(18, 20, 26, 0.62)',
            'backdrop-filter': 'blur(30px) saturate(1.4)',
            'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.12), 0px 20px 50px -20px rgba(0, 0, 0, 0.8)',
            transition: lift,
          },
          small: { height: '54px' },
          states: [
            {
              when: [{ test: 'env.searchFocused' }],
              style: {
                position: 'relative',
                display: 'flex',
                'flex-direction': 'row',
                'align-items': 'center',
                gap: 'clamp(14px, 1.1vw, 22px)',
                width: '100%',
                'max-width': '1100px',
                'box-sizing': 'border-box',
                height: 'clamp(60px, 4.6vw, 88px)',
                padding: '0px clamp(10px, 0.8vw, 14px) 0px clamp(22px, 1.7vw, 32px)',
                'border-radius': '999px',
                'background-color': 'rgba(30, 33, 41, 0.86)',
                'backdrop-filter': 'blur(30px) saturate(1.4)',
                'box-shadow': ring,
                transition: lift,
              },
            },
          ],
          children: [
            {
              type: 'icon',
              symbol: 'search',
              style: {
                width: 'clamp(20px, 1.5vw, 30px)',
                height: 'clamp(20px, 1.5vw, 30px)',
                'flex-shrink': '0',
                color: '$ink-dim',
              },
            },
            {
              type: 'widget',
              widget: 'searchInput',
              params: {
                placeholder: '{s:searchPlaceholder}',
                label: '{s:search}',
                placeholderColor: 'rgba(245, 241, 233, 0.5)',
              },
              style: {
                flex: '1',
                'min-width': '0px',
                outline: 'none',
                color: '$ink',
                'font-size': 'clamp(19px, 1.45vw, 30px)',
                'font-weight': '550',
              },
              small: { 'font-size': '17px' },
            },
            {
              type: 'box',
              when: [{ test: 'env.searching' }],
              press: { action: 'clearSearch', focus: 'vela-search' },
              controlStates: false,
              label: '{s:clear}',
              testId: 'search-clear',
              style: {
                ...capsule('clamp(42px, 3.2vw, 62px)'),
                'background-color': 'rgba(255, 255, 255, 0.12)',
                'font-size': 'clamp(15px, 1.1vw, 21px)',
              },
              focus: capsuleFocus,
              active: { scale: '0.97' },
              hover: { 'background-color': 'rgba(255, 255, 255, 0.22)' },
              children: [
                {
                  type: 'icon',
                  symbol: 'close',
                  style: { width: 'clamp(14px, 1vw, 20px)', height: 'clamp(14px, 1vw, 20px)' },
                },
                { type: 'text', text: '{s:clear}', small: { display: 'none' } },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'box',
      when: [{ test: 'env.searching', not: true }],
      style: {
        position: 'relative',
        'z-index': '1',
        display: 'flex',
        'flex-direction': 'column',
        'padding-bottom': 'max(48px, 6vh)',
      },
      children: [
        {
          type: 'repeat',
          over: 'home.rows',
          item: { type: 'use', template: 'row', motion: 'rowIn', stagger: { step: 80, cap: 4 } },
        },
        {
          type: 'box',
          when: [{ test: 'env.homeHasMore' }],
          style: { position: 'relative', height: '2px' },
          children: [{ type: 'widget', widget: 'sentinel', params: { on: 'home' } }],
        },
        {
          type: 'text',
          when: [{ test: 'env.homeMoreLoading' }],
          text: '{s:loadingMore}',
          role: 'status',
          motion: 'pulse',
          style: { 'font-size': 'clamp(15px, 1.1vw, 21px)', color: '$ink-quiet', ...gutter, 'padding-top': '12px' },
        },
      ],
    },
  ],
};

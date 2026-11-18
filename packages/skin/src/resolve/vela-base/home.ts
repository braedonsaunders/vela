import type { Condition, Node, Style } from '../../../../protocol/skin';
import {
  bone,
  display,
  enter,
  failure,
  focusRing,
  gutter,
  gutterSmall,
  is,
  pill,
  ready,
  rowSkeleton,
  small,
  veil,
} from './look';

const previewVeil = (opacity: string): Style => ({
  position: 'absolute',
  inset: '0px',
  'background-image': `linear-gradient(90deg, ${veil(94)} 0%, ${veil(85)} 34%, ${veil(55)} 52%, ${veil(0)} 78%)`,
  opacity,
  transition: 'opacity 900ms cubic-bezier(0.16, 1, 0.3, 1)',
});

// The artwork stage behind the hero and the first rows.
export const stage: Node = {
  type: 'repeat',
  over: 'home.hero',
  item: {
    type: 'box',
    motion: 'velaExpose',
    style: {
      position: 'absolute',
      top: '0px',
      left: '0px',
      right: '0px',
      height: 'max(680px, 92vh)',
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
      'pointer-events': 'none',
      'mask-image': 'linear-gradient(180deg, black 0%, black 70%, transparent 100%)',
    },
    small: { height: '640px' },
    children: [
      {
        type: 'box',
        when: [{ test: 'env.searching', not: true }],
        style: { position: 'absolute', inset: '0px' },
        children: [
          { type: 'widget', widget: 'heroArtwork', style: { position: 'absolute', inset: '0px' } },

        ],
      },
      {
        type: 'image',
        when: [{ test: 'env.searching' }, { test: 'hero.backdrop' }],
        src: '{hero.backdrop}',
        alt: '',
        style: {
          position: 'absolute',
          top: '-12%',
          left: '-12%',
          width: '124%',
          height: '124%',
          'object-fit': 'cover',
          filter: 'blur(70px) saturate(1.5)',
          opacity: '0.5',
        },
      },
      {
        type: 'box',
        style: {
          position: 'absolute',
          left: '-10%',
          bottom: '8%',
          width: '75%',
          height: '70%',
          'background-color': '{hero.accent}',
          opacity: '0.2',
          'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)',
        },
        when: [{ test: 'hero.accent' }],
      },
      {
        type: 'box',
        style: {
          position: 'absolute',
          left: '-10%',
          bottom: '8%',
          width: '75%',
          height: '70%',
          'background-color': '$ui.accent',
          opacity: '0.2',
          'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)',
        },
        when: [{ test: 'hero.accent', not: true }],
      },
      // While the trailer plays, a deeper veil keeps the hero's copy readable over moving pictures.
      {
        type: 'box',
        style: previewVeil('0'),
        states: [{ when: [{ test: 'hero.previewing' }], style: previewVeil('1') }],
      },
      {
        type: 'box',
        style: {
          position: 'absolute',
          inset: '0px',
          'background-image': [
            `linear-gradient(90deg, ${veil(94)} 0%, ${veil(44)} 32%, ${veil(0)} 68%)`,
            `linear-gradient(0deg, $ui.page 0%, ${veil(85)} 22%, ${veil(0)} 58%)`,
            `linear-gradient(180deg, ${veil(70)} 0%, ${veil(0)} 20%)`,
            `radial-gradient(ellipse 120% 100% at 60% 35%, ${veil(0)} 50%, ${veil(70)} 100%)`,
          ].join(', '),
        },
      },
      {
        type: 'image',
        src: 'assets/grain.svg',
        alt: '',
        style: {
          position: 'absolute',
          inset: '0px',
          width: '100%',
          height: '100%',
          'object-fit': 'fill',
          opacity: '0.05',
        },
      },
    ],
  },
};

// The first featured title's primary pill carries a warm halo.
export const firstHeroHalo = (base: Style) => [
  {
    when: [{ test: 'env.heroIndex', is: 'eq', value: '0' }] as Condition[],
    style: { ...base, 'box-shadow': '0px 14px 44px $ui.focusHalo, 0px 0px 0px 1px $ui.glassEdgeStrong' },
  },
];
export const heroPrimary: Node = {
  type: 'box',
  press: { action: 'play', arg: '{hero.id}' },
  label: '{heroAct.actionLabel}',
  testId: 'hero-primary',
  when: [{ test: 'heroAct.playable' }],
  style: { ...pill(true), position: 'relative' },
  states: firstHeroHalo({ ...pill(true), position: 'relative' }),
  small: { height: '50px', 'padding-left': '22px', 'padding-right': '26px' },
  hover: { 'background-color': '$ui.inkHover' },
  focus: { 'box-shadow': focusRing },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center' },
      children: [
        { type: 'icon', symbol: 'play-fill', style: { width: '18px', height: '18px' } },
        {
          type: 'box',
          style: { display: 'flex', 'flex-direction': 'column', gap: '3px', 'align-items': 'flex-start' },
          children: [
            {
              type: 'text',
              text: '{heroAct.actionLabel}',
              style: { 'font-size': '16px', 'font-weight': '700', 'line-height': '1.1' },
            },
            {
              type: 'text',
              when: [{ test: 'heroAct.actionDetail' }],
              text: '{heroAct.actionDetail}',
              style: { 'font-size': '11px', 'font-weight': '600', opacity: '0.62', 'line-height': '1' },
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'heroAct.hasProgress' }],
          style: {
            width: '44px',
            height: '3px',
            'border-radius': '2px',
            'background-color': 'color-mix(in srgb, $ui.inkInverse 20%, transparent)',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
          },
          children: [
            {
              type: 'box',
              style: { height: '3px', width: '{heroAct.progressPct}%', 'background-color': '$ui.inkInverse' },
            },
          ],
        },
      ],
    },
  ],
};
export const morePill = (primary: boolean): Style => ({
  ...pill(primary),
  position: 'relative',
  ...(primary ? { 'padding-right': '30px' } : {}),
});
export const heroMore = (primary: boolean): Node => ({
  type: 'box',
  press: { action: 'select', arg: '{hero.kindId}' },
  label: '{t:hero.moreInfo}',
  testId: 'hero-more',
  when: [{ test: 'heroAct.playable', not: primary }],
  style: morePill(primary),
  states: primary ? firstHeroHalo(morePill(true)) : undefined,
  small: primary
    ? { height: '50px', 'padding-left': '22px', 'padding-right': '24px' }
    : { height: '52px', 'padding-left': '20px', 'padding-right': '22px' },
  hover: primary
    ? { 'background-color': '$ui.inkHover' }
    : { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
  focus: { 'box-shadow': focusRing },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
      children: [
        { type: 'icon', symbol: 'info', style: { width: '17px', height: '17px' } },
        { type: 'text', text: '{t:hero.moreInfo}', style: { 'font-size': '15px' } },
      ],
    },
  ],
});

export const heroCopy: Node = {
  type: 'repeat',
  over: 'home.hero',
  when: [{ test: 'env.searching', not: true }],
  item: {
    type: 'box',
    style: { display: 'flex', 'flex-direction': 'column', ...gutter, gap: '16px', 'max-width': '46rem' },
    small: { ...gutterSmall, gap: '12px', 'max-width': 'none' },
    children: [
      { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
      {
        type: 'box',
        motion: enter(220),
        style: {
          display: 'flex',
          'flex-direction': 'row',
          gap: '8px',
          'align-items': 'center',
          'align-self': 'flex-start',
          padding: '6px 12px 6px 10px',
          'border-radius': '$ui.radiusControl',
          'background-color': '$ui.glass',
          'backdrop-filter': 'blur(14px)',
          border: '1px solid $ui.glassEdge',
        },
        children: [
          {
            type: 'box',
            when: [{ test: 'hero.accent' }],
            style: {
              width: '6px',
              height: '6px',
              'border-radius': '3px',
              'background-color': '{hero.accent}',
            },
          },
          {
            type: 'box',
            when: [{ test: 'hero.accent', not: true }],
            style: { width: '6px', height: '6px', 'border-radius': '3px', 'background-color': '$ui.accent' },
          },
          {
            type: 'text',
            text: '{heroAct.reasonLabel}',
            style: {
              'font-size': '11px',
              'font-weight': '650',
              'letter-spacing': '0.08em',
              'text-transform': 'uppercase',
              color: '$ui.ink',
            },
          },
        ],
      },
      {
        type: 'image',
        when: [{ test: 'hero.logo' }],
        src: '{hero.logo}',
        alt: '{hero.name}',
        role: 'heading',
        level: 1,
        motion: enter(300),
        style: {
          height: '150px',
          width: 'min(520px, 70%)',
          'max-width': 'min(520px, 70%)',
          'object-fit': 'contain',
          'align-self': 'flex-start',
        },
        small: { height: '96px', 'max-width': '78%' },
      },
      {
        type: 'text',
        when: [{ test: 'hero.logo', not: true }],
        text: '{hero.name}',
        role: 'heading',
        level: 1,
        motion: enter(300),
        style: {
          'font-family': '$ui.fontDisplay',
          'font-weight': '400',
          'letter-spacing': '-0.01em',
          'line-height': '0.98',
          'font-size': '84px',
          'text-shadow': '0px 4px 40px $ui.shadow',
        },
        small: { 'font-size': '48px' },
      },
      {
        type: 'text',
        text: '{hero.factsLine}',
        motion: enter(380),
        style: {
          'font-size': '14px',
          color: '$ui.inkSecondary',
          'text-shadow': '0px 1px 12px $ui.shadow',
          'font-variant-numeric': 'tabular-nums',
        },
        small: { 'font-size': '13px' },
      },
      {
        type: 'text',
        when: [{ test: 'hero.summary' }],
        text: '{hero.summary}',
        motion: enter(440),
        style: {
          'font-size': '16px',
          color: '$ui.inkSecondary',
          'text-shadow': '0px 1px 14px $ui.shadow',
          'line-clamp': '3',
          'line-height': '1.55',
          'max-width': '36rem',
        },
        small: { 'font-size': '14px', 'line-clamp': '2' },
        // Over a playing trailer the summary takes the full ink, as compiled Cinematic's did.
        states: [{ when: [{ test: 'hero.previewing' }], style: { color: '$ui.ink' } }],
      },
      {
        type: 'box',
        motion: enter(500),
        style: {
          display: 'flex',
          'flex-direction': 'row',
          gap: '12px',
          'align-items': 'center',
          'flex-wrap': 'wrap',
          'margin-top': '8px',
        } as Style,
        small: { 'margin-top': '4px' } as Style,
        children: [heroPrimary, heroMore(false), heroMore(true)],
      },
    ],
  },
};

// One dot per featured title; the current one widens and fills over the rotation interval.
export const dot = (current: boolean): Node => ({
  type: 'box',
  press: { action: 'pickHero', arg: '{index}' },
  label: '{hero.name}',
  when: [{ test: 'index.current', not: !current }],
  style: {
    position: 'relative',
    width: current ? '34px' : '8px',
    height: '8px',
    'border-radius': '4px',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    'background-color': current ? '$ui.trackStrong' : '$ui.glassEdgeStrong',
  },
  hover: { 'background-color': '$ui.controlHover' },
  focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' },
  // The current dot is filled; while the carousel rotates the fill grows over the interval.
  children: current
    ? [
        {
          type: 'box',
          when: [{ test: 'env.rotating' }],
          motion: 'velaHeroFill',
          style: {
            position: 'absolute',
            inset: '0px',
            'border-radius': '4px',
            'background-color': '$ui.ink',
          },
        },
        {
          type: 'box',
          when: [{ test: 'env.rotating', not: true }],
          style: {
            position: 'absolute',
            inset: '0px',
            'border-radius': '4px',
            'background-color': '$ui.ink',
          },
        },
      ]
    : [],
});
export const dots: Node = {
  type: 'box',
  role: 'group',
  label: '{t:ui.featuredTitles}',
  motion: enter(560),
  when: [
    { test: 'env.searching', not: true },
    { test: 'env.heroCount', is: 'gt', value: '1' },
  ],
  style: {
    display: 'flex',
    'flex-direction': 'row',
    gap: '8px',
    'align-items': 'center',
    ...gutter,
    'padding-top': '22px',
  } as Style,
  small: { ...gutterSmall, 'padding-top': '16px' } as Style,
  children: [
    {
      type: 'repeat',
      over: 'home.heroes',
      item: { type: 'box', style: { display: 'flex' }, children: [dot(true), dot(false)] },
    },
  ],
};
// The hero copy and its dots. Compiled draws them in one column with the search field below
// (at least the hero's height, copy at its foot; folded to the field while searching or with
// no featured title); a slot stands at the top of its tree, so here the field follows this
// column and each height leaves out its block: 34 + 60 + 14 px wide, 26 + 60 + 10 on phones.
export const searchSlot: Node = {
  type: 'slot',
  slot: 'searchField',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    'padding-top': '34px',
    'padding-bottom': '14px',
    'padding-left': 'max(28px, 4vw)',
    'padding-right': 'max(28px, 4vw)',
    'align-items': 'center',
  } as Style,
  small: {
    'padding-top': '26px',
    'padding-bottom': '10px',
    'padding-left': '16px',
    'padding-right': '16px',
  } as Style,
  inner: {
    width: '100%',
    'max-width': '720px',
    animation: 'vr-rise 640ms cubic-bezier(0.16, 1, 0.3, 1) 420ms both',
  },
};
export const copyBase: Style = {
  position: 'relative',
  display: 'flex',
  'flex-direction': 'column',
  'justify-content': 'flex-end',
  'box-sizing': 'border-box',
  'min-height': 'calc(clamp(500px, 62vh, 700px) - 108px)',
  'padding-top': 'calc(84px + 32px + env(safe-area-inset-top))',
};
export const folded = (height: string): Style => ({
  ...copyBase,
  height,
  'min-height': '0px',
  'padding-top': '0px',
});
export const noHero: Condition = { test: 'env.heroCount', is: 'eq', value: '0' };
export const copyColumn: Node = {
  type: 'box',
  layoutTransition: '640ms ease-out',
  style: copyBase,
  states: [
    { when: [{ test: 'env.searching' }, small], style: folded('80px') },
    { when: [{ test: 'env.searching' }], style: folded('82px') },
    { when: [noHero, small], style: folded('80px') },
    { when: [noHero], style: folded('82px') },
    {
      when: [small],
      style: {
        ...copyBase,
        'min-height': '424px',
        'padding-top': 'calc(104px + 22px + env(safe-area-inset-top))',
      },
    },
  ],
  children: [heroCopy, dots],
};

export const homeLoading: Node = {
  type: 'box',
  when: [is('env.load', 'loading')],
  role: 'status',
  label: '{t:ui.findingYourEvening}',
  motion: 'velaStatusIn',
  style: { display: 'flex', 'flex-direction': 'column' },
  children: [
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'column',
        height: 'clamp(500px, 62vh, 700px)',
        'justify-content': 'flex-end',
        gap: '16px',
        ...gutter,
        'box-sizing': 'border-box',
        'background-image': `radial-gradient(ellipse 80% 70% at 20% 40%, $ui.skeleton 0%, ${veil(0)} 70%)`,
      } as Style,
      small: { height: '520px', ...gutterSmall } as Style,
      children: [
        bone('120px', '10px', 4),
        bone('min(560px, 50%)', '76px', 10, { width: '80%', height: '48px' }),
        bone('300px', '14px', 4, { width: '60%' }),
        bone('150px', '52px', 26),
        {
          type: 'box',
          style: {
            display: 'flex',
            'flex-direction': 'column',
            'align-items': 'center',
            'padding-top': '34px',
          },
          children: [bone('min(720px, 100%)', '60px', 30)],
        },
      ],
    },
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', 'padding-top': '36px' },
      children: [rowSkeleton],
    },
  ],
};
// Home: the hero stage and copy, the search field and the rows; its own states while it loads or fails.
export const home: Node = {
  type: 'box',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column' },
  children: [
    stage,
    homeLoading,
    failure('{t:ui.yourLibraryCouldnTBeReachedCheckYourServerConnection}'),
    { ...copyColumn, when: [ready] } as Node,
    { ...searchSlot, when: [ready] } as Node,
    {
      type: 'box',
      when: [ready, { test: 'env.searching', not: true }],
      style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'padding-top': '22px' },
      small: { 'padding-top': '14px' },
      children: [
        {
          type: 'repeat',
          over: 'home.rows',
          item: { type: 'use', template: 'velaRow', motion: 'velaRowIn', stagger: { step: 90, cap: 4 } },
        },
        // More rows load as the end of home comes near.
        {
          type: 'box',
          when: [{ test: 'env.homeHasMore' }],
          style: {
            position: 'relative',
            display: 'flex',
            'flex-direction': 'column',
            'min-height': '120px',
            'justify-content': 'center',
          },
          children: [
            { type: 'widget', widget: 'sentinel', params: { on: 'home' } },
            { ...rowSkeleton, when: [{ test: 'env.homeMoreLoading' }] } as Node,
          ],
        },
      ],
    },
  ],
};

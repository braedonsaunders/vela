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
  belowBar,
  phone,
  pill,
  pillSmall,
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
        small: {
          'background-image': [
            `linear-gradient(90deg, ${veil(97)} 0%, ${veil(88)} 48%, ${veil(58)} 72%, ${veil(24)} 100%)`,
            `linear-gradient(0deg, $ui.page 0%, ${veil(90)} 26%, ${veil(22)} 68%)`,
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

// The first featured title's primary pill carries a warm halo, closer and softer on a phone. A state
// layers over the node's own style at this width (its phone overlay included), so it carries only
// the halo: repeating the wide pill here put the 56px pill back on a phone.
const firstHero: Condition = { test: 'env.heroIndex', is: 'eq', value: '0' };
export const firstHeroHalo = [
  { when: [firstHero, small], style: { 'box-shadow': '0px 8px 24px $ui.focusHalo, 0px 0px 0px 1px $ui.glassEdgeStrong' } },
  { when: [firstHero], style: { 'box-shadow': '0px 14px 44px $ui.focusHalo, 0px 0px 0px 1px $ui.glassEdgeStrong' } },
];
// Phones lay the hero's actions in one row: the primary takes the room (from its content width, so
// a larger text size grows it rather than clipping it), the round marks keep theirs.
const growSmall: Style = { 'flex-grow': '1', 'flex-shrink': '1', 'min-width': '0px' } as Style;
export const heroPrimary: Node = {
  type: 'box',
  press: { action: 'play', arg: '{hero.id}' },
  label: '{heroAct.actionLabel}',
  testId: 'hero-primary',
  when: [{ test: 'heroAct.playable' }],
  style: { ...pill(true), position: 'relative' },
  states: firstHeroHalo,
  small: { ...pillSmall(true), ...growSmall },
  hover: { 'background-color': '$ui.inkHover' },
  focus: { 'box-shadow': focusRing },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center' },
      small: { gap: '10px', 'min-width': '0px' },
      children: [
        { type: 'icon', symbol: 'play-fill', style: { width: '18px', height: '18px' }, small: { width: '15px', height: '15px' } },
        {
          type: 'box',
          style: { display: 'flex', 'flex-direction': 'column', gap: '3px', 'align-items': 'flex-start' },
          small: { gap: '2px', 'flex-shrink': '1', 'min-width': '0px' },
          children: [
            {
              type: 'text',
              text: '{heroAct.actionLabel}',
              style: { 'font-size': '16px', 'font-weight': '700', 'line-height': '1.1' },
              small: { 'font-size': '15px', 'font-weight': '650', 'line-clamp': '1' },
            },
            {
              type: 'text',
              when: [{ test: 'heroAct.actionDetail' }],
              text: '{heroAct.actionDetail}',
              style: { 'font-size': '12px', 'font-weight': '600', opacity: '0.62', 'line-height': '1', 'white-space': 'nowrap' },
              small: { 'font-size': '11px' },
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'heroAct.hasProgress' }],
          small: { width: '32px', 'flex-shrink': '0' },
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
  states: primary ? firstHeroHalo : undefined,
  // Phones: the primary More info fills the row; beside a play action it is a round 44pt mark,
  // named for a screen reader by its label.
  small: primary
    ? { ...pillSmall(true), ...growSmall }
    : { width: `${phone.button}px`, height: `${phone.button}px`, padding: '0px', 'padding-left': '0px', 'padding-right': '0px', 'flex-shrink': '0' },
  hover: primary
    ? { 'background-color': '$ui.inkHover' }
    : { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
  focus: { 'box-shadow': focusRing },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
      children: [
        { type: 'icon', symbol: 'info', style: { width: '17px', height: '17px' }, ...(primary ? {} : { small: { width: '19px', height: '19px' } }) },
        { type: 'text', text: '{t:hero.moreInfo}', style: { 'font-size': '15px' }, small: primary ? { 'font-weight': '650' } : { display: 'none' } },
      ],
    },
  ],
});

export const heroCopy: Node = {
  type: 'repeat',
  over: 'home.hero',
  when: [{ test: 'env.searching', not: true }, { test: 'env.searchFocused', not: true }],
  item: {
    type: 'box',
    style: { display: 'flex', 'flex-direction': 'column', ...gutter, gap: '16px', 'max-width': '46rem' },
    small: { ...gutterSmall, gap: '10px', 'max-width': 'none' },
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
        small: { padding: '4px 10px 4px 8px', gap: '6px' },
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
              'font-size': '12px',
              'font-weight': '650',
              'letter-spacing': '0.08em',
              'text-transform': 'uppercase',
              color: '$ui.ink',
            },
            small: { 'font-size': '10px', 'letter-spacing': '0.1em' },
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
          height: 'clamp(110px, 14.5vh, 150px)',
          width: 'min(520px, 70%)',
          'max-width': 'min(520px, 70%)',
          'object-fit': 'contain',
          'align-self': 'flex-start',
        },
        small: { height: '80px', 'max-width': '72%' },
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
          'font-size': 'clamp(56px, 7.4vh, 84px)',
          'line-clamp': '2',
          'text-shadow': '0px 4px 40px $ui.shadow',
        },
        small: { 'font-size': '40px' },
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
        // Phones keep the actions in one row: the primary fills it, More info is a round mark.
        small: { 'margin-top': '4px', 'flex-wrap': 'nowrap', gap: '8px' } as Style,
        children: [heroPrimary, heroMore(false), heroMore(true)],
      },
    ],
  },
};

// The featured titles' pager, a row of its own along the hero's foot (never inside the copy, so it
// cannot sit on the actions): one short segment per title, the one on show filling over the
// rotation interval and held full while the hero waits; a resume title's segment takes the accent.
// Beside them "2 / 6 · Continue watching", then previous, pause and next. Each segment is one node
// whatever its state. They remain pointer/touch shortcuts but never enter directional focus order;
// keyboard and remote arrows change slides from the hero's action buttons.
const segmentTrack = (color: string): Style => ({
  position: 'relative',
  width: 'calc(100% - 8px)',
  'max-width': '32px',
  height: '4px',
  'border-radius': '2px',
  'overflow-x': 'hidden',
  'overflow-y': 'hidden',
  'background-color': color,
});
const segmentFill: Style = { position: 'absolute', inset: '0px', 'border-radius': '2px', 'background-color': '$ui.ink' };
export const segment: Node = {
  type: 'box',
  press: { action: 'pickHero', arg: '{index}' },
  label: '{hero.slideLabel}',
  testId: 'hero-segment-{index}',
  a11y: { current: [{ test: 'index.current' }] },
  style: {
    position: 'relative',
    width: '40px',
    height: '44px',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'border-radius': '8px',
  },
  // Phones: a shorter, finer segment in the same 44pt-tall target.
  small: { width: '24px' },
  focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' },
  children: [
    {
      type: 'box',
      style: segmentTrack('color-mix(in srgb, $ui.ink 36%, transparent)'),
      small: { height: '3px', 'border-radius': '1.5px' },
      states: [{ when: [{ test: 'heroAct.hasProgress' }], style: segmentTrack('color-mix(in srgb, $ui.accent 72%, transparent)') }],
      groupHover: { 'background-color': 'color-mix(in srgb, $ui.ink 62%, transparent)' },
      children: [
        { type: 'box', when: [{ test: 'index.current' }, { test: 'env.rotating' }], motion: 'velaHeroFill', style: segmentFill },
        { type: 'box', when: [{ test: 'index.current' }, { test: 'env.rotating', not: true }], style: segmentFill },
      ],
    },
  ],
  group: true,
};
const pagerButton: Style = {
  position: 'relative',
  width: '36px',
  height: '36px',
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  'flex-shrink': '0',
  'border-radius': '$ui.radiusControl',
  color: '$ui.ink',
  border: '1px solid $ui.glassEdge',
  'background-color': '$ui.glass',
  'backdrop-filter': 'blur(14px)',
};
const step = (direction: 'prev' | 'next'): Node => ({
  type: 'box',
  press: { action: 'pickHero', arg: direction === 'prev' ? '{env.heroPrev}' : '{env.heroNext}' },
  label: direction === 'prev' ? '{t:hero.previous}' : '{t:hero.next}',
  testId: `hero-${direction}`,
  style: pagerButton,
  small: { display: 'none' },
  hover: { 'background-color': '$ui.controlHover' },
  focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' },
  children: [{ type: 'icon', symbol: direction === 'prev' ? 'back' : 'forward-chevron', style: { width: '14px', height: '14px' } }],
});
// One control whose name and glyph follow the state, so focus stays on it when pressed. Paused, it
// shows a turning arrow, not the play triangle the hero's own play buttons use.
// Phones draw it as a quiet 28pt disc in a 44pt target, its edge level with the gutter.
const slideshowSmall: Style = {
  width: `${phone.target}px`, height: `${phone.target}px`, 'margin-right': '-8px', border: 'none',
  'background-color': 'transparent', 'backdrop-filter': 'none',
} as Style;
const slideshowControl: Node = {
  type: 'box',
  press: { action: 'toggle', arg: 'hero-paused' },
  label: '{t:hero.slideshowPause}',
  testId: 'hero-slideshow',
  group: true,
  style: pagerButton,
  small: slideshowSmall,
  states: [{ when: [{ test: 'env.heroPaused' }], style: {}, label: '{t:hero.slideshowPlay}' }],
  hover: { 'background-color': '$ui.controlHover' },
  focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' },
  children: [
    { type: 'icon', when: [{ test: 'env.heroPaused', not: true }, { ...small, not: true }], symbol: 'pause', style: { width: '13px', height: '13px' } },
    { type: 'icon', when: [{ test: 'env.heroPaused' }, { ...small, not: true }], symbol: 'autoplay', style: { width: '17px', height: '17px' } },
    {
      type: 'box',
      when: [small],
      style: { ...pagerButton, width: '28px', height: '28px', 'box-sizing': 'border-box', 'background-color': 'transparent', 'backdrop-filter': 'none' } as Style,
      groupHover: { 'background-color': '$ui.controlHover' },
      children: [
        { type: 'icon', when: [{ test: 'env.heroPaused', not: true }], symbol: 'pause', style: { width: '10px', height: '10px' } },
        { type: 'icon', when: [{ test: 'env.heroPaused' }], symbol: 'autoplay', style: { width: '13px', height: '13px' } },
      ],
    },
  ],
};
const caption: Node = {
  type: 'repeat',
  over: 'home.hero',
  item: {
    type: 'box',
    a11y: { hidden: true },
    style: { display: 'flex', 'flex-direction': 'row', gap: '6px', 'align-items': 'baseline', 'min-width': '0px', 'margin-left': '10px' },
    small: { 'margin-left': '6px' },
    children: [
      {
        type: 'text',
        text: '{index.label} / {env.heroCount}',
        style: { 'font-size': '13px', 'font-weight': '650', color: '$ui.ink', 'font-variant-numeric': 'tabular-nums', 'white-space': 'nowrap' },
      },
      {
        type: 'text',
        text: '· {heroAct.reasonLabel}',
        style: { 'font-size': '13px', color: '$ui.inkSecondary', 'white-space': 'nowrap', 'line-clamp': '1' },
        small: { display: 'none' },
      },
      {
        type: 'text',
        when: [{ test: 'env.heroPaused' }],
        text: '· {t:hero.paused}',
        style: { 'font-size': '13px', color: '$ui.inkSecondary', 'white-space': 'nowrap' },
      },
    ],
  },
};
export const heroPager: Node = {
  type: 'box',
  motion: enter(560),
  when: [
    { test: 'env.searching', not: true },
    { test: 'env.searchFocused', not: true },
    { test: 'env.heroCount', is: 'gt', value: '1' },
  ],
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'row',
    gap: '8px',
    'align-items': 'center',
    ...gutter,
    'padding-top': '18px',
    'text-shadow': '0px 1px 12px $ui.shadow',
  } as Style,
  small: { ...gutterSmall, 'padding-top': '6px', gap: '2px' } as Style,
  children: [
    {
      type: 'box',
      role: 'group',
      label: '{t:ui.featuredTitles}',
      style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'margin-left': '-4px' },
      children: [{ type: 'repeat', over: 'home.heroes', item: segment }],
    },
    caption,
    { type: 'box', style: { flex: '1', 'min-width': '8px' } },
    step('prev'),
    slideshowControl,
    step('next'),
  ],
};
// The search field below the hero's copy and pager (folded to the field while searching or with
// no featured title); a slot stands at the top of its tree, so here the field follows the copy
// column and its pager: 34 + 60 + 14 px wide, 14 + 44 + 6 on phones. It scrolls away with the
// hero; the top bar keeps its own Search.
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
    'padding-top': '14px',
    'padding-bottom': '6px',
    'padding-left': '18px',
    'padding-right': '18px',
  } as Style,
  inner: {
    width: '100%',
    'max-width': '720px',
    animation: 'vr-rise 640ms cubic-bezier(0.16, 1, 0.3, 1) 420ms both',
  },
};
// The copy column keeps the hero's height steady from title to title: it reserves room for a
// two-line title (the title never takes more), three summary lines and the actions, and grows
// rather than letting them overlap where even that is not enough.
const reserve = 'max(calc(clamp(500px, 62vh, 700px) - 108px), calc(345px + 1.96 * clamp(56px, 7.4vh, 84px)))';
export const copyBase: Style = {
  position: 'relative',
  display: 'flex',
  'flex-direction': 'column',
  'justify-content': 'flex-end',
  'box-sizing': 'border-box',
  'min-height': reserve,
  'padding-top': 'calc(56px + 32px + env(safe-area-inset-top))',
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
    { when: [{ test: 'env.searchFocused' }, small], style: folded('72px') },
    { when: [{ test: 'env.searchFocused' }], style: folded('82px') },
    { when: [{ test: 'env.searching' }, small], style: folded('72px') },
    { when: [{ test: 'env.searching' }], style: folded('82px') },
    { when: [noHero, small], style: folded('72px') },
    { when: [noHero], style: folded('82px') },
    {
      when: [small],
      style: {
        ...copyBase,
        'min-height': '400px',
        'padding-top': belowBar(22),
      },
    },
  ],
  children: [heroCopy],
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
    { ...heroPager, when: [ready, ...(heroPager.when ?? [])] } as Node,
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

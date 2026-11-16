// Home: the search strip, the featured banner, the hubs, and home's loading and failure states.
import type { Node, Style } from '../../../skin';
import { sans, bar, fill, px, is, set, unset, glyph, ring, round, primary, secondary } from './look';
import { glassBar } from './shell';
import { block, art } from './cards';

const heroCopy: Node = {
  type: 'box',
  style: {
    position: 'absolute',
    left: '0px',
    bottom: '0px',
    'box-sizing': 'border-box',
    width: 'min(620px, 62%)',
    padding: '0px 36px 32px',
    display: 'flex',
    'flex-direction': 'column',
    gap: '10px',
  },
  small: { position: 'relative', width: '100%', padding: '0px 16px 16px', gap: '8px' },
  children: [
    {
      type: 'text',
      when: [set('heroAct.reasonLabel')],
      text: '{heroAct.reasonLabel}',
      style: {
        'font-size': '12px',
        'font-weight': '700',
        'letter-spacing': '0.08em',
        'text-transform': 'uppercase',
        color: '$amber',
      },
    },
    {
      type: 'text',
      when: [unset('heroAct.reasonLabel')],
      text: '{s:featured}',
      style: {
        'font-size': '12px',
        'font-weight': '700',
        'letter-spacing': '0.08em',
        'text-transform': 'uppercase',
        color: '$amber',
      },
    },
    {
      type: 'text',
      text: '{hero.name}',
      role: 'heading',
      level: 2,
      style: {
        'font-size': '34px',
        'font-weight': '700',
        'line-height': '1.1',
        'letter-spacing': '-0.01em',
        'line-clamp': '2',
      },
      small: { 'font-size': '22px' },
    },
    {
      type: 'text',
      text: '{hero.metaLine}',
      style: { 'font-size': '14px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' },
      small: { 'font-size': '13px' },
    },
    {
      type: 'text',
      when: [set('hero.summary')],
      text: '{hero.summary}',
      style: {
        'font-size': '15px',
        color: '$ink',
        'line-height': '1.5',
        'line-clamp': '2',
        'text-shadow': '0px 1px 8px $shadow',
      },
      small: { display: 'none' },
    },
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '10px',
        'align-items': 'center',
        'margin-top': '8px',
        'flex-wrap': 'wrap',
      },
      small: { 'margin-top': '4px' },
      children: [
        // The server's predicted action (play, resume, next episode) in amber, then More info.
        {
          type: 'box',
          when: [set('heroAct.playable')],
          press: { action: 'play', arg: '{hero.id}' },
          label: '{heroAct.actionLabel}',
          testId: 'hero-primary',
          ...primary(40, '0px 20px'),
          small: { height: '38px' },
          children: [
            glyph('play', 16),
            { type: 'text', text: '{heroAct.actionLabel}', style: { 'font-size': '15px' } },
            {
              type: 'text',
              when: [set('heroAct.actionDetail')],
              text: '{heroAct.actionDetail}',
              style: { 'font-size': '13px', 'font-weight': '600', opacity: '0.7' },
              small: { display: 'none' },
            },
          ],
        },
        {
          type: 'box',
          when: [set('heroAct.playable')],
          press: { action: 'select', arg: '{hero.kindId}' },
          label: '{hero.label}',
          ...secondary(40, '0px 18px'),
          small: { height: '38px' },
          children: [
            glyph('info', 18),
            { type: 'text', text: '{s:moreInfo}', style: { 'font-size': '15px' } },
          ],
        },
        {
          type: 'box',
          when: [unset('heroAct.playable')],
          press: { action: 'select', arg: '{hero.kindId}' },
          label: '{hero.label}',
          ...primary(40, '0px 20px'),
          small: { height: '38px' },
          children: [
            glyph('info', 18),
            { type: 'text', text: '{s:moreInfo}', style: { 'font-size': '15px' } },
          ],
        },
      ],
    },
  ],
};
const dot: Node = {
  type: 'box',
  press: { action: 'pickHero', arg: '{index}' },
  label: '{s:featuredNumber}',
  a11y: { current: [set('index.current')] },
  layoutTransition: '200ms ease-out',
  style: {
    position: 'relative',
    outline: 'auto',
    width: '8px',
    height: '8px',
    'border-radius': '4px',
    'background-color': '$track',
  },
  states: [
    {
      when: [set('index.current')],
      style: {
        position: 'relative',
        outline: 'auto',
        width: '22px',
        height: '8px',
        'border-radius': '4px',
        'background-color': '$amber',
      },
    },
  ],
  focus: { 'box-shadow': ring('$ink') },
} as Node;
const spotlight: Node = {
  type: 'repeat',
  over: 'home.hero',
  when: [unset('env.searching')],
  item: {
    type: 'box',
    motion: 'arrive',
    style: {
      position: 'relative',
      display: 'flex',
      'flex-direction': 'column',
      'margin-left': '40px',
      'margin-right': '40px',
      'margin-bottom': '30px',
      height: 'clamp(280px, 30vw, 380px)',
      'min-height': '280px',
      'border-radius': '6px',
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
      'background-color': '$raised',
    },
    small: {
      'margin-left': '14px',
      'margin-right': '14px',
      'margin-bottom': '20px',
      height: 'auto',
      'min-height': '0px',
    },
    children: [
      { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
      {
        type: 'box',
        style: { display: 'none' },
        small: { position: 'relative', display: 'flex', width: '100%', 'aspect-ratio': '16 / 9' },
        children: [
          { ...art('{hero.backdrop}'), when: [set('hero.backdrop')] },
          {
            type: 'box',
            style: { ...fill, 'background-image': 'linear-gradient(0deg, $raised 0%, $scrim-clear 55%)' },
          },
        ],
      },
      { ...art('{hero.backdrop}'), when: [set('hero.backdrop')], small: { display: 'none' } },
      {
        type: 'box',
        style: {
          ...fill,
          'background-image':
            'linear-gradient(90deg, $scrim 0%, $scrim 30%, $scrim-soft 55%, $scrim-clear 78%), '
              + 'linear-gradient(0deg, $scrim 0%, $scrim-clear 55%)',
        },
        small: { display: 'none' },
      },
      heroCopy,
      {
        type: 'box',
        role: 'group',
        label: '{s:featuredTitles}',
        when: [{ test: 'env.heroCount', is: 'gt', value: '1' }],
        style: {
          position: 'absolute',
          right: '24px',
          bottom: '24px',
          display: 'flex',
          'flex-direction': 'row',
          gap: '6px',
        },
        small: { right: '14px', top: '12px', bottom: 'auto' },
        children: [{ type: 'repeat', over: 'home.heroes', item: dot }],
      },
    ],
  },
};

export const empty = (icon: string, title: string, message: string, extra: Partial<Node> = {}): Node =>
  ({
    type: 'box',
    role: 'status',
    ...extra,
    style: {
      display: 'flex',
      'flex-direction': 'column',
      'align-items': 'center',
      'text-align': 'center',
      gap: '10px',
      padding: '64px 24px',
    },
    children: [
      glyph(icon, 44, { style: { color: '$ink-faint', 'margin-bottom': '6px' } }),
      { type: 'text', text: title, style: { 'font-size': '20px', 'font-weight': '700' } },
      ...(message
        ? [
            {
              type: 'text',
              text: message,
              style: { 'font-size': '15px', color: '$ink-dim', 'line-height': '1.5', 'max-width': '30rem' },
            } as Node,
          ]
        : []),
    ],
  }) as Node;

// The search field: in a sticky strip at the top of a wide home (the bar's middle, in the
// bar's colour), under the bar on phones.
const fieldStyle = (focused: boolean): Style => ({
  position: 'relative',
  display: 'flex',
  'flex-direction': 'row',
  width: '100%',
  'max-width': '560px',
  'align-items': 'center',
  gap: '10px',
  height: '38px',
  'box-sizing': 'border-box',
  padding: '0px 4px 0px 12px',
  'border-radius': '6px',
  'background-color': focused ? '$field-focus' : '$field',
  'box-shadow': focused ? '0px 0px 0px 1px $line-strong' : 'none',
  transition: 'background-color 120ms linear, box-shadow 120ms linear',
});
const searchStrip: Node = {
  type: 'box',
  style: {
    position: 'sticky',
    top: '0px',
    'z-index': '16',
    display: 'flex',
    'flex-direction': 'row',
    'flex-shrink': '0',
    height: px(bar.normal),
    'box-sizing': 'border-box',
    padding: '0px 76px 0px 24px',
    'align-items': 'center',
    'justify-content': 'center',
    'background-color': '$chrome-glass',
    'backdrop-filter': 'blur(18px)',
  },
  small: {
    position: 'relative',
    top: 'auto',
    height: 'auto',
    'margin-top': px(bar.small),
    padding: '10px 14px 16px',
    'background-color': 'transparent',
    'backdrop-filter': 'none',
  },
  children: [
    {
      type: 'box',
      style: fieldStyle(false),
      states: [{ when: [set('env.searchFocused')], style: fieldStyle(true) }],
      children: [
        glyph('search', 18, {
          style: { color: '$ink-faint' },
          states: [
            {
              when: [set('env.searchFocused')],
              style: { width: '18px', height: '18px', 'flex-shrink': '0', color: '$ink' },
            },
          ],
        } as Partial<Node>),
        {
          type: 'widget',
          widget: 'searchInput',
          params: {
            placeholder: '{s:search}',
            label: '{s:searchYourLibrary}',
            placeholderColor: '$ink-faint',
          },
          style: {
            flex: '1',
            'min-width': '0px',
            height: '100%',
            padding: '0px',
            outline: 'none',
            color: '$ink',
            'font-size': '15px',
            'font-family': sans,
          },
        },
        {
          type: 'box',
          when: [set('env.searching')],
          press: { action: 'clearSearch' },
          label: '{s:clearSearch}',
          ...round(30),
          children: [glyph('close', 16)],
        },
      ],
    } as Node,
  ],
};
// Home's next rows load as its end scrolls into view, shaped like what is coming.
const shelfBlocks: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column', gap: '12px', 'padding-bottom': '30px' },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', 'padding-left': '40px' },
      small: { 'padding-left': '14px' },
      children: [block('200px', '20px', 4)],
    },
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '16px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'padding-left': '40px',
      },
      small: { gap: '10px', 'padding-left': '14px' },
      children: Array.from({ length: 10 }, (): Node => ({
        type: 'box',
        style: { display: 'flex', 'flex-direction': 'column', gap: '8px', 'flex-shrink': '0' },
        children: [
          block('152px', '228px', 4, { small: { width: '112px', height: '168px' } }),
          block('70%', '12px', 3),
        ],
      })),
    },
  ],
};
const homeEnd: Node = {
  type: 'box',
  when: [unset('env.searching'), set('env.homeHasMore')],
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'min-height': '120px' },
  children: [
    { type: 'widget', widget: 'sentinel', params: { on: 'home' }, style: { ...fill } },
    { ...shelfBlocks, when: [set('env.homeMoreLoading')] },
  ],
};

const contentStyle = (searching: boolean): Style => ({
  display: 'flex',
  'flex-direction': 'column',
  'padding-top': searching ? '0px' : '24px',
  'padding-bottom': searching ? '0px' : '48px',
});
export const ready = is('env.load', 'ready'),
  loading = is('env.load', 'loading'),
  failed = is('env.load', 'failed');
// A failed page: what happened, and Try again when the foundation can ask again. It sits below the bar.
export const failure = (message: string): Node => ({
  type: 'box',
  when: [failed],
  motion: 'statusIn',
  style: { display: 'flex', 'flex-direction': 'column', gap: '4px', 'padding-top': px(bar.normal) },
  small: { 'padding-top': px(bar.small) },
  children: [
    empty('alert', '{s:somethingWentQuiet}', message),
    {
      type: 'box',
      when: [set('env.canRetry')],
      style: { display: 'flex', 'flex-direction': 'row', 'justify-content': 'center' },
      children: [
        {
          type: 'box',
          press: { action: 'retry' },
          label: '{s:tryAgain}',
          ...primary(40, '0px 22px'),
          children: [{ type: 'text', text: '{s:tryAgain}' }],
        },
      ],
    },
  ],
});
// Home while it loads: the bar's strip, then a banner and two hubs in outline.
const homeLoading: Node[] = [
  {
    type: 'box',
    when: [loading],
    motion: 'statusIn',
    style: {
      position: 'sticky',
      top: '0px',
      'z-index': '16',
      'flex-shrink': '0',
      height: px(bar.normal),
      ...glassBar,
    },
    small: {
      position: 'relative',
      height: px(bar.small),
      'background-color': 'transparent',
      'backdrop-filter': 'none',
    },
  },
  {
    type: 'box',
    when: [loading],
    role: 'status',
    label: '{s:findingYourEvening}',
    motion: 'statusIn',
    style: { display: 'flex', 'flex-direction': 'column', 'padding-top': '24px' },
    children: [
      {
        type: 'box',
        style: {
          display: 'flex',
          'flex-direction': 'column',
          'margin-left': '40px',
          'margin-right': '40px',
          'margin-bottom': '30px',
        },
        small: { 'margin-left': '14px', 'margin-right': '14px' },
        children: [block('100%', 'clamp(280px, 30vw, 380px)', 6, { small: { height: '200px' } })],
      },
      shelfBlocks,
      shelfBlocks,
    ],
  },
];
export const home: Node = {
  type: 'box',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column' },
  children: [
    { ...searchStrip, when: [ready] },
    ...homeLoading,
    {
      type: 'box',
      when: [ready],
      style: contentStyle(false),
      small: { 'padding-top': '0px' },
      states: [{ when: [set('env.searching')], style: contentStyle(true) }],
      children: [
        spotlight,
        {
          type: 'repeat',
          over: 'home.rows',
          when: [unset('env.searching')],
          item: {
            type: 'box',
            motion: 'arrive',
            stagger: { step: 40, cap: 5 },
            children: [{ type: 'use', template: 'homeRow' }],
          },
        },
        homeEnd,
        empty('stack', '{s:nothingHereYet}', '{s:noRowsYet}', {
          when: [unset('env.searching'), is('env.rowCount', '0'), is('env.heroCount', '0')],
        }),
      ],
    },
    failure('{s:homeFailed}'),
  ],
};

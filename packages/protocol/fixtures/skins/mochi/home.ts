// Home: the featured title as a big sticker, the featured-title dots, Mochi's search field, and the shelves.
import type { Action, Node, Style } from '../../../skin';
import {
  Bubble,
  bubble,
  candy,
  Candy,
  col,
  emptyState,
  fadeIn,
  fredoka,
  gutter,
  gutterSmall,
  icon,
  inset0,
  is,
  Label,
  loader,
  mascot,
  not,
  ready,
  row,
  set,
  sz,
  Title,
  twinkle,
} from './look';
import { failed, homeLoading } from './status';

export const heroChip: Style = {
  'font-size': '12.5px',
  'font-weight': '600',
  padding: '3px 10px',
  'border-radius': '999px',
  'background-color': '$night-veil',
  border: '1.5px solid $night-edge-strong',
  color: '$night-ink',
  'font-variant-numeric': 'tabular-nums',
};

// The featured title as a big sticker (slots.contract Banner): artwork in a thick rounded
// frame with a hard lavender shadow, the poster stuck on at a tilt, and a candy button.
export const banner: Node = {
  type: 'box',
  motion: 'pop0',
  style: { ...col, position: 'relative' },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
    {
      type: 'box',
      style: {
        ...col,
        position: 'relative',
        height: 'calc(clamp(380px, 54vh, 560px) + 6px)',
        'box-sizing': 'border-box',
        border: '3px solid $ink',
        'border-radius': '34px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$lavender-soft',
        'box-shadow': '10px 11px 0px $lavender',
      },
      small: { height: '446px', 'border-radius': '26px', 'box-shadow': '6px 7px 0px $lavender' },
      children: [
        {
          type: 'image',
          when: [set('hero.backdrop')],
          src: '{hero.backdrop}',
          alt: '',
          fade: true,
          style: fadeIn,
        },
        {
          type: 'image',
          when: [not('hero.backdrop'), set('hero.poster')],
          src: '{hero.poster}',
          alt: '',
          style: {
            position: 'absolute',
            top: '-20%',
            left: '-20%',
            width: '140%',
            height: '140%',
            'object-fit': 'cover',
            filter: 'blur(60px) saturate(1.4)',
            opacity: '0.9',
          },
        },
        {
          type: 'box',
          style: {
            ...inset0,
            'pointer-events': 'none',
            'background-image': [
              'linear-gradient(90deg, $scrim 0%, $scrim-soft 48%, $scrim-clear 72%)',
              'linear-gradient(0deg, $scrim 0%, $scrim-clear 50%)',
            ].join(', '),
          },
          small: { 'background-image': 'linear-gradient(0deg, $scrim 0%, $scrim 30%, $scrim-clear 75%)' },
        },
        {
          type: 'box',
          motion: 'hop160',
          style: {
            ...col,
            position: 'absolute',
            left: '0px',
            right: '0px',
            bottom: '0px',
            'box-sizing': 'border-box',
            padding: '0px 44px 40px',
            'max-width': '46rem',
            gap: '14px',
            color: '$night-ink',
          },
          small: { padding: '0px 20px 22px', 'max-width': 'none', gap: '10px' },
          children: [
            {
              type: 'box',
              style: {
                ...row,
                'align-self': 'flex-start',
                gap: '7px',
                'align-items': 'center',
                padding: '5px 12px 5px 10px',
                'border-radius': '999px',
                'background-color': '$butter',
                color: '$ink',
                border: '2.5px solid $ink',
              },
              children: [
                icon('heart', 11),
                { type: 'text', text: '{s:pickedForYou}', style: { ...Label, 'font-size': '11px' } },
              ],
            },
            {
              type: 'image',
              when: [set('hero.logo')],
              src: '{hero.logo}',
              alt: '{hero.name}',
              role: 'heading',
              level: 1,
              style: {
                height: '130px',
                width: 'min(480px, 72%)',
                'max-width': 'min(480px, 72%)',
                'object-fit': 'contain',
                'align-self': 'flex-start',
                filter: 'drop-shadow(3px 3px 0px $ink)',
              },
              small: { height: '84px', 'max-width': '80%' },
            },
            {
              type: 'text',
              when: [not('hero.logo')],
              text: '{hero.name}',
              role: 'heading',
              level: 1,
              style: {
                ...Title,
                'font-size': '64px',
                'line-clamp': '2',
                color: '$night-ink',
                'text-shadow': '3px 3px 0px $ink',
              },
              small: { 'font-size': '38px' },
            },
            {
              type: 'box',
              style: { ...row, gap: '6px', 'flex-wrap': 'wrap' },
              children: [
                { type: 'text', when: [set('hero.facts')], text: '{hero.facts}', style: heroChip },
                {
                  type: 'repeat',
                  over: 'hero.genres',
                  limit: 3,
                  item: { type: 'text', text: '{genre.text}', style: heroChip },
                },
              ],
            },
            {
              type: 'text',
              when: [set('hero.summary')],
              text: '{hero.summary}',
              style: {
                'font-size': '16px',
                'line-height': '1.5',
                'line-clamp': '3',
                'max-width': '34rem',
                color: '$night-ink',
                'text-shadow': '0px 1px 8px $ink',
              },
              small: { 'font-size': '14px', 'line-clamp': '2' },
            },
            {
              type: 'box',
              style: { ...row, 'margin-top': '8px' },
              small: { 'margin-top': '4px' },
              children: [
                {
                  type: 'box',
                  press: { action: 'select', arg: '{hero.kindId}' },
                  label: '{hero.label}',
                  testId: 'hero-more',
                  style: {
                    ...Candy,
                    height: '60px',
                    'padding-left': '28px',
                    'padding-right': '30px',
                    gap: '10px',
                  },
                  small: { height: '54px', 'padding-left': '22px', 'padding-right': '24px' },
                  ...candy,
                  children: [
                    icon('play', 14),
                    {
                      type: 'text',
                      text: '{s:peek}',
                      style: { 'font-size': '17px' },
                      small: { 'font-size': '16px' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    // The poster, stuck over the frame's top edge with a strip of washi tape.
    {
      type: 'box',
      when: [set('hero.poster')],
      motion: 'pop260',
      style: {
        ...col,
        position: 'absolute',
        right: 'max(36px, 4.5vw)',
        top: '-14px',
        width: 'clamp(150px, 13vw, 210px)',
        'aspect-ratio': '2 / 3',
        rotate: '5',
      },
      small: { display: 'none' },
      children: [
        {
          type: 'box',
          motion: 'float50',
          style: {
            ...col,
            position: 'relative',
            width: '100%',
            height: '100%',
            'box-sizing': 'border-box',
            'border-radius': '20px',
            border: '3px solid $ink',
            'background-color': '$card',
            padding: '5px',
            'box-shadow': '8px 10px 0px $shadow-pink',
          },
          children: [
            {
              type: 'box',
              style: {
                ...col,
                position: 'relative',
                flex: '1',
                'border-radius': '13px',
                'overflow-x': 'hidden',
                'overflow-y': 'hidden',
              },
              children: [{ type: 'image', src: '{hero.poster}', alt: '', fade: true, style: fadeIn }],
            },
          ],
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            top: '-12px',
            left: '42%',
            ...sz(54, 20),
            rotate: '-8',
            'background-color': '$mint',
            opacity: '0.85',
            border: '2px solid $ink',
            'box-sizing': 'border-box',
          },
        },
      ],
    },
    {
      type: 'box',
      when: [set('hero.poster')],
      style: {
        ...col,
        position: 'absolute',
        right: 'max(20px, 2.5vw)',
        top: '-26px',
        color: '$butter',
        filter: 'drop-shadow(2px 2px 0px $ink)',
      },
      small: { display: 'none' },
      children: [twinkle('butter', 26)],
    },
  ],
};

// The featured-title dots: the current one stretches and fills while home rotates.
export const dot: Style = {
  position: 'relative',
  width: '14px',
  height: '14px',
  padding: '0px',
  'box-sizing': 'border-box',
  border: '2.5px solid $ink',
  'border-radius': '7px',
  'overflow-x': 'hidden',
  'overflow-y': 'hidden',
  'background-color': '$card',
  cursor: 'pointer',
};
export const heroDot: Node = {
  type: 'box',
  press: { action: 'pickHero', arg: '{index}' },
  label: '{s:featuredTitle} {index.label} {s:of} {env.heroCount}: {hero.name}',
  a11y: { current: [set('index.current')] },
  style: dot,
  states: [
    { when: [set('index.current')], style: { ...dot, width: '44px', 'background-color': '$pink-soft' } },
  ],
  layoutTransition: '380ms ease-out',
  hover: { 'background-color': '$lavender-soft' },
  focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 2px $card, 0px 0px 0px 5px $focus' },
  children: [
    {
      type: 'box',
      when: [set('index.current'), set('env.rotating')],
      motion: 'heroFill',
      style: { ...inset0, 'background-color': '$pink' },
    },
    {
      type: 'box',
      when: [set('index.current'), not('env.rotating')],
      style: { ...inset0, 'background-color': '$pink' },
    },
  ],
};

// The search box (slots.contract SearchField): a chunky white pill with a butter badge
// that turns pink while you type, and a round clear button.
export const field: Style = {
  ...row,
  position: 'relative',
  width: '100%',
  'max-width': '720px',
  'align-items': 'center',
  gap: '12px',
  height: '62px',
  'box-sizing': 'border-box',
  padding: '0px 8px 0px 10px',
  border: '3px solid $ink',
  'border-radius': '999px',
  'background-color': '$card',
  'box-shadow': '0px 5px 0px $ink',
  transition: 'box-shadow 200ms ease',
};
export const badge: Style = {
  ...row,
  ...sz(40),
  'border-radius': '20px',
  'align-items': 'center',
  'justify-content': 'center',
  'background-color': '$butter',
  border: '2.5px solid $ink',
  'box-sizing': 'border-box',
  color: '$ink',
  transition: 'background-color 160ms linear',
};
// Mochi perches on its top edge, floating; the field and Mochi slide together while searching.
export const searchField: Node = {
  type: 'box',
  style: field,
  states: [
    {
      when: [set('env.searchFocused')],
      style: { ...field, 'box-shadow': '0px 6px 0px $ink, 0px 0px 0px 6px $lavender-soft' },
    },
  ],
  children: [
    {
      type: 'box',
      motion: 'float36',
      style: {
        ...col,
        position: 'absolute',
        left: '30px',
        top: '-36px',
        'z-index': '2',
        'pointer-events': 'none',
      },
      small: { left: '18px', top: '-30px' },
      children: [
        mascot('happy', 48, { when: [not('env.searching')], small: sz(40, 36) }),
        mascot('wow', 48, { when: [set('env.searching')], small: sz(40, 36) }),
      ],
    },
    {
      type: 'box',
      style: badge,
      states: [{ when: [set('env.searchFocused')], style: { ...badge, 'background-color': '$pink' } }],
      children: [icon('search', 16)],
    },
    {
      type: 'widget',
      widget: 'searchInput',
      params: {
        placeholder: '{s:searchPlaceholder}',
        label: '{s:searchYourLibrary}',
        placeholderColor: '$ink-quiet',
      },
      style: {
        flex: '1',
        'min-width': '0px',
        height: '100%',
        color: '$ink',
        'font-family': fredoka,
        'font-size': '17px',
        'font-weight': '500',
        outline: 'none',
      },
    },
    {
      type: 'box',
      when: [set('env.searching')],
      press: { action: 'clearSearch' as Action },
      label: '{s:clearSearch}',
      style: { ...Bubble, ...sz(40) },
      ...bubble,
      children: [icon('close', 12)],
    },
  ],
};

export const searchBlock: Style = {
  ...col,
  position: 'relative',
  'padding-top': '34px',
  'padding-bottom': '10px',
  ...gutter,
  'align-items': 'center',
};
export const home: Node = {
  type: 'box',
  style: { ...col, position: 'relative' },
  children: [
    homeLoading,
    failed('{s:homeFailed}'),
    { type: 'box', when: [ready], style: { height: '10px', 'flex-shrink': '0' }, small: { height: '6px' } },
    {
      type: 'repeat',
      over: 'home.hero',
      when: [ready, not('env.searching'), not('env.searchFocused')],
      item: {
        type: 'box',
        exit: 'heroOut',
        style: { ...col, ...gutter },
        small: gutterSmall,
        children: [banner],
      },
    },
    {
      type: 'box',
      role: 'group',
      label: '{s:featuredTitles}',
      when: [ready, not('env.searching'), not('env.searchFocused'), { test: 'env.heroCount', is: 'gt', value: '1' }],
      style: {
        ...row,
        gap: '8px',
        'align-items': 'center',
        'justify-content': 'center',
        'padding-top': '20px',
      },
      small: { 'padding-top': '16px' },
      children: [{ type: 'repeat', over: 'home.heroes', item: heroDot }],
    },
    // Focus brings the empty field above the keyboard before the viewer starts typing.
    {
      type: 'box',
      when: [ready],
      style: searchBlock,
      layoutTransition: '420ms ease-out',
      states: [
        { when: [set('env.searchFocused'), set('env.small')], style: { ...searchBlock, 'padding-top': '40px' } },
        { when: [set('env.searchFocused')], style: { ...searchBlock, 'padding-top': '48px' } },
        { when: [set('env.searching'), set('env.small')], style: { ...searchBlock, 'padding-top': '40px' } },
        { when: [set('env.searching')], style: { ...searchBlock, 'padding-top': '48px' } },
        { when: [set('env.small')], style: { ...searchBlock, 'padding-top': '26px' } },
      ],
      small: { 'padding-bottom': '4px', ...gutterSmall },
      children: [searchField],
    },
    {
      type: 'box',
      when: [ready, not('env.searching')],
      style: { ...col, position: 'relative', 'padding-top': '18px' },
      small: { 'padding-top': '12px' },
      children: [
        {
          type: 'repeat',
          over: 'home.rows',
          item: {
            type: 'use',
            template: 'shelf',
            motion: 'hopRow',
            stagger: { step: 80, cap: 4 },
            exit: 'rowOut',
          } as Node,
        },
        {
          type: 'box',
          when: [set('env.homeHasMore')],
          style: {
            ...col,
            position: 'relative',
            'min-height': '120px',
            'align-items': 'center',
            'justify-content': 'center',
          },
          children: [
            { type: 'widget', widget: 'sentinel', params: { on: 'home' } },
            { ...loader('{s:loadingMore}', 48), when: [set('env.homeMoreLoading')] } as Node,
          ],
        },
        {
          ...emptyState('sleepy', '{s:nothingHereYet}', '{s:noRowsYet}'),
          when: [is('env.rowCount', '0')],
        } as Node,
        { type: 'box', style: { height: '40px' }, small: { height: '24px' } },
      ],
    },
  ],
};

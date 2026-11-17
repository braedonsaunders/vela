// The title page: the framed sticker book page with artwork, episodes, extras, people and related shelves.
import type { Condition, Node, Style } from '../../../skin';
import {
  Accent,
  accentOf,
  ACCENTS,
  Bubble,
  bubble,
  byAccent,
  candy,
  Candy,
  col,
  fadeIn,
  fredoka,
  icon,
  inset0,
  is,
  Label,
  lift,
  liftStill,
  loader,
  mod,
  not,
  Pixel,
  pixelFace,
  press94,
  puffy,
  Puffy,
  ready,
  ring,
  row,
  set,
  stillC,
  sz,
  Title,
  twinkle,
} from './look';
import { failed } from './status';

export const side: Style = { 'padding-left': 'max(48px, 5vw)', 'padding-right': 'max(48px, 5vw)' };
export const sideSmall = (n: number): Style => ({ 'padding-left': `${n}px`, 'padding-right': `${n}px` });
// A section title in pixel type beside a pixel icon in a candy badge (detail.contract).
export const sectionHeading = (label: string, english: string, iconName: string): Node => ({
  type: 'box',
  style: { ...row, gap: '10px', 'align-items': 'center' },
  children: [
    {
      type: 'box',
      style: {
        ...row,
        'align-items': 'center',
        'justify-content': 'center',
        ...sz(32),
        'border-radius': '10px',
        'background-color': `$${accentOf(english)}`,
        border: '2.5px solid $ink',
        'box-sizing': 'border-box',
      },
      children: [icon(iconName, 14)],
    },
    {
      type: 'text',
      text: label,
      role: 'heading',
      level: 2,
      style: { ...Pixel, 'font-size': '26px' },
      small: { 'font-size': '22px' },
    },
  ],
});

// The big candy play button.
export const playButton = (
  label: string,
  aria: string,
  arg: string,
  small: boolean,
  when: Condition[] = [],
): Node => ({
  type: 'box',
  when,
  press: { action: 'play', arg },
  label: aria,
  testId: 'detail-play',
  style: {
    ...Candy,
    'flex-shrink': '0',
    gap: '10px',
    height: small ? '56px' : '64px',
    'padding-left': small ? '22px' : '30px',
    'padding-right': small ? '26px' : '34px',
  },
  small: { height: '56px', 'padding-left': '22px', 'padding-right': '26px' },
  ...candy,
  children: [
    icon('play', small ? 15 : 17, undefined, { small: sz(15) }),
    {
      type: 'text',
      text: label,
      style: { 'font-size': small ? '16px' : '18px' },
      small: { 'font-size': '16px' },
    },
  ],
});
// Watched progress as a striped candy bar.
export const candyBar = (pct: string, label: string, style: Style, small?: Style): Node => ({
  type: 'box',
  role: 'progressbar',
  label,
  style: {
    ...col,
    height: '14px',
    'border-radius': '7px',
    border: '2.5px solid $ink',
    'box-sizing': 'border-box',
    'background-color': '$card',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    ...style,
  },
  small,
  children: [
    {
      type: 'box',
      style: {
        height: '100%',
        width: `${pct}%`,
        'background-image':
          'repeating-linear-gradient(135deg, $pink 0px, $pink 5px, $pink-hover 5px, $pink-hover 10px)',
      },
    },
  ],
});
export const factChip: Style = {
  'font-size': '13px',
  'font-weight': '600',
  padding: '4px 12px',
  'border-radius': '999px',
  'background-color': '$lavender-soft',
  'font-variant-numeric': 'tabular-nums',
};
export const posterSticker = (
  src: string,
  width: string,
  small: string,
  rotate: string,
  shadow: string,
  tape: Style,
  motion: string,
): Node => ({
  type: 'box',
  motion,
  style: { ...col, position: 'relative', 'flex-shrink': '0', width, 'aspect-ratio': '2 / 3', rotate },
  small: { width: small },
  children: [
    {
      type: 'box',
      style: {
        ...col,
        position: 'relative',
        width: '100%',
        height: '100%',
        'box-sizing': 'border-box',
        padding: '5px',
        border: '3px solid $ink',
        'border-radius': '20px',
        'background-color': '$card',
        'box-shadow': shadow,
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
          children: [{ type: 'image', src, alt: '', fade: true, style: fadeIn }],
        },
      ],
    },
    {
      type: 'box',
      style: { position: 'absolute', 'box-sizing': 'border-box', border: '2px solid $ink', ...tape },
    },
  ],
});

export const titleActions: Node = {
  type: 'box',
  motion: 'hop260',
  style: { ...col, gap: '20px', ...side, 'padding-top': '24px', 'max-width': '56rem' },
  small: { gap: '16px', ...sideSmall(20), 'padding-top': '16px' },
  children: [
    {
      type: 'text',
      when: [set('detail.summary')],
      text: '{detail.summary}',
      style: { 'font-size': '17px', 'line-height': '1.6', color: '$ink-soft' },
      small: { 'font-size': '15px' },
    },
    {
      type: 'box',
      style: { ...row, gap: '14px', 'align-items': 'center', 'flex-wrap': 'wrap' },
      children: [
        playButton('{detail.playLabel}', '{detail.playLabel}', '{detail.id}', false, [set('detail.canPlay')]),
        {
          type: 'repeat',
          over: 'detail.trailers',
          when: [set('extra.ready')],
          item: {
            type: 'box',
            press: { action: 'playExtra', arg: '{extra.id}' },
            label: '{s:watchTrailer}',
            style: { ...Puffy, height: '62px', 'padding-left': '22px', 'padding-right': '26px', gap: '10px' },
            small: { height: '56px' },
            ...puffy,
            children: [
              icon('star', 14),
              { type: 'text', text: '{s:watchTrailer}', style: { 'font-size': '16px' } },
            ],
          },
        },
      ],
    },
    {
      ...candyBar('{detail.resumePct}', '{s:watchProgress}', { width: '320px' }, { width: '70%' }),
      when: [set('detail.canPlay'), set('detail.hasResume')],
    } as Node,
  ],
};

export const titleHead: Node = {
  type: 'box',
  when: [ready],
  style: { ...col, position: 'relative' },
  children: [
    // The artwork frame.
    ...byAccent(
      'detail',
      a =>
        ({
          type: 'box',
          motion: 'pop0',
          style: {
            ...col,
            position: 'relative',
            margin: '22px 22px 0px',
            height: 'calc(clamp(300px, 46vh, 480px) + 6px)',
            'box-sizing': 'border-box',
            border: '3px solid $ink',
            'border-radius': '30px',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
            'background-color': `$${a}`,
            'box-shadow': '8px 9px 0px $lavender',
          },
          small: {
            margin: '0px',
            height: '263px',
            'border-width': '0px',
            'border-bottom-width': '3px',
            'border-radius': '0px 0px 28px 28px',
            'box-shadow': 'none',
          },
          children: [
            {
              type: 'image',
              when: [set('detail.backdrop')],
              src: '{detail.backdrop}',
              alt: '',
              fade: true,
              style: fadeIn,
            },
            {
              type: 'image',
              when: [not('detail.backdrop'), set('detail.poster')],
              src: '{detail.poster}',
              alt: '',
              style: {
                position: 'absolute',
                top: '-20%',
                left: '-20%',
                width: '140%',
                height: '140%',
                'object-fit': 'cover',
                filter: 'blur(50px) saturate(1.3)',
                opacity: '0.85',
              },
            },
            {
              type: 'box',
              style: {
                ...inset0,
                'background-image': 'linear-gradient(0deg, $scrim-soft 0%, $scrim-clear 55%)',
              },
            },
            {
              type: 'box',
              style: {
                ...col,
                position: 'absolute',
                top: '18px',
                left: '22px',
                color: '$butter',
                filter: 'drop-shadow(2px 2px 0px $ink)',
              },
              children: [twinkle('butter', 22)],
            },
          ],
        }) as Node,
    ),
    // The poster sticker and the title copy.
    {
      type: 'box',
      style: {
        ...row,
        position: 'relative',
        gap: '36px',
        ...side,
        'margin-top': '-130px',
        'align-items': 'flex-end',
      },
      small: {
        'flex-direction': 'column',
        gap: '16px',
        ...sideSmall(20),
        'margin-top': '-96px',
        'align-items': 'flex-start',
      },
      children: [
        {
          ...posterSticker(
            '{detail.poster}',
            'clamp(170px, 15vw, 230px)',
            '128px',
            '-3',
            '7px 8px 0px $shadow-pink',
            {
              top: '-11px',
              left: '34%',
              ...sz(56, 20),
              rotate: '6',
              'background-color': '$butter',
              opacity: '0.9',
            },
            'pop120',
          ),
          when: [set('detail.poster')],
        } as Node,
        {
          type: 'box',
          motion: 'hop160',
          style: { ...col, gap: '14px', flex: '1', 'min-width': '0px', 'padding-bottom': '6px' },
          small: { gap: '12px', 'padding-bottom': '0px' },
          children: [
            {
              type: 'box',
              style: { ...row, gap: '8px', 'align-items': 'center', 'flex-wrap': 'wrap' },
              children: [
                {
                  type: 'text',
                  text: '{detail.kindLabel}',
                  style: {
                    ...Label,
                    'font-size': '11px',
                    padding: '4px 10px',
                    'border-radius': '999px',
                    'background-color': '$mint',
                    border: '2px solid $ink',
                  },
                },
                {
                  type: 'repeat',
                  over: 'detail.mediaFacts',
                  item: {
                    type: 'text',
                    text: '{fact.text}',
                    style: {
                      ...Label,
                      'font-size': '11px',
                      padding: '4px 10px',
                      'border-radius': '8px',
                      'background-color': '$card',
                      border: '2px solid $ink',
                    },
                  },
                },
              ],
            },
            // Phones show the logo when there is one; wider screens always set the name.
            {
              type: 'image',
              when: [set('detail.logo'), set('env.small')],
              src: '{detail.logo}',
              alt: '{detail.name}',
              role: 'heading',
              level: 1,
              style: {
                height: '80px',
                width: '80%',
                'max-width': '85%',
                'object-fit': 'contain',
                'align-self': 'flex-start',
              },
            },
            {
              type: 'text',
              when: [not('env.small')],
              text: '{detail.name}',
              role: 'heading',
              level: 1,
              style: { ...Title, 'font-size': '54px' },
            },
            {
              type: 'text',
              when: [set('env.small'), not('detail.logo')],
              text: '{detail.name}',
              role: 'heading',
              level: 1,
              style: { ...Title, 'font-size': '34px' },
            },
            { type: 'use', template: 'velaEpisodeContext' },
            {
              type: 'box',
              style: { ...row, gap: '6px', 'flex-wrap': 'wrap' },
              children: [
                { type: 'text', when: [set('detail.facts')], text: '{detail.facts}', style: factChip },
                {
                  type: 'repeat',
                  over: 'detail.genres',
                  limit: 4,
                  item: { type: 'text', text: '{genre.text}', style: factChip },
                },
              ],
            },
          ],
        },
      ],
    },
    titleActions,
  ],
};

// One episode as a white card (detail.contract EpisodeCard): a still that tilts and shows
// a play bubble, then its text; the whole card lifts while pointed at or focused.
export const episodeBase: Style = {
  ...row,
  position: 'relative',
  gap: '20px',
  'align-items': 'center',
  padding: '14px',
  'border-radius': '22px',
  'background-color': '$card',
  border: '2.5px solid $ink',
  'box-shadow': '3px 3px 0px $shadow',
  translate: '0px 0px',
  transition: lift,
};
export const episodeUp: Style = { 'box-shadow': '5px 6px 0px $shadow', translate: '0px -3px' };
export const thumbBase = (a: Accent): Style => ({
  ...col,
  position: 'relative',
  // A 200x112.5 still inside its edge (124x69.75 on phones).
  width: '204px',
  'aspect-ratio': '204 / 116.5',
  'box-sizing': 'border-box',
  border: '2.5px solid $ink',
  'border-radius': '14px',
  'overflow-x': 'hidden',
  'overflow-y': 'hidden',
  'background-color': `$${a}`,
  color: '$ink',
  'flex-shrink': '0',
  cursor: 'pointer',
  rotate: '0',
  transition: lift,
});
export const episodeCard: Node = {
  type: 'box',
  group: true,
  motion: 'hop0',
  stagger: { step: 40, cap: 8 },
  style: episodeBase,
  states: [{ when: [stillC], style: { ...episodeBase, transition: liftStill } }],
  small: { gap: '12px', 'align-items': 'flex-start', padding: '10px' },
  hover: episodeUp,
  groupFocus: episodeUp,
  children: [
    {
      type: 'box',
      press: { action: 'select', arg: '{card.kindId}' },
      label: '{card.label}',
      testId: 'episode-{card.id}',
      style: thumbBase('pink'),
      states: [true, false].flatMap(still =>
        ACCENTS.map((a, i) => ({
          when: [...(still ? [stillC] : []), mod('card', 3, i)],
          style: still ? { ...thumbBase(a), transition: liftStill } : thumbBase(a),
        })),
      ),
      small: { width: '128px', 'aspect-ratio': '128 / 73.75' },
      groupHover: { rotate: '-1.5' },
      groupFocus: { rotate: '-1.5' },
      focus: { outline: 'auto', 'box-shadow': ring },
      children: [
        {
          type: 'image',
          when: [set('card.backdrop')],
          src: '{card.backdrop}',
          alt: '',
          fade: true,
          style: fadeIn,
        },
        {
          type: 'box',
          when: [not('card.backdrop')],
          style: { ...col, ...inset0, 'align-items': 'center', 'justify-content': 'center' },
          children: [
            {
              type: 'text',
              when: [set('card.episodeNumberLabel')],
              text: '{card.episodeNumberLabel}',
              style: { ...Pixel, 'font-size': '30px' },
              small: { 'font-size': '24px' },
            },
            {
              type: 'text',
              when: [not('card.episodeNumberLabel')],
              text: '{s:episode}',
              style: { ...Pixel, 'font-size': '30px' },
              small: { 'font-size': '24px' },
            },
          ],
        },
        {
          type: 'box',
          style: {
            ...col,
            ...inset0,
            'align-items': 'center',
            'justify-content': 'center',
            'background-color': '$scrim-soft',
            opacity: '0',
            transition: 'opacity 200ms linear',
          },
          groupHover: { opacity: '1' },
          groupFocus: { opacity: '1' },
          children: [
            {
              type: 'box',
              style: {
                ...row,
                'align-items': 'center',
                'justify-content': 'center',
                ...sz(42),
                'border-radius': '21px',
                'background-color': '$pink',
                border: '2.5px solid $ink',
                'box-sizing': 'border-box',
                scale: '0.7',
                transition: lift,
              },
              states: [
                {
                  when: [stillC],
                  style: {
                    ...row,
                    'align-items': 'center',
                    'justify-content': 'center',
                    ...sz(42),
                    'border-radius': '21px',
                    'background-color': '$pink',
                    border: '2.5px solid $ink',
                    'box-sizing': 'border-box',
                    scale: '0.7',
                    transition: liftStill,
                  },
                },
              ],
              groupHover: { scale: '1' },
              groupFocus: { scale: '1' },
              children: [icon('play', 14)],
            },
          ],
        },
        {
          type: 'box',
          when: [set('card.played')],
          style: {
            ...row,
            position: 'absolute',
            top: '6px',
            right: '6px',
            ...sz(22),
            'border-radius': '11px',
            'align-items': 'center',
            'justify-content': 'center',
            'background-color': '$mint',
            border: '2px solid $ink',
            'box-sizing': 'border-box',
          },
          children: [icon('check', 10)],
        },
        {
          type: 'box',
          when: [set('card.hasProgress')],
          style: { ...col, position: 'absolute', left: '8px', right: '8px', bottom: '8px' },
          children: [candyBar('{card.progressPct}', '{s:watchProgressOf} {card.name}', { width: '100%' })],
        },
      ],
    },
    {
      type: 'box',
      style: { ...col, flex: '1', 'min-width': '0px', gap: '5px' },
      children: [
        {
          type: 'box',
          style: { ...row, gap: '8px', 'align-items': 'center', 'min-width': '0px' },
          children: [
            {
              type: 'text',
              when: [set('card.episodeNumberLabel')],
              text: '{card.episodeNumberLabel}',
              style: {
                ...Pixel,
                'font-size': '13px',
                padding: '1px 8px',
                'border-radius': '8px',
                'background-color': '$lavender-soft',
                'flex-shrink': '0',
              },
            },
            {
              type: 'text',
              text: '{card.name}',
              role: 'heading',
              level: 3,
              style: { 'font-size': '18px', 'font-weight': '650', 'line-clamp': '2' },
              small: { 'font-size': '15px' },
            },
          ],
        },
        {
          type: 'text',
          when: [not('card.played')],
          text: '{card.facts}',
          style: { color: '$ink-soft', 'font-size': '13px', 'font-variant-numeric': 'tabular-nums' },
        },
        {
          type: 'text',
          when: [set('card.played')],
          text: '{card.facts} · {s:watched}',
          style: { color: '$ink-soft', 'font-size': '13px', 'font-variant-numeric': 'tabular-nums' },
        },
        {
          type: 'text',
          when: [set('card.summary'), not('env.small')],
          text: '{card.summary}',
          style: {
            color: '$ink-soft',
            'font-size': '14px',
            'line-clamp': '2',
            'line-height': '1.5',
            'max-width': '46rem',
          },
        },
      ],
    },
    {
      type: 'box',
      when: [not('env.small')],
      press: { action: 'play', arg: '{card.id}' },
      label: '{s:play} {card.name}',
      style: { ...Bubble, ...sz(46), 'background-color': '$pink-soft' },
      ...bubble,
      children: [icon('play', 15)],
    },
  ],
};

export const upNext: Node = {
  type: 'repeat',
  over: 'detail.upNext',
  item: {
    type: 'box',
    style: {
      ...row,
      'align-items': 'center',
      gap: '22px',
      padding: '18px',
      'border-radius': '26px',
      'background-color': '$butter-soft',
      border: '3px solid $ink',
      'box-shadow': '6px 7px 0px $butter',
    },
    small: { 'flex-direction': 'column', 'align-items': 'stretch', gap: '14px', padding: '14px' },
    children: [
      {
        type: 'box',
        when: [set('card.backdrop')],
        style: {
          ...col,
          position: 'relative',
          width: '240px',
          'aspect-ratio': '16 / 9',
          'border-radius': '16px',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          border: '3px solid $ink',
          'box-sizing': 'border-box',
          'flex-shrink': '0',
        },
        small: { width: '100%' },
        children: [{ type: 'image', src: '{card.backdrop}', alt: '', fade: true, style: fadeIn }],
      },
      {
        type: 'box',
        style: { ...col, gap: '6px', flex: '1', 'min-width': '0px' },
        children: [
          {
            type: 'text',
            text: '{episode.upNextLabel}',
            style: { ...Label, 'font-size': '11px', color: '$pink-deep' },
          },
          {
            type: 'text',
            text: '{episode.numberTitle}',
            role: 'heading',
            level: 3,
            style: { ...Title, 'font-size': '28px' },
            small: { 'font-size': '22px' },
          },
          {
            type: 'text',
            when: [set('card.facts')],
            text: '{card.facts}',
            style: { 'font-size': '13px', color: '$ink-soft' },
          },
        ],
      },
      playButton('{episode.playLabel}', '{s:resume} {card.name}', '{card.id}', true, [
        set('card.hasProgress'),
      ]),
      playButton('{episode.playLabel}', '{s:play} {card.name}', '{card.id}', true, [not('card.hasProgress')]),
    ],
  },
};

// Season tabs light at once when picked; the episodes dim until the foundation answers.
export const seasonPill: Style = {
  ...row,
  position: 'relative',
  'align-items': 'center',
  height: '46px',
  'box-sizing': 'border-box',
  padding: '0px 18px',
  border: '2.5px solid $ink',
  'border-radius': '999px',
  color: '$ink',
  'font-family': fredoka,
  'font-weight': '600',
  'flex-shrink': '0',
  cursor: 'pointer',
  'background-color': '$card',
  'box-shadow': '0px 2px 0px $ink',
};
export const episodeList: Style = { ...col, gap: '14px', transition: 'opacity 200ms linear' };
export const episodesBody: Node[] = [
  sectionHeading('{s:episodes}', 'Episodes', 'layers'),
  {
    type: 'box',
    when: [{ test: 'detail.seasonCount', is: 'gt', value: '1' }],
    style: { ...row, 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' },
    small: { 'margin-left': '-16px', 'margin-right': '-16px' },
    children: [
      {
        type: 'box',
        role: 'group',
        label: '{s:season}',
        testId: 'season-picker',
        style: { ...row, gap: '10px', padding: '4px 16px 8px' },
        children: [
          {
            type: 'repeat',
            over: 'detail.seasons',
            item: {
              type: 'box',
              press: { action: 'select', arg: '{season.pick}' },
              label: '{card.name}',
              a11y: { pressed: [set('season.on')] },
              style: seasonPill,
              states: [
                {
                  when: [set('season.on')],
                  style: { ...seasonPill, 'background-color': '$pink', 'box-shadow': '0px 4px 0px $ink' },
                },
              ],
              hover: { scale: '1.05' },
              focus: { outline: 'auto', 'box-shadow': ring },
              active: press94,
              children: [{ type: 'text', text: '{card.name}', style: { 'font-size': '15px' } }],
            },
          },
        ],
      },
    ],
  },
  upNext,
  {
    type: 'box',
    style: episodeList,
    small: { gap: '12px' },
    states: [{ when: [set('detail.seasonPending')], style: { ...episodeList, opacity: '0.5' } }],
    children: [{ type: 'repeat', over: 'detail.episodes', item: episodeCard }],
  },
];
// Shown when the title has seasons or episodes (two conditions, so two entries).
export const episodesSection = (when: Condition[]): Node => ({
  type: 'box',
  when: [ready, ...when],
  motion: 'hop380',
  style: { ...col, ...side, gap: '22px' },
  small: { ...sideSmall(16), gap: '16px' },
  children: episodesBody,
});

export const extraTile = (readyTile: boolean): Node =>
  ({
    type: 'box',
    when: [readyTile ? set('extra.ready') : not('extra.ready')],
    ...(readyTile
      ? { press: { action: 'playExtra', arg: '{extra.id}' }, label: '{s:play} {extra.name}', ...puffy }
      : { role: 'group', label: '{extra.name} · {s:notAvailable}' }),
    style: {
      ...Puffy,
      'justify-content': 'flex-start',
      'border-radius': '22px',
      width: '308px',
      height: '76px',
      padding: '12px',
      'flex-shrink': '0',
      gap: '14px',
      ...(readyTile ? {} : { opacity: '0.5', 'box-shadow': 'none', cursor: 'default' }),
    },
    small: { width: '258px', height: '72px' },
    children: [
      {
        type: 'box',
        style: {
          ...row,
          'align-items': 'center',
          'justify-content': 'center',
          ...sz(42),
          'border-radius': '21px',
          'background-color': readyTile ? '$pink' : '$lavender-soft',
          border: '2.5px solid $ink',
          'box-sizing': 'border-box',
        },
        children: [icon(readyTile ? 'play' : 'lock', 14)],
      },
      {
        type: 'box',
        style: { ...col, gap: '4px', flex: '1', 'min-width': '0px', 'text-align': 'left' },
        children: [
          {
            type: 'text',
            text: '{extra.name}',
            style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '2' },
          },
          ...(readyTile
            ? []
            : [
                {
                  type: 'text',
                  text: '{s:notAvailableYet}',
                  style: { 'font-size': '12px', color: '$ink-soft' },
                } as Node,
              ]),
        ],
      },
    ],
  }) as Node;

export const extras: Node = {
  type: 'box',
  when: [ready, set('detail.hasExtras')],
  motion: 'hop420',
  style: { ...col, gap: '14px' },
  children: [
    {
      type: 'box',
      style: { ...col, 'padding-left': 'max(48px, 5vw)' },
      small: { 'padding-left': '16px' },
      children: [sectionHeading('{s:extras}', 'Extras', 'star')],
    },
    {
      type: 'box',
      style: {
        ...row,
        'overflow-x': 'auto',
        'overflow-y': 'hidden',
        'scrollbar-width': 'none',
        gap: '16px',
        ...side,
        'padding-top': '6px',
        'padding-bottom': '14px',
      },
      small: sideSmall(16),
      children: [
        { type: 'repeat', over: 'detail.extras', item: extraTile(true) },
        { type: 'repeat', over: 'detail.extras', item: extraTile(false) },
      ],
    },
  ],
};

export const cast: Node = {
  type: 'box',
  when: [ready, set('detail.hasCast')],
  motion: 'hop460',
  style: { ...col, gap: '14px', ...side },
  small: sideSmall(16),
  children: [
    sectionHeading('{s:featuring}', 'Featuring', 'heart'),
    {
      type: 'box',
      style: { ...row, gap: '10px', 'flex-wrap': 'wrap' },
      children: [
        {
          type: 'repeat',
          over: 'detail.cast',
          item: {
            type: 'box',
            press: { action: 'person', arg: '{person.name}' }, label: '{person.name}', focus: { 'box-shadow': '0px 0px 0px 4px $ui.accent' },
            style: {
              ...row,
              gap: '10px',
              'align-items': 'center',
              padding: '5px 16px 5px 5px',
              'border-radius': '999px',
              'background-color': '$card',
              border: '2.5px solid $ink',
              'box-shadow': '0px 3px 0px $ink',
            },
            children: [
              ...byAccent('person', a => ({
                type: 'text',
                text: '{person.initials}',
                style: {
                  ...sz(30),
                  'border-radius': '15px',
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'center',
                  'font-family': pixelFace,
                  'font-size': '14px',
                  'font-weight': '700',
                  'background-color': `$${a}`,
                },
              })),
              { type: 'text', text: '{person.name}', style: { 'font-size': '15px', 'font-weight': '550' } },
            ],
          },
        },
      ],
    },
  ],
};

export const crew: Node = {
  type: 'box',
  when: [ready, set('detail.crewLine')],
  motion: 'hop480',
  style: { ...col, gap: '12px', ...side },
  small: sideSmall(16),
  children: [
    sectionHeading('{s:behindTheStory}', 'Behind the story', 'sparkle'),
    {
      type: 'text',
      text: '{detail.crewLine}',
      style: { 'font-size': '15px', color: '$ink-soft', 'line-height': '1.7', 'max-width': '48rem' },
    },
  ],
};

export const related: Node = {
  type: 'repeat',
  over: 'detail.related',
  when: [ready],
  item: { type: 'use', template: 'relatedShelf', motion: 'hop500' } as Node,
};

// The title page opens as a framed page over the route frame's blurred scrim (detail.frame),
// with an ink-ringed close button.
// The frame wears an ink edge and a hard lavender shadow (the compiled detailShadow trait).
// The page fills the route, as the base's does.
export const title: Node = {
  type: 'box',
  style: { ...col, position: 'absolute', inset: '0px' },
  children: [
    {
      type: 'box',
      // In flow: a route root's children scroll in the route's scroll view, where an absolute
      // box has no height.
      style: { ...col, flex: '1', 'box-sizing': 'border-box', padding: '4vh 4vw', color: '$ink' },
      small: { padding: '0px' },
      children: [
        {
          type: 'box',
          motion: 'pageOpen',
          style: {
            ...col,
            position: 'relative',
            flex: '1',
            'min-height': '0px',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
            'border-radius': '28px',
            'background-color': '$page',
            'box-shadow': '0px 0px 0px 3px $ink, 10px 12px 0px 3px $lavender',
          },
          small: { 'border-radius': '0px', 'box-shadow': 'none' },
          children: [
            {
              type: 'box',
              id: 'back',
              press: { action: 'back' },
              label: '{s:closeTitle}',
              testId: 'detail-close',
              style: {
                position: 'absolute',
                top: '20px',
                right: '20px',
                'z-index': '10',
                ...sz(44),
                'box-sizing': 'border-box',
                padding: '13px',
                border: '3px solid $ink',
                'border-radius': '22px',
                'background-color': '$card',
                'backdrop-filter': 'blur(20px) saturate(1.3)',
                color: '$ink',
              },
              // The glyph keeps its 18px size inside the 12px content box (as the foundation's close does).
              children: [{ type: 'icon', symbol: 'close', style: { ...sz(18) } }],
            },
            {
              type: 'box',
              id: '{env.route}-scroll-{env.entry}',
              role: 'region',
              label: '{s:titleDetails}',
              style: {
                ...col,
                flex: '1',
                'min-height': '0px',
                'overflow-y': 'auto',
                'overflow-x': 'hidden',
                gap: '46px',
                'padding-bottom': '72px',
                color: '$ink',
                'font-family': fredoka,
              },
              small: { gap: '34px' },
              children: [
                // Opening: Mochi hopping where the page will be; failed: a sad Mochi.
                {
                  type: 'box',
                  when: [is('env.load', 'loading')],
                  role: 'status',
                  label: '{s:openingTitle}',
                  motion: 'statusIn',
                  style: { ...col, gap: '34px' },
                  small: { gap: '26px' },
                  children: [
                    {
                      type: 'box',
                      style: {
                        ...col,
                        position: 'relative',
                        height: '70vh',
                        'border-radius': '34px',
                        'align-items': 'center',
                        'justify-content': 'center',
                        'box-sizing': 'border-box',
                      },
                      small: { 'border-radius': '26px' },
                      children: [
                        { ...loader('{s:openingTitle}', 80), small: { display: 'none' } } as Node,
                        {
                          ...loader('{s:openingTitle}', 64),
                          style: { display: 'none' },
                          small: { ...col, 'align-items': 'center', gap: '14px' },
                        } as Node,
                      ],
                    },
                  ],
                },
                failed('{s:titleFailed}'),
                titleHead,
                episodesSection([set('detail.hasEpisodes')]),
                episodesSection([not('detail.hasEpisodes'), set('detail.hasSeasons')]),
                extras,
                cast,
                crew,
                related,
              ],
            },
          ],
        },
      ],
    },
  ],
};

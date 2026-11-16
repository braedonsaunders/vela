// The flat title page: poster beside the facts, then seasons, episodes, extras, cast and crew.
import type { Condition, Node, Style } from '../../../skin';
import {
  sans,
  bar,
  gutter,
  gutterSmall,
  fill,
  px,
  is,
  isnt,
  set,
  unset,
  glyph,
  ring,
  primary,
  secondary,
  label,
  oneLine,
} from './look';
import { block, art, progress, corner, subLine, posterArt } from './cards';
import { failure } from './home';

const heading2: Style = { 'font-size': '19px', 'font-weight': '700', ...gutter };
const heading2Small: Style = { 'font-size': '17px', ...gutterSmall };
const section = (
  show: Condition[],
  title: string,
  body: Node,
  pad = { normal: '30px', small: '20px' },
): Node => ({
  type: 'box',
  when: show,
  style: { display: 'flex', 'flex-direction': 'column', gap: '14px', 'padding-bottom': pad.normal },
  small: { gap: '10px', 'padding-bottom': pad.small },
  children: [
    { type: 'text', text: title, role: 'heading', level: 2, style: heading2, small: heading2Small },
    body,
  ],
});
const shelf = (
  gap: number,
  gapSmall: number,
  item: Node,
  over: string,
  track: Partial<Node> = {},
  top = '0px',
): Node => ({
  type: 'box',
  style: {
    display: 'flex',
    width: '0px',
    'min-width': '100%',
    'overflow-x': 'auto',
    'overflow-y': 'hidden',
    'scrollbar-width': 'none',
  },
  children: [
    {
      type: 'box',
      ...track,
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: px(gap),
        ...gutter,
        'padding-top': top,
        'padding-bottom': '4px',
      },
      small: { gap: px(gapSmall), ...gutterSmall },
      children: [{ type: 'repeat', over, item }],
    } as Node,
  ],
});

const poster: Node = {
  type: 'box',
  style: {
    position: 'relative',
    width: 'clamp(220px, 21vw, 300px)',
    'flex-shrink': '0',
    'aspect-ratio': '2 / 3',
    'border-radius': '6px',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    'background-color': '$raised',
    'box-shadow': '0px 18px 50px $shadow',
  },
  small: { width: '38%' },
  children: [
    { ...art('{detail.poster}'), when: [set('detail.poster')] },
    {
      type: 'box',
      when: [unset('detail.poster')],
      style: {
        ...fill,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        color: '$ink-faint',
      },
      children: [
        glyph('film', 40, { when: [is('detail.kind', 'movie')] }),
        glyph('tv', 40, { when: [isnt('detail.kind', 'movie')] }),
      ],
    },
    {
      type: 'box',
      when: [set('detail.hasProgress')],
      style: {
        position: 'absolute',
        left: '0px',
        right: '0px',
        bottom: '0px',
        height: '5px',
        'background-color': '$scrim',
      },
      children: [
        {
          type: 'box',
          style: { height: '5px', width: '{detail.progressPct}%', 'background-color': '$amber' },
        },
      ],
    },
  ],
};
const bigButton = (extra: Partial<Node>, children: Node[]): Node =>
  ({
    type: 'box',
    testId: 'detail-play',
    ...primary(48, '0px 26px'),
    style: { ...primary(48, '0px 26px').style, gap: '10px' },
    small: { height: '46px', 'flex-grow': '1' },
    ...extra,
    children,
  }) as Node;
const playText = (text: string, when: Condition[] = []): Node => ({
  type: 'text',
  when,
  text,
  style: { 'font-size': '16px' },
});
// A playable title: Play, or Resume from where it was left.
const playButton = bigButton(
  {
    when: [set('detail.canPlay')],
    press: { action: 'play', arg: '{detail.id}' },
    label: '{detail.playLabel}',
  },
  [
    glyph('play', 18),
    playText('{s:resumeFrom}', [set('detail.hasResume')]),
    playText('{s:play}', [unset('detail.hasResume')]),
  ],
);
// A show or season: the first episode not yet watched, by its number.
const upNextFor = (resumed: boolean): Node =>
  bigButton(
    {
      when: [{ test: 'card.hasProgress', not: !resumed }],
      press: { action: 'play', arg: '{card.id}' },
      label: resumed ? '{s:resumeTitle}' : '{s:playTitle}',
    },
    [
      glyph('play', 18),
      ...subLine({ 'font-size': '16px' }, {}, '').map(
        (n) => ({ ...n, text: `{s:play} ${(n as { text: string }).text}` }) as Node,
      ),
      playText('{s:play}', [
        is('card.kind', 'episode'),
        { test: 'card.episodeNumber', is: 'gt', value: '0', not: true },
        unset('card.yearLabel'),
      ]),
    ],
  );
const upNextButton: Node = {
  type: 'repeat',
  over: 'detail.upNext',
  when: [unset('detail.canPlay')],
  item: {
    type: 'box',
    style: { display: 'flex' },
    small: { 'flex-grow': '1' },
    children: [upNextFor(true), upNextFor(false)],
  },
};
const trailerButton: Node = {
  type: 'repeat',
  over: 'detail.trailers',
  limit: 1,
  item: {
    type: 'box',
    press: { action: 'playExtra', arg: '{extra.id}' },
    label: '{s:watchTrailer}',
    ...secondary(48, '0px 20px'),
    small: { height: '46px' },
    children: [glyph('film', 18), { type: 'text', text: '{s:watchTrailer}', style: { 'font-size': '15px' } }],
  } as Node,
};
// Rating and running time (wide), and whether it has been watched.
const factRow: Node = {
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'row',
    gap: '10px',
    'align-items': 'center',
    'flex-wrap': 'wrap',
  },
  small: { display: 'none' },
  states: [
    {
      when: [set('detail.played')],
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '10px',
        'align-items': 'center',
        'flex-wrap': 'wrap',
      },
    },
  ],
  children: [
    {
      type: 'text',
      when: [set('detail.rating')],
      text: '{detail.rating}',
      style: {
        'font-size': '12px',
        'font-weight': '700',
        padding: '2px 6px',
        border: '1px solid $ink-faint',
        'border-radius': '3px',
        color: '$ink-dim',
      },
      small: { display: 'none' },
    },
    {
      type: 'text',
      when: [set('detail.durationLabel')],
      text: '{detail.durationLabel}',
      style: { 'font-size': '15px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' },
      small: { display: 'none' },
    },
    {
      type: 'box',
      when: [set('detail.played')],
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '6px',
        'align-items': 'center',
        color: '$ink-dim',
      },
      children: [glyph('check', 16), { type: 'text', text: '{s:watched}', style: { 'font-size': '14px' } }],
    },
  ],
} as Node;
const facts: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column', gap: '16px' },
  small: { gap: '14px' },
  children: [
    factRow,
    {
      type: 'box',
      role: 'list',
      label: '{s:genres}',
      when: [set('detail.genresLine')],
      style: { display: 'flex', 'flex-direction': 'row', gap: '8px', 'flex-wrap': 'wrap' },
      children: [
        {
          type: 'repeat',
          over: 'detail.genres',
          item: {
            type: 'text',
            role: 'listitem',
            text: '{genre.text}',
            style: {
              'font-size': '13px',
              'font-weight': '600',
              padding: '5px 12px',
              'border-radius': '999px',
              'background-color': '$control',
              color: '$ink',
            },
          },
        },
      ],
    },
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '10px',
        'align-items': 'center',
        'flex-wrap': 'wrap',
        'margin-top': '4px',
      },
      children: [playButton, upNextButton, trailerButton],
    },
    {
      type: 'box',
      when: [set('detail.hasResume')],
      role: 'progressbar',
      label: '{s:watchProgress}',
      style: {
        width: '280px',
        height: '4px',
        'border-radius': '2px',
        'background-color': '$track',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
      },
      small: { width: '100%' },
      children: [
        { type: 'box', style: { height: '4px', width: '{detail.resumePct}%', 'background-color': '$amber' } },
      ],
    },
    {
      type: 'text',
      when: [set('detail.summary')],
      text: '{detail.summary}',
      style: { 'font-size': '16px', 'line-height': '1.6', color: '$ink', 'max-width': '52rem' },
      small: { 'font-size': '15px' },
    },
    {
      type: 'box',
      when: [set('detail.hasMediaFacts')],
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '12px',
        'align-items': 'baseline',
        'flex-wrap': 'wrap',
      },
      children: [
        { type: 'text', text: '{s:media}', style: label },
        {
          type: 'repeat',
          over: 'detail.mediaFacts',
          item: {
            type: 'text',
            text: '{fact.text}',
            style: { 'font-size': '13px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' },
          },
        },
      ],
    },
  ],
};

const seasonCard: Node = {
  type: 'box',
  press: { action: 'select', arg: '{season.pick}' },
  label: '{card.name}',
  testId: 'season-{card.id}',
  style: {
    position: 'relative',
    outline: 'auto',
    display: 'flex',
    'flex-direction': 'column',
    'flex-shrink': '0',
    width: '140px',
    'border-radius': '4px',
    color: '$ink',
  },
  small: { width: '104px' },
  hover: { opacity: '0.9' },
  focus: { 'box-shadow': ring('$amber') },
  children: [
    {
      type: 'box',
      style: {
        position: 'relative',
        width: '100%',
        'aspect-ratio': '2 / 3',
        'border-radius': '4px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$raised',
      },
      children: [
        ...posterArt,
        {
          type: 'box',
          when: [unset('card.poster'), unset('card.backdrop')],
          style: {
            ...fill,
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            color: '$ink-faint',
          },
          children: [glyph('tv', 28)],
        },
        {
          type: 'box',
          when: [set('season.on')],
          style: { ...fill, 'border-radius': '4px', 'box-shadow': 'inset 0px 0px 0px 3px $amber' },
        },
        {
          type: 'box',
          when: [unset('season.on')],
          style: { ...fill, 'border-radius': '4px', 'box-shadow': 'inset 0px 0px 0px 1px $line' },
        },
      ],
    },
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '2px', 'padding-top': '8px' },
      children: [
        {
          type: 'text',
          when: [set('season.on')],
          text: '{card.name}',
          style: { 'font-size': '14px', 'font-weight': '700', color: '$amber', ...oneLine },
          small: { 'font-size': '13px' },
        },
        {
          type: 'text',
          when: [unset('season.on')],
          text: '{card.name}',
          style: { 'font-size': '14px', 'font-weight': '600', color: '$ink', ...oneLine },
          small: { 'font-size': '13px' },
        },
        {
          type: 'text',
          when: [set('card.yearLabel')],
          text: '{card.yearLabel}',
          style: { 'font-size': '13px', color: '$ink-faint', 'font-variant-numeric': 'tabular-nums' },
        },
      ],
    },
  ],
};

// An episode: its still plays it (hover or focus shows the amber play); its title opens it.
const still = (resumed: boolean): Node =>
  ({
    type: 'box',
    group: true,
    when: [{ test: 'card.hasProgress', not: !resumed }],
    press: { action: 'play', arg: '{card.id}' },
    label: resumed ? '{s:resumeTitle}' : '{s:playTitle}',
    testId: 'episode-{card.id}',
    style: {
      position: 'relative',
      width: '100%',
      'flex-shrink': '0',
      'aspect-ratio': '16 / 9',
      'border-radius': '4px',
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
      'background-color': '$raised',
      outline: 'none',
    },
    small: { width: '148px' },
    children: [
      { ...art('{card.backdrop}'), when: [set('card.backdrop')] },
      {
        type: 'box',
        when: [unset('card.backdrop')],
        style: {
          ...fill,
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          color: '$ink-faint',
        },
        children: [glyph('tv', 28)],
      },
      corner(20),
      progress(4, '{card.progressPct}', [set('card.hasProgress')]),
      {
        type: 'box',
        style: {
          ...fill,
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'background-color': '$scrim-soft',
          opacity: '0',
          transition: 'opacity 120ms linear',
        },
        groupHover: { opacity: '1' },
        groupFocus: { opacity: '1' },
        children: [
          {
            type: 'box',
            style: {
              display: 'flex',
              width: '50px',
              height: '50px',
              'border-radius': '999px',
              'align-items': 'center',
              'justify-content': 'center',
              'background-color': '$amber',
              color: '$on-amber',
              'padding-left': '3px',
              'box-sizing': 'border-box',
            },
            small: { width: '38px', height: '38px' },
            children: [glyph('play', 22, { small: { width: '18px', height: '18px' } })],
          },
        ],
      } as Node,
      {
        type: 'box',
        style: {
          ...fill,
          'border-radius': '4px',
          'box-shadow': 'inset 0px 0px 0px 3px $amber',
          opacity: '0',
        },
        groupHover: { opacity: '1' },
        groupFocus: { opacity: '1' },
      } as Node,
    ],
  }) as Node;
// Number and running time: "S1 · E2 · 3 min".
const metaStyle: Style = { 'font-size': '13px', color: '$ink-faint', 'font-variant-numeric': 'tabular-nums' };
const noSubLine: Condition[][] = [
  [isnt('card.kind', 'episode'), unset('card.yearLabel')],
  [
    is('card.kind', 'episode'),
    { test: 'card.episodeNumber', is: 'gt', value: '0', not: true },
    unset('card.yearLabel'),
  ],
];
const episodeMeta: Node[] = [
  ...subLine(metaStyle, {}, ' · {card.durationLabel}').map(
    (n) => ({ ...n, when: [...(n.when ?? []), set('card.durationLabel')] }) as Node,
  ),
  ...subLine(metaStyle, {}).map(
    (n) => ({ ...n, when: [...(n.when ?? []), unset('card.durationLabel')] }) as Node,
  ),
  ...noSubLine.map((w): Node => ({
    type: 'text',
    when: [...w, set('card.durationLabel')],
    text: '{card.durationLabel}',
    style: metaStyle,
  })),
];
const episodeCard: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column', gap: '10px', 'align-items': 'stretch' },
  small: { 'flex-direction': 'row', gap: '12px', 'align-items': 'flex-start' },
  children: [
    still(true),
    still(false),
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '3px', 'min-width': '0px', flex: '1' },
      children: [
        {
          type: 'box',
          press: { action: 'select', arg: '{card.kindId}' },
          label: '{card.label}',
          style: { position: 'relative', outline: 'auto', color: '$ink' },
          hover: { color: '$amber' },
          focus: { 'box-shadow': ring('$amber') },
          children: [
            {
              type: 'text',
              text: '{card.name}',
              style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '1' },
              small: { 'font-size': '14px', 'line-clamp': '2' },
            },
          ],
        },
        ...episodeMeta,
        {
          type: 'text',
          when: [set('card.summary')],
          text: '{card.summary}',
          style: {
            'font-size': '13px',
            color: '$ink-dim',
            'line-height': '1.5',
            'line-clamp': '2',
            'margin-top': '2px',
          },
          small: { display: 'none' },
        },
      ],
    },
  ],
};

const extraCard: Node = {
  type: 'box',
  press: { action: 'playExtra', arg: '{extra.id}' },
  label: '{extra.name}',
  style: {
    position: 'relative',
    outline: 'auto',
    display: 'flex',
    'flex-direction': 'column',
    'flex-shrink': '0',
    width: '260px',
    color: '$ink',
  },
  small: { width: '200px' },
  hover: { color: '$amber' },
  focus: { 'box-shadow': ring('$amber') },
  children: [
    {
      type: 'box',
      style: {
        position: 'relative',
        display: 'flex',
        width: '100%',
        'aspect-ratio': '16 / 9',
        'border-radius': '4px',
        'align-items': 'center',
        'justify-content': 'center',
        'background-image': 'linear-gradient(160deg, $raised 0%, $chrome 100%)',
      },
      children: [
        {
          type: 'box',
          when: [set('extra.ready')],
          style: {
            display: 'flex',
            width: '44px',
            height: '44px',
            'border-radius': '999px',
            'align-items': 'center',
            'justify-content': 'center',
            'background-color': '$control',
            'padding-left': '3px',
            'box-sizing': 'border-box',
            color: '$ink',
          },
          children: [glyph('play', 20)],
        },
        glyph('film', 28, { when: [unset('extra.ready')], style: { color: '$ink-faint' } }),
      ],
    },
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '2px', 'padding-top': '8px' },
      children: [
        {
          type: 'text',
          text: '{extra.name}',
          style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1' },
        },
        // The extra's kind. (The compiled original fell through to "Collection" here; this is the intended label.)
        ...(
          [
            ['trailer', '{s:trailer}'],
            ['clip', '{s:clip}'],
            ['featurette', '{s:featurette}'],
            ['other', '{s:extra}'],
          ] as const
        ).map(([kind, text]): Node => ({
          type: 'text',
          when: [set('extra.ready'), is('extra.kind', kind)],
          text,
          style: { 'font-size': '13px', color: '$ink-faint' },
        })),
        {
          type: 'text',
          when: [unset('extra.ready')],
          text: '{s:notAvailableYet}',
          style: { 'font-size': '13px', color: '$ink-faint' },
        },
      ],
    },
  ],
};

const person: Node = {
  type: 'box',
  role: 'listitem',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    width: '110px',
    'align-items': 'center',
    gap: '8px',
    'text-align': 'center',
    'flex-shrink': '0',
  },
  small: { width: '84px' },
  children: [
    {
      type: 'box',
      style: {
        position: 'relative',
        display: 'flex',
        width: '96px',
        height: '96px',
        'border-radius': '999px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'align-items': 'center',
        'justify-content': 'center',
        'background-image': 'linear-gradient(150deg, $raised 0%, $chrome 100%)',
        'box-shadow': 'inset 0px 0px 0px 1px $line',
      },
      small: { width: '72px', height: '72px' },
      children: [
        {
          type: 'text',
          text: '{person.initials}',
          style: { 'font-size': '28px', 'font-weight': '700', color: '$ink-dim' },
          small: { 'font-size': '22px' },
        },
        { ...art('{person.portrait}'), when: [set('person.portrait')] },
      ],
    },
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '2px', width: '100%' },
      children: [
        {
          type: 'text',
          text: '{person.name}',
          style: { 'font-size': '13px', 'font-weight': '600', 'line-clamp': '2' },
        },
        {
          type: 'text',
          when: [set('person.role')],
          text: '{person.role}',
          style: { 'font-size': '12px', color: '$ink-faint', 'line-clamp': '2' },
        },
      ],
    },
  ],
};

// Wide: the poster beside the facts. Phones: the poster beside the name, the facts below.
const kindText = (size: string): Node => ({
  type: 'text',
  text: '{detail.kindLabel}',
  style: { ...label, 'font-size': size, color: '$amber' },
});
const titleHead: Node = {
  type: 'box',
  motion: 'arrive',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'row',
    gap: '44px',
    'align-items': 'flex-start',
    padding: '96px 48px 12px',
  },
  small: { display: 'none' },
  children: [
    poster,
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'column',
        flex: '1',
        'min-width': '0px',
        gap: '14px',
        'max-width': '62rem',
        'padding-top': '6px',
      },
      children: [
        kindText('13px'),
        {
          type: 'text',
          text: '{detail.name}',
          role: 'heading',
          level: 1,
          style: {
            'font-size': '36px',
            'font-weight': '700',
            'line-height': '1.12',
            'letter-spacing': '-0.01em',
          },
        },
        {
          type: 'box',
          style: {
            display: 'flex',
            'flex-direction': 'row',
            gap: '14px',
            'align-items': 'center',
            'flex-wrap': 'wrap',
          },
          children: [
            {
              type: 'text',
              when: [{ test: 'detail.year', is: 'gt', value: '0' }],
              text: '{detail.yearLabel}',
              style: { 'font-size': '20px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' },
            },
            {
              type: 'text',
              when: [
                is('detail.kind', 'episode'),
                { test: 'detail.episodeNumber', is: 'gt', value: '0' },
                set('detail.seasonNumberLabel'),
              ],
              text: '{s:detailSeasonEpisode}',
              style: { 'font-size': '16px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' },
            },
            {
              type: 'text',
              when: [
                is('detail.kind', 'episode'),
                { test: 'detail.episodeNumber', is: 'gt', value: '0' },
                unset('detail.seasonNumberLabel'),
              ],
              text: '{s:detailEpisodeNumber}',
              style: { 'font-size': '16px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' },
            },
          ],
        },
        facts,
      ],
    },
  ],
};
const titleHeadSmall: Node = {
  type: 'box',
  motion: 'arrive',
  style: { display: 'none' },
  small: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    gap: '16px',
    padding: '76px 16px 8px',
  },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: '16px', 'align-items': 'flex-end' },
      children: [
        poster,
        {
          type: 'box',
          style: {
            display: 'flex',
            'flex-direction': 'column',
            flex: '1',
            'min-width': '0px',
            gap: '6px',
            'padding-bottom': '4px',
          },
          children: [
            kindText('12px'),
            {
              type: 'text',
              text: '{detail.name}',
              role: 'heading',
              level: 1,
              style: { 'font-size': '24px', 'font-weight': '700', 'line-height': '1.15' },
            },
            {
              type: 'text',
              when: [set('detail.facts')],
              text: '{detail.facts}',
              style: { 'font-size': '14px', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' },
            },
          ],
        },
      ],
    },
    facts,
  ],
};

const detailLoading: Node = {
  type: 'box',
  when: [is('env.load', 'loading')],
  motion: 'statusIn',
  style: { display: 'flex', 'flex-direction': 'column', 'padding-top': px(bar.normal) },
  small: { 'padding-top': px(bar.small) },
  children: [
    {
      type: 'box',
      role: 'status',
      label: '{s:openingTitle}',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '36px',
        padding: '48px 48px',
        'align-items': 'flex-start',
      },
      small: { padding: '24px 16px' },
      children: [
        block('260px', '390px', 4, { small: { display: 'none' } }),
        {
          type: 'box',
          style: { display: 'flex', 'flex-direction': 'column', flex: '1', gap: '16px' },
          children: [
            block('60%', '34px', 4),
            block('30%', '16px', 3),
            block('200px', '44px', 6),
            block('100%', '72px', 4),
          ],
        },
      ],
    },
  ],
};

// The title page scrolls in its own box (navigation restores it); the close button stays put.
export const title: Node = {
  type: 'box',
  style: {
    position: 'relative',
    height: '100%',
    'min-height': '0px',
    display: 'flex',
    'flex-direction': 'column',
    'background-color': '$page',
    color: '$ink',
    'font-family': sans,
  },
  children: [
    {
      type: 'box',
      press: { action: 'back' },
      label: '{s:closeTitle}',
      testId: 'detail-close',
      style: {
        position: 'absolute',
        top: '20px',
        right: '20px',
        'z-index': '10',
        display: 'flex',
        'box-sizing': 'border-box',
        width: '44px',
        height: '44px',
        border: '1px solid $close-line',
        'border-radius': '22px',
        padding: '13px',
        'background-color': '$close-glass',
        'backdrop-filter': 'blur(20px) saturate(1.3)',
        color: '$close-ink',
      },
      children: [{ type: 'icon', symbol: 'close', style: { width: '18px', height: '18px' } }],
    },
    {
      type: 'box',
      id: '{env.route}-scroll-{env.entry}',
      role: 'region',
      label: '{s:titleDetails}',
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'column',
        flex: '1',
        'min-height': '0px',
        'overflow-x': 'hidden',
        'overflow-y': 'auto',
        'padding-bottom': '60px',
      },
      children: [
        detailLoading,
        failure('{s:titleFailed}'),
        {
          type: 'box',
          when: [is('env.load', 'ready')],
          style: {
            position: 'absolute',
            top: '0px',
            left: '0px',
            right: '0px',
            height: '100vh',
            'max-height': '900px',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
            'pointer-events': 'none',
          },
          small: { height: '420px', 'max-height': 'none' },
          children: [
            { ...art('{detail.backdrop}'), when: [set('detail.backdrop')] },
            {
              type: 'box',
              style: {
                ...fill,
                'background-image':
                  'linear-gradient(180deg, $page-veil 0%, $page-veil 45%, $page 100%), ' +
                  'linear-gradient(90deg, $page-veil 0%, $page-clear 100%)',
              },
            },
          ],
        },
        { ...titleHead, when: [is('env.load', 'ready')] },
        { ...titleHeadSmall, when: [is('env.load', 'ready')] },
        {
          type: 'box',
          when: [is('env.load', 'ready')],
          style: {
            position: 'relative',
            display: 'flex',
            'flex-direction': 'column',
            gap: '14px',
            'padding-top': '28px',
            'flex-shrink': '0',
          },
          small: { gap: '8px', 'padding-top': '16px' },
          children: [
            section(
              [{ test: 'detail.seasonCount', is: 'gt', value: '0' }],
              '{s:seasons}',
              shelf(
                16,
                10,
                seasonCard,
                'detail.seasons',
                { role: 'group', label: '{s:season}', testId: 'season-picker' },
                '4px',
              ),
              { normal: '24px', small: '16px' },
            ),
            section([set('detail.hasEpisodes')], '{detail.seasonName}', {
              type: 'box',
              style: {
                display: 'grid',
                'grid-template-columns': 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '26px 20px',
                ...gutter,
              },
              small: { 'grid-template-columns': '1fr', gap: '14px 20px', ...gutterSmall },
              children: [{ type: 'repeat', over: 'detail.episodes', item: episodeCard }],
            }),
            section([set('detail.hasExtras')], '{s:extras}', shelf(16, 16, extraCard, 'detail.extras')),
            section(
              [set('detail.hasCast')],
              '{s:cast}',
              shelf(22, 14, person, 'detail.cast', { role: 'list' }),
            ),
            {
              type: 'box',
              when: [set('detail.crewLine')],
              style: {
                display: 'flex',
                'flex-direction': 'column',
                gap: '6px',
                ...gutter,
                'padding-bottom': '30px',
                'max-width': '60rem',
              },
              small: { ...gutterSmall, 'padding-bottom': '20px' },
              children: [
                {
                  type: 'repeat',
                  over: 'detail.crew',
                  item: {
                    type: 'box',
                    style: {
                      display: 'flex',
                      'flex-direction': 'row',
                      gap: '10px',
                      'align-items': 'baseline',
                    },
                    children: [
                      {
                        type: 'text',
                        text: '{person.name}',
                        style: { 'font-size': '14px', 'font-weight': '600' },
                      },
                      {
                        type: 'text',
                        when: [set('person.role')],
                        text: '{person.role}',
                        style: { 'font-size': '14px', color: '$ink-faint' },
                      },
                    ],
                  },
                },
              ],
            },
            { type: 'repeat', over: 'detail.related', item: { type: 'use', template: 'row' } },
          ],
        },
      ],
    },
  ],
};

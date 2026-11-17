// Cards and rows: the poster and wide-thumbnail card, and the paged row every page draws.
import type { Condition, Node, Style } from '../../../skin';
import {
  side,
  sideSmall,
  row,
  col,
  fill,
  not,
  glyph,
  jelly,
  kindGlyphs,
  tile,
  iconBtn,
  iconBtnHover,
  iconBtnFocus,
  spinner,
} from './look';

// The card every row draws: artwork with the played mark and progress, the name and its subline.
// Posters and wide thumbnails scale with the window; a row of episodes or part-watched titles is wide.
const posterW = { style: 'clamp(128px, 11.6vw, 220px)', small: '31vw' };
export const wideW = { style: 'clamp(240px, 21.5vw, 400px)', small: '62vw' };
const subline: Style = {
  width: '100%',
  'min-height': '1.3em',
  'font-size': '13px',
  color: '$secondary',
  'line-clamp': '1',
  'font-variant-numeric': 'tabular-nums',
};
const isEpisode: Condition = { test: 'card.kind', is: 'eq', value: 'episode' };
// "Not an episode with both numbers", written as the three ways it can hold.
const noSE: Condition[][] = [
  [not(isEpisode)],
  [isEpisode, { test: 'card.seasonNumberLabel', not: true }],
  [isEpisode, { test: 'card.seasonNumberLabel' }, { test: 'card.episodeNumberLabel', not: true }],
];
export const card = (wide: boolean, width = wide ? wideW : posterW): Node => {
  const art = wide ? ['card.backdrop', 'card.poster'] : ['card.poster', 'card.backdrop'];
  const noArt: Condition[] = [
    { test: 'card.poster', not: true },
    { test: 'card.backdrop', not: true },
  ];
  const ring: Style = { 'box-shadow': '0px 0px 0px 3px $accent', filter: 'brightness(0.75)' };
  return {
    type: 'box',
    style: col({
      position: 'relative',
      width: width.style,
      'flex-shrink': '0',
      gap: '1px',
      'align-items': 'center',
      'text-align': 'center',
    }),
    small: { width: width.small },
    children: [
      { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
      {
        type: 'box',
        press: { action: 'select', arg: '{card.kindId}' },
        label: '{card.label}',
        testId: 'title-{card.id}',
        style: {
          position: 'relative',
          width: '100%',
          'aspect-ratio': wide ? '16 / 9' : '2 / 3',
          'border-radius': '5px',
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          color: '$ink-strong',
          cursor: 'pointer',
          'background-color': '$card',
          'box-shadow': '0px 2px 6px $shadow',
          filter: 'none',
          transition: 'box-shadow 140ms linear',
        },
        hover: ring,
        focus: { ...ring, outline: 'auto' },
        children: [
          tile('card.seed', {}, noArt),
          {
            type: 'image',
            when: [{ test: art[0] }],
            src: `{${art[0]}}`,
            alt: '',
            style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' },
          },
          {
            type: 'image',
            when: [{ test: art[0], not: true }, { test: art[1] }],
            src: `{${art[1]}}`,
            alt: '',
            style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' },
          },
          {
            type: 'box',
            when: noArt,
            style: {
              position: 'absolute',
              top: '34%',
              left: '34%',
              width: '32%',
              height: '32%',
              color: '$secondary',
            },
            children: kindGlyphs('card.kind', 0, { width: '100%', height: '100%' }),
          },
          {
            type: 'box',
            when: [{ test: 'card.played' }],
            style: {
              position: 'absolute',
              top: '6px',
              right: '6px',
              width: '24px',
              height: '24px',
              'border-radius': '12px',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              'background-color': '$accent',
              color: '$ink-strong',
            },
            children: [glyph('checkmark', 14)],
          },
          {
            type: 'box',
            when: [{ test: 'card.hasProgress' }],
            style: {
              position: 'absolute',
              left: '0px',
              right: '0px',
              bottom: '0px',
              height: '5px',
              'background-color': '$overlay',
              'background-image': 'linear-gradient(90deg, $accent {card.progressPct}%, transparent 0%)',
            },
          },
        ],
      },
      {
        type: 'text',
        text: '{card.name}',
        style: {
          width: '100%',
          'margin-top': '6px',
          'font-size': '14px',
          'font-weight': '500',
          color: '$ink-strong',
          'line-clamp': '1',
        },
      },
      // S1:E3 for an episode, else the year, else the facts.
      { type: 'use', template: 'velaCardContext', when: [{ test: 'card.hasContext' }] },
      ...noSE.map(
        w =>
          ({
            type: 'text',
            when: [...w, { test: 'card.hasContext', not: true }, { test: 'card.yearLabel' }],
            text: '{card.yearLabel}',
            style: subline,
          }) as Node,
      ),
      ...noSE.map(
        w =>
          ({
            type: 'text',
            when: [...w, { test: 'card.hasContext', not: true }, { test: 'card.yearLabel', not: true }],
            text: '{card.facts}',
            style: subline,
          }) as Node,
      ),
    ],
  };
};

// A section: its heading, then one line of cards (wide thumbnails for a landscape row).
// A section: its heading (with page-by-page arrows on a home row), then one line of cards,
// wide thumbnails for a landscape row, and the end cell that asks for the row's next page.
const arrow = (dir: 'pagePrev' | 'pageNext', icon: string, label: string, end: string): Node =>
  ({
    type: 'box',
    press: { action: dir, arg: '{row.id}' },
    label,
    disabled: [{ test: end }],
    style: iconBtn(36),
    hover: iconBtnHover,
    focus: iconBtnFocus,
    disabledStyle: { opacity: '0.35' },
    children: [jelly(icon, 22)],
  }) as Node;
const rowEnd: Node = {
  type: 'box',
  when: [{ test: 'row.hasMore' }],
  style: col({
    position: 'relative',
    width: '80px',
    'align-self': 'stretch',
    'flex-shrink': '0',
    'align-items': 'center',
    'justify-content': 'center',
  }),
  small: { width: '48px' },
  children: [
    { type: 'widget', widget: 'sentinel', params: { on: 'row' }, style: fill },
    spinner(28, { when: [{ test: 'row.loadingMore' }] }),
  ],
};
export const section = (
  items: string,
  heading: Node[],
  landscape: Condition | undefined,
  paged = false,
): Node =>
  ({
    type: 'box',
    style: col({ gap: '8px', 'padding-bottom': '26px' }),
    small: { gap: '6px', 'padding-bottom': '18px' },
    children: [
      {
        type: 'box',
        style: row({ 'align-items': 'center', gap: '8px', ...side, 'min-height': '40px' }),
        small: sideSmall,
        children: [
          ...heading,
          ...(paged
            ? [
                {
                  type: 'box',
                  when: [{ test: 'pager.overflows' }, { test: 'env.small', not: true }],
                  style: row({ gap: '8px' }),
                  children: [
                    arrow('pagePrev', 'left', '{s:previousPage}', 'pager.atStart'),
                    arrow('pageNext', 'right', '{s:nextPage}', 'pager.atEnd'),
                  ],
                } as Node,
              ]
            : []),
        ],
      },
      {
        type: 'box',
        ...(paged ? { pager: { inset: 48, peek: 63 } } : {}),
        style: row({
          'overflow-x': 'auto',
          'overflow-y': 'hidden',
          'scrollbar-width': 'none',
          'scroll-padding-left': '3.3%',
        }),
        small: { 'scroll-padding-left': '14px' },
        children: [
          {
            type: 'box',
            style: row({
              gap: '16px',
              'align-items': 'flex-start',
              'padding-top': '4px',
              'padding-bottom': '6px',
              ...side,
            }),
            small: { gap: '10px', ...sideSmall },
            children: [
              {
                type: 'repeat',
                over: items,
                when: landscape ? [not(landscape)] : [],
                item: { type: 'use', template: 'poster' },
              },
              ...(landscape
                ? [
                    {
                      type: 'repeat',
                      over: items,
                      when: [landscape],
                      item: { type: 'use', template: 'wide' },
                    } as Node,
                  ]
                : []),
              ...(paged ? [rowEnd] : []),
            ],
          },
        ],
      },
    ],
  }) as Node;
export const sectionTitle = (text: string, when: Condition[] = []): Node => ({
  type: 'text',
  text,
  when,
  role: 'heading',
  level: 2,
  style: {
    flex: '1',
    'min-width': '0px',
    'font-size': '20px',
    'font-weight': '600',
    color: '$ink-strong',
    'line-clamp': '1',
  },
});

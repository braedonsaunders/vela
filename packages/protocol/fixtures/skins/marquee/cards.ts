// Posters, landscape and ranked cards, and the hubs (rows) that hold them.
import type { Condition, Node, Style } from '../../../skin';
import { gutter, gutterSmall, fill, px, is, isnt, set, unset, glyph, round, oneLine } from './look';
import { notSmall } from './shell';

// A loading block in the shape of what is coming, with a passing sheen.
export const block = (w: string, h: string, radius: number, extra: Partial<Node> = {}): Node =>
  ({
    type: 'box',
    ...extra,
    style: {
      width: w,
      height: h,
      'flex-shrink': '0',
      'border-radius': px(radius),
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
      'background-color': '$skeleton',
      ...(extra.style ?? {}),
    },
    children: [
      {
        type: 'box',
        when: [unset('env.still')],
        motion: 'sheen',
        style: {
          width: '100%',
          height: '100%',
          'background-image': 'linear-gradient(90deg, transparent 0%, $skeleton-sheen 50%, transparent 100%)',
        },
      },
    ],
  }) as Node;
export const art = (src: string): Node => ({
  type: 'image',
  src,
  alt: '',
  fade: true,
  style: {
    ...fill,
    width: '100%',
    height: '100%',
    'object-fit': 'cover',
    transition: 'opacity 260ms linear',
  },
});
export const progress = (h: number, pct: string, show: Condition[]): Node => ({
  type: 'box',
  when: show,
  style: {
    position: 'absolute',
    left: '0px',
    right: '0px',
    bottom: '0px',
    height: px(h),
    'background-color': '$scrim',
  },
  children: [{ type: 'box', style: { height: px(h), width: `${pct}%`, 'background-color': '$amber' } }],
});
// Hover or focus: a faint scrim and an amber ring over the artwork.
const heat: Node[] = [
  {
    type: 'box',
    style: { ...fill, 'background-color': '$scrim-faint', opacity: '0', transition: 'opacity 120ms linear' },
    groupHover: { opacity: '1' },
    groupFocus: { opacity: '1' },
  } as Node,
  {
    type: 'box',
    style: {
      ...fill,
      'border-radius': '4px',
      'box-shadow': 'inset 0px 0px 0px 3px $amber',
      opacity: '0',
      transition: 'opacity 120ms linear',
    },
    groupHover: { opacity: '1' },
    groupFocus: { opacity: '1' },
  } as Node,
];
// An unwatched film or episode carries an amber corner: a border triangle, as drawn compiled.
export const tri = (size: number): Style => ({
  position: 'absolute',
  top: '0px',
  right: '0px',
  width: '0px',
  height: '0px',
  'border-style': 'solid',
  'border-width': '0px',
  'border-top-width': px(size),
  'border-top-color': '$amber',
  'border-left-width': px(size),
  'border-left-color': 'transparent',
});
export const corner = (size: number, sizeSmall = size): Node => ({
  type: 'box',
  when: [set('card.unwatched')],
  style: tri(size),
  small: tri(sizeSmall),
});
// Artwork is absent: the kind's icon and the title on a quiet panel.
const placeholder: Node = {
  type: 'box',
  when: [unset('card.poster'), unset('card.backdrop')],
  style: {
    ...fill,
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    'justify-content': 'center',
    gap: '10px',
    padding: '12px',
    'box-sizing': 'border-box',
    'background-image': 'linear-gradient(160deg, $raised 0%, $chrome 100%)',
    color: '$ink-faint',
  },
  children: [
    glyph('film', 32, { when: [is('card.kind', 'movie')], small: { width: '26px', height: '26px' } }),
    glyph('live', 32, { when: [is('card.kind', 'channel')], small: { width: '26px', height: '26px' } }),
    glyph('stack', 32, { when: [is('card.kind', 'collection')], small: { width: '26px', height: '26px' } }),
    glyph('tv', 32, {
      when: [isnt('card.kind', 'movie'), isnt('card.kind', 'channel'), isnt('card.kind', 'collection')],
      small: { width: '26px', height: '26px' },
    }),
    {
      type: 'text',
      text: '{card.name}',
      style: {
        'font-size': '13px',
        'font-weight': '600',
        color: '$ink-dim',
        'text-align': 'center',
        'line-clamp': '3',
      },
      small: { 'font-size': '12px' },
    },
  ],
};
// The line under a card: S·E for a numbered episode, else the year.
const episodeNumbered = [
  is('card.kind', 'episode'),
  { test: 'card.episodeNumber', is: 'gt', value: '0' } as Condition,
];
export const subLine = (style: Style, small: Style, suffix = ''): Node[] => [
  {
    type: 'text',
    when: [...episodeNumbered, { test: 'card.seasonNumber', is: 'gt', value: '0' }],
    text: `{s:seasonEpisode}${suffix}`,
    style,
    small,
  },
  {
    type: 'text',
    when: [...episodeNumbered, { test: 'card.seasonNumber', is: 'gt', value: '0', not: true }],
    text: `{s:episodeNumber}${suffix}`,
    style,
    small,
  },
  {
    type: 'text',
    when: [{ test: 'card.kind', is: 'ne', value: 'episode' }, set('card.yearLabel')],
    text: `{card.yearLabel}${suffix}`,
    style,
    small,
  },
  {
    type: 'text',
    when: [
      is('card.kind', 'episode'),
      { test: 'card.episodeNumber', is: 'gt', value: '0', not: true },
      set('card.yearLabel'),
    ],
    text: `{card.yearLabel}${suffix}`,
    style,
    small,
  },
];
const caption: Node = {
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    gap: '2px',
    'padding-top': '8px',
    width: '100%',
    'min-width': '0px',
  },
  children: [
    {
      type: 'text',
      text: '{card.name}',
      style: {
        'font-size': '14px',
        'font-weight': '600',
        color: '$ink',
        ...oneLine,
        transition: 'color 120ms linear',
      },
      small: { 'font-size': '13px' },
      groupHover: { color: '$amber' },
      groupFocus: { color: '$amber' },
    } as Node,
    ...subLine(
      { 'font-size': '13px', color: '$ink-faint', 'font-variant-numeric': 'tabular-nums', ...oneLine },
      { 'font-size': '12px' },
    ),
  ],
};
const cardShell = (w: number, wSmall: number, ratio: string, artwork: Node[]): Node => ({
  type: 'box',
  group: true,
  press: { action: 'select', arg: '{card.kindId}' },
  label: '{card.label}',
  testId: 'title-{card.id}',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'stretch',
    'flex-shrink': '0',
    'box-sizing': 'border-box',
    width: px(w),
    'border-radius': '4px',
    color: '$ink',
    outline: 'none',
  },
  small: { width: px(wSmall) },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    {
      type: 'box',
      style: {
        position: 'relative',
        width: '100%',
        'aspect-ratio': ratio,
        'border-radius': '4px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$raised',
        'box-shadow': '0px 4px 12px $scrim-faint',
      },
      children: [...artwork, progress(4, '{card.progressPct}', [set('card.hasProgress')]), ...heat],
    },
    caption,
  ],
});
// Portrait art: the poster (an episode's is its series poster), else the landscape art (an
// episode's still) cropped to the portrait frame; the panel only without art.
export const posterArt: Node[] = [
  { ...art('{card.poster}'), when: [set('card.poster')] },
  { ...art('{card.backdrop}'), when: [unset('card.poster'), set('card.backdrop')] },
];
export const card = cardShell(152, 112, '2 / 3', [
  ...posterArt,
  placeholder,
  corner(22, 18),
]);
// A landscape still, for hubs of part-watched titles.
export const wideCard = cardShell(300, 224, '16 / 9', [
  { ...art('{card.backdrop}'), when: [set('card.backdrop')] },
  {
    type: 'image',
    when: [unset('card.backdrop'), set('card.poster')],
    src: '{card.poster}',
    alt: '',
    style: {
      ...fill,
      width: '100%',
      height: '100%',
      'object-fit': 'cover',
      filter: 'blur(18px) brightness(0.6)',
      scale: '1.2',
    },
  },
  {
    type: 'image',
    when: [unset('card.backdrop'), set('card.poster')],
    src: '{card.poster}',
    alt: '',
    style: {
      position: 'absolute',
      top: '8%',
      bottom: '8%',
      left: '50%',
      translate: '-50% 0px',
      height: '84%',
      'aspect-ratio': '2 / 3',
      'object-fit': 'cover',
      'border-radius': '3px',
    },
  },
  { ...placeholder, when: [unset('card.backdrop'), unset('card.poster')] },
]);
// A ranked hub: the server's position as a large numeral the poster overlaps.
export const rankedCard: Node = {
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-end', 'flex-shrink': '0' },
  children: [
    {
      type: 'text',
      text: '{index.label}',
      style: {
        'font-size': '150px',
        'font-weight': '800',
        'line-height': '0.8',
        'letter-spacing': '-0.08em',
        color: '$raised',
        'margin-right': '-22px',
        'padding-bottom': '40px',
      },
      small: { 'font-size': '96px', 'margin-right': '-14px', 'padding-bottom': '34px' },
    },
    { type: 'use', template: 'card' },
  ],
};

// A hub: its heading over a shelf of cards in server order.
// A hub: its heading (with paging arrows on wide screens) over a shelf of cards in server
// order. On home the shelf is the row's pager and ends in a cell that asks for more.
export const spinner = (size: number, extra: Partial<Node> = {}): Node =>
  ({
    type: 'box',
    ...extra,
    motion: 'spin',
    style: {
      width: px(size),
      height: px(size),
      'flex-shrink': '0',
      'box-sizing': 'border-box',
      'border-radius': '999px',
      border: `${size > 30 ? 3 : 2}px solid $track`,
      'border-top-color': '$amber',
    },
  }) as Node;
const pageButton = (dir: 'pagePrev' | 'pageNext'): Node =>
  ({
    type: 'box',
    press: { action: dir, arg: '{row.id}' },
    label: dir === 'pagePrev' ? '{s:scrollBack}' : '{s:scrollOn}',
    ...round(32),
    disabled: [set(dir === 'pagePrev' ? 'pager.atStart' : 'pager.atEnd')],
    disabledStyle: { opacity: '0.35' },
    children: [glyph(dir === 'pagePrev' ? 'left' : 'right', 18)],
  }) as Node;
const shelfStyle = (gap: number, pad: Style, inset: string, still: boolean): Style => ({
  display: 'flex',
  'flex-direction': 'row',
  gap: px(gap),
  'align-items': 'flex-start',
  'box-sizing': 'border-box',
  width: '0px',
  'min-width': '100%',
  'padding-top': '4px',
  'padding-bottom': '4px',
  ...pad,
  'overflow-x': 'auto',
  'overflow-y': 'hidden',
  'scrollbar-width': 'none',
  'scroll-behavior': still ? 'auto' : 'smooth',
  'scroll-padding-left': inset,
});
const rowOf = (paged: boolean): Node =>
  ({
    type: 'box',
    role: 'group',
    label: '{row.name}',
    style: { display: 'flex', 'flex-direction': 'column', gap: '8px', 'padding-bottom': '30px' },
    small: { gap: '6px', 'padding-bottom': '20px' },
    children: [
      {
        type: 'box',
        style: {
          display: 'flex',
          'flex-direction': 'row',
          'align-items': 'center',
          gap: '8px',
          'min-height': '32px',
          'padding-left': '40px',
          'padding-right': '28px',
        },
        small: gutterSmall,
        children: [
          {
            type: 'text',
            text: '{row.name}',
            role: 'heading',
            level: 2,
            style: {
              'font-size': '19px',
              'font-weight': '700',
              color: '$ink',
              flex: '1',
              'min-width': '0px',
              ...oneLine,
            },
            small: { 'font-size': '17px' },
          },
          ...(paged
            ? ([
                { ...pageButton('pagePrev'), when: [notSmall, set('pager.overflows')] },
                { ...pageButton('pageNext'), when: [notSmall, set('pager.overflows')] },
              ] as Node[])
            : []),
        ],
      },
      // A shelf scrolls sideways: it takes its width from the page, never from its cards.
      {
        type: 'box',
        ...(paged ? { pager: { inset: 40, peek: 60 } } : {}),
        style: shelfStyle(16, gutter, '40px', false),
        small: { gap: '10px', ...gutterSmall, 'scroll-padding-left': '14px' },
        states: [{ when: [set('env.still')], style: shelfStyle(16, gutter, '40px', true) }],
        children: [
          {
            type: 'repeat',
            over: 'row.items',
            when: [isnt('row.presentation', 'ranked'), unset('row.resume')],
            item: { type: 'use', template: 'card' },
          },
          {
            type: 'repeat',
            over: 'row.items',
            when: [isnt('row.presentation', 'ranked'), set('row.resume')],
            item: { type: 'use', template: 'wideCard' },
          },
          {
            type: 'repeat',
            over: 'row.items',
            when: [is('row.presentation', 'ranked')],
            item: { type: 'use', template: 'rankedCard' },
          },
          ...(paged
            ? ([
                {
                  type: 'box',
                  when: [set('row.hasMore')],
                  style: {
                    position: 'relative',
                    display: 'flex',
                    width: '72px',
                    'align-self': 'stretch',
                    'flex-shrink': '0',
                    'align-items': 'center',
                    'justify-content': 'center',
                  },
                  small: { width: '48px' },
                  children: [
                    { type: 'widget', widget: 'sentinel', params: { on: 'row' }, style: { ...fill } },
                    spinner(24, { when: [set('row.loadingMore')] }),
                  ],
                },
              ] as Node[])
            : []),
        ],
      } as Node,
    ],
  }) as Node;
export const row = rowOf(false),
  homeRow = rowOf(true);

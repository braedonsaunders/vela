import type { BoxNode, Condition, Node, Style } from '../../../../protocol/skin';
import { cardRadius, display, focusRing, gutter, gutterSmall, is, placeholder, pulse, small, veil } from './look';

// A muted trailer preview: a landscape card that opens over the poster while the card's preview
// plays (home rows that preview on focus). In such a row it stays mounted while idle, since the
// widget inside reports the card's hover and focus as the intent to preview; only its state shows
// it. A press lands on the card underneath.
const previewOverlay = (shown: boolean): Style => ({
  position: 'absolute',
  left: '0px',
  top: '0px',
  'z-index': '6',
  width: '190%',
  'aspect-ratio': '16 / 9',
  translate: '-23.7% 20%',
  'border-radius': '$ui.radiusCard',
  'overflow-x': 'hidden',
  'overflow-y': 'hidden',
  'background-color': '$ui.raised',
  'box-shadow': '0px 40px 80px -20px $ui.shadow, 0px 0px 0px 1px $ui.glassEdgeStrong',
  // Never under the pointer: the card's hover is its press button's, which the overlay is not
  // inside, so taking the pointer would end the hover and with it the preview.
  'pointer-events': 'none',
  opacity: shown ? '1' : '0',
  scale: shown ? '1' : '0.94',
  transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1), scale 420ms cubic-bezier(0.16, 1, 0.3, 1)',
});
const previewing: Condition = { test: 'card.previewing' };
const fill: Style = { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' };
export const cardPreview: Node = {
  type: 'box',
  // Only a row that previews draws the overlay: a grid's or another row's cards never play one, and
  // the overlay with its widget was two views and some two dozen components on every card.
  when: [{ test: 'row.previewOnFocus' }],
  a11y: { hidden: true },
  style: previewOverlay(false),
  states: [
    // The first poster has only the page gutter to its left. Expand its preview inward
    // so the title and video do not start outside the screen.
    { when: [previewing, is('index', '0')], style: { ...previewOverlay(true), translate: '0% 20%' } },
    { when: [previewing], style: previewOverlay(true) },
  ],
  children: [
    {
      type: 'image',
      when: [previewing, { test: 'card.backdrop' }],
      src: '{card.backdrop}',
      alt: '',
      style: fill,
    },
    {
      type: 'image',
      when: [previewing, { test: 'card.backdrop', not: true }],
      src: '{card.poster}',
      alt: '',
      style: fill,
    },
    { type: 'widget', widget: 'cardPreview', style: { position: 'absolute', inset: '0px' } },
    {
      type: 'box',
      when: [previewing],
      style: {
        position: 'absolute',
        left: '0px',
        right: '0px',
        bottom: '0px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '3px',
        padding: '40px 14px 12px',
        'background-image': `linear-gradient(0deg, ${veil(94)} 0%, ${veil(0)} 100%)`,
      },
      children: [
        {
          type: 'text',
          text: '{card.name}',
          style: { 'font-size': '14px', 'font-weight': '650', 'line-clamp': '1', color: '$ui.ink' },
        },
        {
          type: 'text',
          text: '{card.facts}',
          style: {
            'font-size': '12px',
            color: '$ui.inkSecondary',
            'line-clamp': '1',
            'font-variant-numeric': 'tabular-nums',
          },
        },
      ],
    },
  ],
};

// Portrait art filling the card, centred: a poster, or landscape art cropped to the portrait frame.
const posterArt: Style = {
  position: 'absolute',
  inset: '0px',
  width: '100%',
  height: '100%',
  'object-fit': 'cover',
  transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)',
};

// Watched: a bold check on an accent disc in the art's top-right corner, legible on any artwork
// (posters and 16:9 stills alike) and big enough to read across a room; a dark ring parts it
// from bright art. Solid, no blur: a filter per card is costly on a TV's GPU. card.played never
// holds beside a resume bar.
const plate = (size: number, inset: number): Style => ({
  position: 'absolute',
  top: `${inset}px`,
  right: `${inset}px`,
  width: `${size}px`,
  height: `${size}px`,
  'border-radius': '999px',
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  'background-color': '$ui.accent',
  color: '$ui.onAccent',
  'box-shadow': '0px 2px 10px rgba(0, 0, 0, 0.45), 0px 0px 0px 1px rgba(0, 0, 0, 0.35)',
});
/** A filled check, heavier than the line symbol, so it reads small. */
export const boldCheck = ['M9.6 18.4 3.7 12.5l2.2-2.2 3.7 3.7 8.5-8.5 2.2 2.2z'];
export const playedBadge: Node = {
  type: 'box',
  when: [{ test: 'card.played' }],
  a11y: { hidden: true },
  style: plate(30, 8),
  small: plate(22, 6),
  children: [
    {
      type: 'icon',
      paths: boldCheck,
      viewBox: '0 0 24 24',
      style: { width: '18px', height: '18px' },
      small: { width: '14px', height: '14px' },
    },
  ],
};

// A scrim over the art behind the progress bar: dark in every document, unlike a fade to the page.
const progressFoot = 'linear-gradient(0deg, $ui.scrim 0%, color-mix(in srgb, $ui.scrim 0%, transparent) 100%)';

const cardMetadata: BoxNode = {
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    gap: '4px',
    padding: '0px 2px',
    opacity: '0.86',
    transition: 'opacity 180ms linear',
  },
  groupHover: { opacity: '1' },
  children: [
    {
      type: 'text',
      text: '{card.name}',
      style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1', color: '$ui.ink' },
      small: { 'font-size': '13px', 'line-clamp': '2' },
    },
    { type: 'use', template: 'velaCardContext' },
    {
      type: 'text',
      text: '{card.facts}',
      style: {
        'font-size': '12px',
        color: '$ui.inkQuiet',
        'line-clamp': '1',
        'font-variant-numeric': 'tabular-nums',
      },
      small: { 'line-clamp': '2' },
    },
  ],
};

export const card: Node = {
  type: 'box',
  group: true,
  press: { action: 'select', arg: '{card.kindId}' },
  label: '{card.label}',
  testId: 'title-{card.id}',
  controlStates: false,
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    width: 'clamp(150px, 12.4vw, 232px)',
    'flex-shrink': '0',
    gap: '12px',
  },
  // A phone's row card is a grid column's size (titleGrid), so a library reads the same in
  // its rows and its grid.
  small: { width: '112px' },
  children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    {
      type: 'box',
      style: {
        position: 'relative',
        width: '100%',
        'aspect-ratio': '2 / 3',
        'background-color': '$ui.raised',
        'border-radius': cardRadius(2),
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        scale: '1',
        translate: '0px 0px',
        'box-shadow': '0px 10px 24px -12px $ui.shadow, 0px 0px 0px 1px $ui.glassEdge',
        transition: [
          'scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
          'translate 360ms cubic-bezier(0.16, 1, 0.3, 1)',
          'box-shadow 360ms cubic-bezier(0.16, 1, 0.3, 1)',
        ].join(', '),
      },
      small: { 'border-radius': cardRadius(4) },
      groupHover: {
        scale: '1.045',
        translate: '0px -6px',
        'box-shadow': '0px 28px 50px -14px $ui.shadow, 0px 0px 0px 1px $ui.glassEdgeStrong',
      },
      groupFocus: {
        scale: '1.045',
        translate: '0px -6px',
        'box-shadow': '0px 0px 0px 3px $ui.ink, 0px 28px 50px -14px $ui.shadow',
      },
      children: [
        // The portrait art: the poster (an episode's is its series poster), else the landscape
        // art (an episode's still) cropped to the portrait frame; the named card only without art.
        {
          type: 'image',
          when: [{ test: 'card.poster' }],
          src: '{card.poster}',
          alt: '',
          fade: true,
          style: posterArt,
        },
        {
          type: 'image',
          when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop' }],
          src: '{card.backdrop}',
          alt: '',
          fade: true,
          style: posterArt,
        },
        {
          type: 'box',
          when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop', not: true }],
          style: {
            position: 'absolute',
            inset: '0px',
            padding: '16px',
            display: 'flex',
            'flex-direction': 'column',
            'justify-content': 'flex-end',
            'background-image': placeholder(160),
          },
          children: [
            {
              type: 'text',
              text: '{card.name}',
              style: {
                'font-family': '$ui.fontDisplay',
                'font-size': '24px',
                'line-clamp': '4',
                'line-height': '0.98',
              },
              small: { 'font-size': '20px' },
            },
          ],
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            'pointer-events': 'none',
            'background-image': 'linear-gradient(145deg, #ffffff21 0%, #ffffff00 42%)',
            opacity: '0',
            transition: 'opacity 360ms cubic-bezier(0.16, 1, 0.3, 1)',
          },
          groupHover: { opacity: '1' },
          groupFocus: { opacity: '1' },
        },
        playedBadge,
        {
          type: 'box',
          when: [{ test: 'card.hasProgress' }, { test: 'card.played', not: true }],
          style: {
            position: 'absolute',
            left: '0px',
            right: '0px',
            bottom: '0px',
            height: '36px',
            'background-image': progressFoot,
          },
        },
        {
          type: 'box',
          when: [{ test: 'card.hasProgress' }, { test: 'card.played', not: true }],
          style: {
            position: 'absolute',
            left: '10px',
            right: '10px',
            bottom: '10px',
            height: '3px',
            'border-radius': '2px',
            'background-color': '$ui.trackStrong',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
          },
          children: [
            {
              type: 'box',
              style: { height: '3px', width: '{card.progressPct}%', 'background-color': '$ui.accent' },
            },
          ],
        },
      ],
    },
    cardMetadata,
    cardPreview,
  ],
};

// A Top 10 row's numeral: large, outlined, fading toward its foot, the poster overlapping
// its right edge. "10" sits tighter so both digits fit beside the card.
export const numeral = (ten: boolean): Node => ({
  type: 'text',
  text: '{index.label}',
  when: [
    { test: 'row.presentation', is: 'eq', value: 'ranked' },
    { test: 'index', is: ten ? 'eq' : 'lt', value: '9' },
  ],
  style: {
    'font-family': '"Arial Black", "Helvetica Neue", Arial, sans-serif',
    'font-weight': '900',
    'font-size': '348px',
    // The two-digit rank must not wrap and double the native shelf's height.
    'white-space': 'nowrap',
    'line-height': '0.74',
    'letter-spacing': ten ? '-0.2em' : '-0.09em',
    color: '$ui.page',
    'text-shadow': '0px 0px 5px color-mix(in srgb, $ui.ink 88%, $ui.page)',
    'mask-image': 'linear-gradient(180deg, black 0%, black 50%, rgba(0, 0, 0, 0.25) 100%)',
    'margin-right': '-50px',
    'padding-bottom': '52px',
    'flex-shrink': '0',
  },
  small: {
    'font-size': '220px',
    'text-shadow': '0px 0px 3px color-mix(in srgb, $ui.ink 88%, $ui.page)',
    'margin-right': '-30px',
    'padding-bottom': '44px',
  },
});
const rowItemStyle = (layer: string): Style => ({
  position: 'relative',
  display: 'flex',
  'flex-direction': 'row',
  'align-items': 'flex-end',
  'z-index': layer,
});
const rowItemOf = (template: string): Node => ({
  type: 'box',
  motion: 'velaCard',
  stagger: { step: 45, cap: 8 },
  style: rowItemStyle('0'),
  // The previewing card's overlay opens over its neighbours.
  states: [{ when: [previewing], style: rowItemStyle('5') }],
  children: [...(template === 'velaCardHero' ? [] : [numeral(false), numeral(true)]), { type: 'use', template }],
});
export const rowItem: Node = rowItemOf('velaCard');
/** Every expandable row's final card. Skins may override the `velaSeeAll` template. */
export const seeAll: Node = {
  type: 'widget',
  widget: 'rowLink',
  params: { end: 'true' },
  style: {
    display: 'flex',
    'align-self': 'stretch',
    'min-width': '154px',
    'min-height': '120px',
    'border-radius': '$ui.radiusCard',
    'background-color': '$ui.control',
    color: '$ui.inkSecondary',
  },
  small: { 'min-width': '124px' },
  hover: { 'background-color': '$ui.controlHover', color: '$ui.ink' },
  focus: { 'background-color': '$ui.controlHover', color: '$ui.ink', 'box-shadow': focusRing },
};
// The row's end cell: its next page loads as the end comes near (home rows only).
export const rowEnd: Node = {
  type: 'box',
  when: [{ test: 'row.hasMore' }],
  style: {
    position: 'relative',
    display: 'flex',
    width: '96px',
    // Give the pager a definite height: native stretch with an auto height inflates the shelf.
    'align-self': 'center',
    height: '48px',
    'flex-shrink': '0',
    'align-items': 'center',
    'justify-content': 'center',
  },
  small: { width: '60px' },
  children: [
    { type: 'widget', widget: 'sentinel', params: { on: 'row' } },
    { ...pulse, when: [{ test: 'row.loadingMore' }] } as Node,
  ],
};
// A shelf scrolls sideways; ranked shelves space their cards wider, room for the numerals.
export const shelf = (ranked: boolean, paged: boolean, template = 'velaCard'): Node => ({
  type: 'box',
  ...(paged ? { pager: { inset: 28, peek: 72 } } : {}),
  when: [{ test: 'row.presentation', is: ranked ? 'eq' : 'ne', value: 'ranked' }],
  style: {
    display: 'flex',
    'flex-direction': 'row',
    gap: ranked ? '40px' : '18px',
    'align-items': 'flex-start',
    'overflow-x': 'auto',
    'overflow-y': 'hidden',
    'scrollbar-width': 'none',
    'mask-image': 'linear-gradient(90deg, black 0%, black 94%, transparent 100%)',
    'padding-top': '16px',
    'padding-bottom': '22px',
    ...gutter,
  },
  small: { gap: ranked ? '22px' : '12px', 'padding-top': '14px', 'padding-bottom': '18px', ...gutterSmall },
  children: [{ type: 'repeat', over: 'row.items', item: template === 'velaCard' ? rowItem : rowItemOf(template) }, ...(paged ? [rowEnd] : [])],
});

const pageButton = (direction: 'pagePrev' | 'pageNext'): Node => ({
  type: 'box',
  press: { action: direction, arg: '{row.id}' },
  label: direction === 'pagePrev' ? '{t:ui.scrollBack}' : '{t:ui.scrollOn}',
  disabled: [{ test: direction === 'pagePrev' ? 'pager.atStart' : 'pager.atEnd' }],
  style: {
    position: 'absolute',
    top: '46%',
    [direction === 'pagePrev' ? 'left' : 'right']: 'max(8px, 1.2vw)',
    'z-index': '12',
    display: 'flex',
    width: '42px',
    height: '58px',
    'align-items': 'center',
    'justify-content': 'center',
    'border-radius': '999px',
    'background-color': 'color-mix(in srgb, $ui.page 82%, transparent)',
    'box-shadow': '0px 8px 24px $ui.shadow',
    color: '$ui.ink',
  },
  hover: { scale: '1.08', 'background-color': '$ui.raised' },
  focus: { 'box-shadow': focusRing },
  disabledStyle: { opacity: '0' },
  children: [{
    type: 'icon',
    symbol: 'forward-chevron',
    style: { width: '22px', height: '22px', ...(direction === 'pagePrev' ? { rotate: '180deg' } : {}) },
  }],
});

export const shelfRow = (paged: boolean, template = 'velaCard'): Node => ({
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    gap: '4px',
    'padding-bottom': '28px',
  },
  small: { gap: '2px', 'padding-bottom': '18px' },
  children: [
    {
      type: 'text',
      text: '{row.name}',
      role: 'heading',
      level: 2,
      style: { 'font-size': '21px', 'font-weight': '650', 'letter-spacing': '-0.012em', ...gutter },
      small: { 'font-size': '18px', ...gutterSmall },
    },
    shelf(false, paged, template),
    shelf(true, paged, template),
    ...(paged ? [
      { ...pageButton('pagePrev'), when: [{ test: 'env.small', not: true }, { test: 'pager.overflows' }] },
      { ...pageButton('pageNext'), when: [{ test: 'env.small', not: true }, { test: 'pager.overflows' }] },
    ] as Node[] : []),
  ],
});
export const row = shelfRow(true);
export const relatedRow = shelfRow(false);

// The browse grid (compiled cinematic's TitleGrid); library and collection pages fill it.
export const titleGrid: Node = {
  type: 'box',
  style: {
    display: 'grid',
    'grid-template-columns': 'repeat(auto-fill, minmax(190px, 1fr))',
    'column-gap': '20px',
    'row-gap': '34px',
    ...gutter,
  } as Style,
  // Columns about a row card wide (112 px): three across a phone, more as the width allows.
  small: {
    'grid-template-columns': 'repeat(auto-fill, minmax(104px, 1fr))',
    'column-gap': '12px',
    'row-gap': '22px',
    ...gutterSmall,
  } as Style,
  children: [],
};
// Browse grids never preview: the grid card leaves the overlay out.
export const gridCard: Node = {
  ...card,
  children: ((card as BoxNode).children ?? []).filter(child => child !== cardPreview),
  style: { ...(card as BoxNode).style, width: '100%' },
  small: { width: '100%' },
} as Node;

/** Search cards keep the entire press scoped to the result, including episode context. */
const searchMetadata: BoxNode = {
  ...cardMetadata,
  children: cardMetadata.children?.map(child => {
    if (child.type === 'use') return {
      type: 'text',
      when: [{ test: 'search.episodeContext' }],
      text: '{search.episodeContext}',
      style: { 'font-size': '12px', 'line-clamp': '2', color: '$ui.inkSecondary' },
    };
    if (child.type === 'text' && child.text === '{card.name}') return {
      ...child,
      style: { ...child.style, 'line-clamp': '2', 'line-height': '17px', 'min-height': '34px' },
      small: { ...child.small, 'line-clamp': '2', 'line-height': '16px', 'min-height': '32px' },
    };
    if (child.type === 'text' && child.text === '{card.facts}') return {
      ...child, text: '{search.cardFacts}', small: { 'line-clamp': '1' },
    };
    return child;
  }),
};

export const searchGridCard: BoxNode = {
  ...(gridCard as BoxNode),
  children: (gridCard as BoxNode).children?.map(child => child === cardMetadata ? searchMetadata : child),
};

// Recommendations rows' layouts on library pages (row.layout, docs: Recommendations wire): `hero`
// draws large landscape art in place, `wide` landscape cards, `tiles` square tiles; any other
// layout is the standard poster shelf. The card is the row card at another shape: its frame's
// aspect and the art it prefers (landscape art first for the landscape shapes).
function shaped(width: string, small: string, aspect: string, landscape: boolean): Node {
  const base = card as BoxNode;
  const [observe, frame, ...rest] = base.children ?? [];
  const f = frame as BoxNode;
  const [poster, backdrop, ...art] = f.children ?? [];
  const pictures = landscape
    ? [{ ...(backdrop as Node), when: [{ test: 'card.backdrop' }] }, { ...(poster as Node), when: [{ test: 'card.backdrop', not: true }, { test: 'card.poster' }] }]
    : [poster as Node, backdrop as Node];
  return {
    ...base,
    style: { ...base.style, width },
    small: { width: small },
    children: [observe as Node, { ...f, style: { ...f.style, 'aspect-ratio': aspect }, children: [...pictures, ...art] }, ...rest],
  } as Node;
}
export const heroCard = shaped('clamp(420px, 40vw, 760px)', '300px', '16 / 9', true);
export const wideCard = shaped('clamp(240px, 20vw, 380px)', '220px', '16 / 9', true);
export const tileCard = shaped('clamp(150px, 12.4vw, 232px)', '112px', '1 / 1', false);
// A hero row's large art stands alone: no rank numerals, one plain shelf whatever its presentation.
const heroShelfRow = shelfRow(true, 'velaCardHero') as BoxNode;
export const heroRow: Node = { ...heroShelfRow, children: (heroShelfRow.children ?? []).flatMap(child => {
  if ((child as BoxNode).when?.some(test => test.test === 'row.presentation' && test.is === 'eq')) return [];
  if ((child as BoxNode).when?.some(test => test.test === 'row.presentation')) return [{ ...child, when: [] } as Node];
  return [child];
}) } as Node;
export const wideRow = shelfRow(true, 'velaCardWide');
export const tileRow = shelfRow(true, 'velaCardTile');
const layout = (value: string) => ({ test: 'row.layout', is: 'eq' as const, value });
/** A library page's recommended row: its layout's row, else the standard shelf. */
export const libraryRow: Node = {
  type: 'box',
  children: [
    { type: 'use', template: 'velaRowHero', when: [layout('hero')] },
    { type: 'use', template: 'velaRowWide', when: [layout('wide')] },
    { type: 'use', template: 'velaRowTile', when: [layout('tiles')] },
    { type: 'use', template: 'velaRow', when: [{ ...layout('hero'), not: true }, { ...layout('wide'), not: true }, { ...layout('tiles'), not: true }] },
  ],
};

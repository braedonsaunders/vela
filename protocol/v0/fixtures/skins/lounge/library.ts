import type { Node, Style } from '../../../skin';
import { capsule, capsuleFocus, gutter, gutterSmall, sans } from './look';
import { posterBone } from './skeletons';

// One choice in a library's controls: a capsule, filled while it is in force.
export const choice = (
  press: { action: 'librarySort' | 'libraryFilter' | 'librarySortFlip'; arg?: string },
  label: string,
  on: Node['when'],
  testId: string,
): Node => ({
  type: 'box',
  press,
  controlStates: false,
  label,
  testId,
  a11y: { pressed: on },
  style: {
    ...capsule('clamp(44px, 3.3vw, 62px)'),
    'background-color': 'rgba(255, 255, 255, 0.08)',
    color: '$ink-dim',
    'font-size': 'clamp(15px, 1.1vw, 21px)',
    'padding-left': 'clamp(18px, 1.4vw, 28px)',
    'padding-right': 'clamp(18px, 1.4vw, 28px)',
  },
  focus: capsuleFocus,
  active: { scale: '0.97' },
  hover: { 'background-color': 'rgba(255, 255, 255, 0.18)' },
  children: [
    {
      type: 'box',
      when: on,
      style: {
        position: 'absolute',
        inset: '0px',
        'border-radius': '999px',
        'background-color': 'rgba(255, 255, 255, 0.2)',
        'box-shadow': 'inset 0px 0px 0px 2px rgba(255, 255, 255, 0.5)',
      },
    },
    { type: 'text', text: label, style: { position: 'relative', 'white-space': 'nowrap' } },
  ],
});

// A row of choices that scrolls sideways when it outgrows the screen.
export const choices = (label: string, children: Node[]): Node => ({
  type: 'box',
  style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' },
  children: [
    {
      type: 'box',
      role: 'group',
      label,
      style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '10px', padding: '8px 0px' },
      children,
    },
  ],
});

// Watched and favourite filters toggle: pressing the one in force clears it.
export const toggle = (filter: 'played' | 'favorite', value: string, label: string, testId: string): Node[] => [
  {
    ...choice(
      { action: 'libraryFilter', arg: `${filter}|${value}` },
      label,
      [{ test: `library.${filter}Filter`, is: 'eq', value }],
      testId,
    ),
    when: [{ test: `library.${filter}Filter`, is: 'ne', value }],
  },
  {
    ...choice(
      { action: 'libraryFilter', arg: `${filter}|` },
      label,
      [{ test: `library.${filter}Filter`, is: 'eq', value }],
      testId,
    ),
    when: [{ test: `library.${filter}Filter`, is: 'eq', value }],
  },
];

export const library: Node = {
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'min-height': '100%',
    color: '$ink',
    'font-family': sans,
    'background-color': '$ground',
  },
  children: [
    // The library's own artwork, far back and soft, under the heading.
    {
      type: 'box',
      when: [{ test: 'library.backdrop' }],
      style: {
        position: 'absolute',
        top: '0px',
        left: '0px',
        right: '0px',
        height: 'min(70vh, 720px)',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'pointer-events': 'none',
        'mask-image': 'linear-gradient(180deg, black 0%, black 30%, transparent 100%)',
      },
      children: [
        {
          type: 'image',
          src: '{library.backdrop}',
          alt: '',
          fade: true,
          style: {
            position: 'absolute',
            inset: '0px',
            width: '100%',
            height: '100%',
            'object-fit': 'cover',
            opacity: '0.42',
            filter: 'saturate(1.2)',
          },
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            'background-image': 'linear-gradient(90deg, rgba(5, 6, 9, 0.9) 0%, rgba(5, 6, 9, 0.3) 70%)',
          },
        },
      ],
    },
    {
      type: 'box',
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'column',
        gap: 'clamp(16px, 1.4vw, 26px)',
        'padding-top': 'clamp(120px, 10.5vw, 200px)',
        'padding-bottom': 'clamp(8px, 1vw, 18px)',
        ...gutter,
      },
      small: { 'padding-top': '84px', ...gutterSmall },
      children: [
        {
          type: 'text',
          text: '{library.name}',
          role: 'heading',
          level: 1,
          motion: 'copy0',
          style: {
            'font-size': 'clamp(44px, 4.4vw, 92px)',
            'font-weight': '800',
            'letter-spacing': '-0.025em',
            'line-height': '1',
          },
          small: { 'font-size': '36px' },
        },
        {
          type: 'text',
          when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
          text: '{s:libraryCount}',
          motion: 'copy1',
          style: {
            'font-size': 'clamp(16px, 1.2vw, 23px)',
            'font-weight': '600',
            color: '$ink-dim',
            'font-variant-numeric': 'tabular-nums',
          },
        },
        {
          type: 'box',
          when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
          motion: 'copy2',
          style: { display: 'flex', 'flex-direction': 'column', gap: '4px' },
          children: [
            choices('{s:sortBy}', [
              {
                type: 'repeat',
                over: 'library.sorts',
                item: choice(
                  { action: 'librarySort', arg: '{opt.id}' },
                  '{opt.label}',
                  [{ test: 'opt.on' }],
                  'sort-{opt.id}',
                ),
              },
              {
                ...choice(
                  { action: 'librarySortFlip' },
                  '{s:reverse}',
                  [{ test: 'library.direction', is: 'eq', value: 'desc' }],
                  'sort-flip',
                ),
                when: [{ test: 'library.canFlip' }],
              },
            ]),
            choices('{s:filters}', [
              {
                type: 'repeat',
                over: 'library.kinds',
                item: choice(
                  { action: 'libraryFilter', arg: 'kind|{opt.id}' },
                  '{opt.label}',
                  [{ test: 'opt.on' }],
                  'kind-{opt.id}',
                ),
              },
              ...toggle('played', 'false', '{s:unwatched}', 'filter-unwatched').map(n => ({
                ...n,
                when: [...(n.when ?? []), { test: 'library.canPlayed' }],
              })),
              ...toggle('favorite', 'true', '{s:favorites}', 'filter-favorites').map(n => ({
                ...n,
                when: [...(n.when ?? []), { test: 'library.canFavorite' }],
              })),
              {
                type: 'repeat',
                over: 'library.genres',
                item: choice(
                  { action: 'libraryFilter', arg: 'genre|{opt.id}' },
                  '{opt.label}',
                  [{ test: 'opt.on' }],
                  'genre-{opt.id}',
                ),
              },
            ]),
          ],
        },
      ],
    },
    // The shelf: a grid of posters that fills the width, with room for a focused one to grow.
    {
      type: 'box',
      testId: 'library-grid',
      when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
      style: {
        position: 'relative',
        display: 'grid',
        'grid-template-columns': 'repeat(auto-fill, minmax(176px, 1fr))',
        'column-gap': 'clamp(20px, 1.9vw, 40px)',
        'row-gap': 'clamp(28px, 2.6vw, 52px)',
        'padding-top': 'clamp(24px, 2vw, 40px)',
        'padding-bottom': 'max(64px, 8vh)',
        ...gutter,
      },
      wide: { 'grid-template-columns': 'repeat(auto-fill, minmax(220px, 1fr))' },
      small: {
        'grid-template-columns': 'repeat(auto-fill, minmax(104px, 1fr))',
        'column-gap': '12px',
        'row-gap': '20px',
        ...gutterSmall,
      },
      children: [
        { type: 'repeat', over: 'library.items', item: { type: 'use', template: 'gridPoster' } },
        {
          type: 'box',
          when: [{ test: 'library.more' }],
          style: { position: 'relative', 'grid-column': '1 / -1', height: '2px' },
          children: [{ type: 'widget', widget: 'sentinel', params: { on: 'library' } }],
        },
        {
          type: 'text',
          when: [{ test: 'env.libraryMoreLoading' }],
          text: '{s:loadingMore}',
          role: 'status',
          motion: 'pulse',
          style: { 'grid-column': '1 / -1', 'font-size': 'clamp(15px, 1.1vw, 21px)', color: '$ink-quiet' },
        },
        {
          type: 'box',
          when: [
            { test: 'library.itemCount', is: 'eq', value: '0' },
            { test: 'env.libraryLoading', not: true },
          ],
          role: 'status',
          style: {
            'grid-column': '1 / -1',
            display: 'flex',
            'flex-direction': 'column',
            gap: '10px',
            'padding-top': '24px',
          },
          children: [
            {
              type: 'text',
              text: '{s:libraryEmpty}',
              style: { 'font-size': 'clamp(22px, 1.8vw, 36px)', 'font-weight': '700' },
            },
            {
              type: 'text',
              text: '{s:libraryEmptyDetail}',
              style: { 'font-size': 'clamp(16px, 1.2vw, 23px)', color: '$ink-dim' },
            },
          ],
        },
      ],
    },
    // Before the first answer: the grid in outline; if it fails, one sentence and Try again.
    {
      type: 'box',
      when: [{ test: 'env.load', is: 'eq', value: 'loading' }],
      role: 'status',
      label: '{s:loadingLibrary}',
      style: {
        display: 'grid',
        'grid-template-columns': 'repeat(auto-fill, minmax(176px, 1fr))',
        'column-gap': 'clamp(20px, 1.9vw, 40px)',
        'row-gap': 'clamp(28px, 2.6vw, 52px)',
        'padding-top': 'clamp(24px, 2vw, 40px)',
        'overflow-y': 'hidden',
        'max-height': '70vh',
        ...gutter,
      },
      wide: { 'grid-template-columns': 'repeat(auto-fill, minmax(220px, 1fr))' },
      small: {
        'grid-template-columns': 'repeat(auto-fill, minmax(104px, 1fr))',
        'column-gap': '12px',
        'row-gap': '20px',
        ...gutterSmall,
      },
      children: Array.from({ length: 16 }, () => ({
        ...posterBone,
        style: { ...posterBone.style, width: '100%' } as Style,
        small: {},
      })),
    },
    {
      type: 'box',
      when: [{ test: 'env.load', is: 'eq', value: 'failed' }],
      role: 'alert',
      style: {
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'flex-start',
        gap: '20px',
        'padding-top': '24px',
        ...gutter,
      },
      small: { ...gutterSmall },
      children: [
        {
          type: 'text',
          text: '{s:libraryFailed}',
          style: { 'font-size': 'clamp(24px, 2vw, 40px)', 'font-weight': '700' },
        },
        {
          type: 'box',
          when: [{ test: 'env.canRetry' }],
          press: { action: 'retry' },
          controlStates: false,
          label: '{s:tryAgain}',
          style: capsule('clamp(58px, 4.4vw, 84px)'),
          focus: capsuleFocus,
          active: { scale: '0.97' },
          children: [{ type: 'text', text: '{s:tryAgain}' }],
        },
      ],
    },
  ],
};

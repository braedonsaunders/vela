// Home: the folding search field, the featured banner, My Media and the rows.
import type { Condition, Node, Style } from '../../../skin';
import {
  type Press,
  isLive,
  sans,
  gradient,
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
  submit,
  submitFocus,
  spinner,
  emptyState,
  ready,
  waiting,
  failure,
} from './look';
import { wideW, section, sectionTitle } from './cards';

// The featured banner: full-bleed artwork, the logo or name, facts, the overview and dots.
const dot: Style = {
  position: 'relative',
  width: '9px',
  height: '9px',
  'border-radius': '5px',
  cursor: 'pointer',
  'background-color': '$track',
  'background-image': 'none',
};
const mediaBar: Node = {
  type: 'repeat',
  over: 'home.hero',
  when: [{ test: 'env.searching', not: true }],
  item: {
    type: 'box',
    motion: 'fadeIn',
    style: col({
      position: 'relative',
      height: 'min(54vh, 500px)',
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
      'margin-bottom': '22px',
      'flex-shrink': '0',
    }),
    small: { height: '300px', 'margin-bottom': '14px' },
    children: [
      { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
      {
        type: 'image',
        when: [{ test: 'hero.backdrop' }],
        src: '{hero.backdrop}',
        alt: '',
        style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' },
      },
      tile('hero.seed', {}, [{ test: 'hero.backdrop', not: true }]),
      {
        type: 'box',
        style: {
          ...fill,
          'background-image':
            'linear-gradient(90deg, $scrim 0%, $scrim-clear 65%), linear-gradient(0deg, $page 0%, $scrim-clear 45%)',
        },
      },
      {
        type: 'box',
        style: col({
          position: 'relative',
          height: '100%',
          'justify-content': 'flex-end',
          'box-sizing': 'border-box',
          ...side,
          'padding-bottom': '34px',
          gap: '12px',
          'max-width': '48rem',
        }),
        small: { ...sideSmall, 'padding-bottom': '18px', gap: '8px', 'max-width': 'none' },
        children: [
          {
            type: 'image',
            when: [{ test: 'hero.logo' }],
            src: '{hero.logo}',
            alt: '{hero.name}',
            role: 'heading',
            level: 1,
            style: {
              height: '120px',
              width: 'auto',
              'max-width': '80%',
              'object-fit': 'contain',
              'align-self': 'flex-start',
            },
            small: { height: '64px' },
          },
          {
            type: 'text',
            when: [{ test: 'hero.logo', not: true }],
            text: '{hero.name}',
            role: 'heading',
            level: 1,
            style: {
              'font-size': '46px',
              'font-weight': '700',
              color: '$ink-strong',
              'line-clamp': '2',
              'text-shadow': '0px 2px 12px $shadow',
            },
            small: { 'font-size': '28px' },
          },
          {
            type: 'box',
            style: row({ gap: '14px', 'align-items': 'center', 'flex-wrap': 'wrap' }),
            children: [
              {
                type: 'text',
                when: [{ test: 'hero.yearLabel' }],
                text: '{hero.yearLabel}',
                style: { 'font-size': '14px', color: '$ink-strong' },
              },
              {
                type: 'text',
                when: [{ test: 'hero.rating' }],
                text: '{hero.rating}',
                style: {
                  'font-size': '12px',
                  padding: '1px 6px',
                  border: '1px solid $secondary',
                  'border-radius': '3px',
                  color: '$ink',
                },
              },
              {
                type: 'text',
                when: [{ test: 'hero.genresLine' }],
                text: '{hero.genresLine}',
                style: { 'font-size': '14px', color: '$ink' },
              },
            ],
          },
          {
            type: 'text',
            when: [{ test: 'hero.summary' }, { test: 'env.small', not: true }],
            text: '{hero.summary}',
            style: {
              'font-size': '15px',
              'line-height': '1.5',
              color: '$ink',
              'line-clamp': '3',
              'max-width': '40rem',
            },
          },
          {
            type: 'box',
            style: row({ gap: '10px', 'margin-top': '4px' }),
            children: [
              {
                type: 'box',
                press: { action: 'select', arg: '{hero.kindId}' },
                label: '{hero.label}',
                style: { ...submit, height: '44px' },
                small: { height: '40px' },
                hover: { opacity: '0.9' },
                focus: submitFocus,
                children: [glyph('info', 19), { type: 'text', text: '{s:moreInfo}' }],
              },
            ],
          },
        ],
      },
      {
        type: 'box',
        when: [{ test: 'env.heroCount', is: 'gt', value: '1' }],
        role: 'group',
        label: '{s:featured}',
        style: row({ position: 'absolute', right: '3.3%', bottom: '38px', gap: '8px' }),
        small: { right: '14px', bottom: '22px' },
        children: [
          {
            type: 'repeat',
            over: 'home.heroes',
            item: {
              type: 'box',
              press: { action: 'pickHero', arg: '{index}' },
              label: '{s:featuredOf}',
              a11y: { current: [{ test: 'index.current' }] },
              layoutTransition: '260ms ease-out',
              style: dot,
              focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 2px $ink-strong' },
              states: [
                {
                  when: [{ test: 'index.current' }],
                  style: {
                    ...dot,
                    width: '22px',
                    'background-color': '$accent',
                    'background-image': gradient,
                  },
                  focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 2px $ink-strong' },
                },
              ],
            },
          },
        ],
      },
    ],
  },
};

// My Media: one wide tile per library, its artwork behind its name.
const libraryTile = (press: Press, when: Condition[]): Node => ({
  type: 'box',
  when,
  style: col({ width: wideW.style, 'flex-shrink': '0', gap: '7px' }),
  small: { width: wideW.small, gap: '5px' },
  children: [
    {
      type: 'box',
      group: true,
      press,
      label: '{dest.name}',
      testId: 'library-{dest.id}',
      style: {
        position: 'relative',
        width: '100%',
        'aspect-ratio': '16 / 9',
        'border-radius': '6px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        color: '$ink-strong',
        cursor: 'pointer',
        'box-shadow': '0px 2px 6px $shadow',
        transition: 'box-shadow 140ms linear',
      },
      small: { 'border-radius': '4px' },
      hover: { 'box-shadow': '0px 0px 0px 3px $accent' },
      focus: { 'box-shadow': '0px 0px 0px 3px $accent', outline: 'auto' },
      children: [
        tile('dest.seed'),
        {
          type: 'image',
          when: [{ test: 'dest.backdrop' }],
          src: '{dest.backdrop}',
          alt: '',
          style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' },
        },
        {
          type: 'box',
          when: [{ test: 'dest.backdrop', not: true }],
          style: col({ ...fill, 'align-items': 'center', 'justify-content': 'center', color: '$secondary' }),
          children: kindGlyphs('dest.kind', 48, {}).map(
            n => ({ ...n, small: { width: '34px', height: '34px' } }) as Node,
          ),
        },
        {
          type: 'box',
          style: {
            ...fill,
            'background-color': '$overlay',
            opacity: '0',
            transition: 'opacity 160ms linear',
          },
          groupHover: { opacity: '0.4' },
          groupFocus: { opacity: '0.4' },
        },
      ],
    },
    {
      type: 'text',
      text: '{dest.name}',
      style: {
        'font-size': '14px',
        'font-weight': '500',
        color: '$ink-strong',
        'text-align': 'center',
        'line-clamp': '1',
      },
      small: { 'font-size': '13px' },
    },
  ],
});
const myMedia: Node = {
  type: 'box',
  when: [
    { test: 'env.searching', not: true },
    { test: 'env.libraryCount', is: 'gt', value: '0' },
  ],
  style: col({ gap: '8px', 'padding-bottom': '26px' }),
  small: { gap: '6px', 'padding-bottom': '18px' },
  children: [
    {
      type: 'text',
      text: '{s:myMedia}',
      role: 'heading',
      level: 2,
      style: {
        'font-size': '21px',
        'font-weight': '600',
        color: '$ink-strong',
        ...side,
        'min-height': '40px',
        display: 'flex',
        'align-items': 'center',
      },
      small: { 'font-size': '17px', ...sideSmall },
    },
    {
      type: 'box',
      style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }),
      children: [
        {
          type: 'box',
          style: row({ gap: '16px', 'padding-top': '4px', 'padding-bottom': '6px', ...side }),
          small: { gap: '10px', ...sideSmall },
          children: [
            {
              type: 'repeat',
              over: 'nav.destinations',
              item: {
                type: 'box',
                style: row({ 'flex-shrink': '0' }),
                children: [
                  libraryTile({ action: 'live' }, [isLive, { test: 'nav.showLive' }]),
                  libraryTile({ action: 'library', arg: '{dest.id}' }, [not(isLive)]),
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

// Search: a field that stays folded away until the header's search opens it or it holds a query.
const open: Condition[][] = [[{ test: 'env.searchFocused' }], [{ test: 'env.searching' }]];
const folded: Style = col({
  'overflow-x': 'hidden',
  'overflow-y': 'hidden',
  'max-height': '0px',
  opacity: '0',
  transition: 'opacity 160ms linear',
  'flex-shrink': '0',
});
const searchBox: Style = row({
  position: 'relative',
  margin: '18px auto 6px',
  width: 'calc(100% - 28px)',
  'max-width': '760px',
  height: '48px',
  'box-sizing': 'border-box',
  'align-items': 'center',
  gap: '10px',
  padding: '0px 6px 0px 14px',
  'border-radius': '4px',
  'background-color': '$field',
  border: '1px solid $field',
  'flex-shrink': '0',
});
const searchField: Node = {
  type: 'box',
  style: folded,
  layoutTransition: '220ms ease-out',
  states: open.map(when => ({ when, style: { ...folded, 'max-height': '96px', opacity: '1' } })),
  children: [
    {
      type: 'box',
      style: searchBox,
      states: [
        {
          when: [{ test: 'env.searchFocused' }],
          style: {
            ...searchBox,
            'border-color': '$accent',
            'border-top-color': '$accent',
            'border-bottom-color': '$accent',
          },
        },
      ],
      children: [
        glyph('search', 20, {
          style: { width: '20px', height: '20px', 'flex-shrink': '0', color: '$secondary' },
          states: [
            {
              when: [{ test: 'env.searchFocused' }],
              style: { width: '20px', height: '20px', 'flex-shrink': '0', color: '$accent' },
            },
          ],
        }),
        {
          type: 'widget',
          widget: 'searchInput',
          params: { placeholder: '{s:search}', label: '{s:searchLibrary}', placeholderColor: '$quiet' },
          style: {
            flex: '1',
            'min-width': '0px',
            height: '100%',
            color: '$ink-strong',
            'font-size': '16px',
            outline: 'none',
          },
        },
        {
          type: 'box',
          when: [{ test: 'env.searching' }],
          press: { action: 'clearSearch' },
          label: '{s:clearSearch}',
          style: iconBtn(36),
          hover: iconBtnHover,
          focus: iconBtnFocus,
          children: [glyph('close', 18)],
        },
      ],
    },
  ],
} as Node;

export const home: Node = {
  type: 'box',
  style: col({ 'padding-bottom': '40px', color: '$ink', 'font-family': sans }),
  children: [
    waiting(140, '{s:findingEvening}'),
    failure('{s:homeFailed}'),
    ...(
      [
        searchField,
        { type: 'box', style: col(), children: [mediaBar] },
        {
          type: 'box',
          when: [
            { test: 'env.searching', not: true },
            { test: 'env.heroCount', is: 'eq', value: '0' },
          ],
          style: { height: '22px', 'flex-shrink': '0' },
          small: { height: '14px' },
        },
        myMedia,
        // Repeats sit in a container: a repeat's own style (its flex order among these nodes) belongs to its items.
        {
          type: 'box',
          when: [{ test: 'env.searching', not: true }],
          style: col(),
          children: [
            {
              type: 'repeat',
              over: 'home.rows',
              item: section('row.items', [sectionTitle('{row.name}')], { test: 'row.landscape' }, true),
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'env.searching', not: true }, { test: 'env.homeHasMore' }],
          style: col({
            position: 'relative',
            height: '100px',
            'align-items': 'center',
            'justify-content': 'center',
            'flex-shrink': '0',
          }),
          children: [
            { type: 'widget', widget: 'sentinel', params: { on: 'home' }, style: fill },
            {
              type: 'box',
              when: [{ test: 'env.homeMoreLoading' }],
              role: 'status',
              label: '{s:loadingMore}',
              style: row(),
              children: [spinner(36)],
            },
          ],
        },
        emptyState(jelly('folder', 44), '{s:nothingHere}', '{s:noRows}', [
          { test: 'env.searching', not: true },
          { test: 'env.rowCount', is: 'eq', value: '0' },
          { test: 'env.heroCount', is: 'eq', value: '0' },
        ]),
      ] as Node[]
    ).map(n => ({ ...n, when: [ready, ...(n.when ?? [])] }) as Node),
  ],
};

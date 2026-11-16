// A library page: kind tabs, the toolbar with its sort and filter menus, and the poster grid.
import type { Condition, Node, Style } from '../../../skin';
import {
  type Press,
  sans,
  side,
  sideSmall,
  row,
  col,
  hairline,
  glyph,
  iconBtn,
  iconBtnHover,
  iconBtnFocus,
  menuRow,
  sheet,
  tabNode,
  spinner,
  emptyState,
  ready,
  waiting,
  failure,
  raised,
} from './look';

// A library: its tabs (everything, then each kind the server offers), a toolbar with favourites,
// sort and filter menus, then the titles in a grid in server order.
const libraryTab = (label: string, on: Condition, arg: string, when: Condition[] = []): Node =>
  tabNode(label, on, { action: 'libraryFilter', arg }, { name: 'jt-library-tab', bottom: 0 }, { when });
// One choice in a menu, with a check beside the current one.
const choice = (label: string, on: Condition, press: Press, when: Condition[] = []): Node =>
  ({
    type: 'box',
    press,
    label,
    when,
    a11y: { role: 'menuitemradio', checked: [on] },
    style: menuRow,
    hover: { 'background-color': '$hover' },
    focus: { 'background-color': '$hover', outline: 'auto' },
    states: [
      {
        when: [on],
        style: { ...menuRow, color: '$accent' },
        hover: { 'background-color': '$hover' },
        focus: { 'background-color': '$hover', outline: 'auto' },
      },
    ],
    children: [
      glyph('checkmark', 18, {
        style: { width: '18px', height: '18px', 'flex-shrink': '0', opacity: '0' },
        states: [{ when: [on], style: { width: '18px', height: '18px', 'flex-shrink': '0', opacity: '1' } }],
      }),
      { type: 'text', text: label, style: { 'line-clamp': '1' } },
    ],
  }) as Node;
const menuHeading = (text: string, when: Condition[] = [], pad = '8px 16px 4px'): Node => ({
  type: 'text',
  text,
  when,
  style: { 'font-size': '13px', 'font-weight': '600', color: '$secondary', padding: pad },
});
// A hairline between menu groups (like the compiled one it gives way when the menu overflows and scrolls).
const divider = (when: Condition[] = []): Node => ({
  type: 'box',
  when,
  style: { height: '1px', 'background-color': '$line', margin: '6px 0px' },
});
const hasFilters: Condition[][] = [
  [{ test: 'library.canPlayed' }],
  [{ test: 'library.genreCount', is: 'gt', value: '0' }],
  [{ test: 'library.canYear' }],
];
const filtering: Condition[][] = [
  [{ test: 'library.playedFilter' }],
  [{ test: 'library.genreFilter' }],
  [{ test: 'library.year', is: 'gt', value: '0' }],
];
// A menu sheet, anchored under its toolbar button (its right edge 16px inside the button's);
// on a phone, the width of the screen less a margin.
const menuSheet = (
  flag: string,
  label: string,
  width: number,
  shifted: Condition[][],
  returnFocus: string,
  children: Node[],
): Node => {
  const at = (right: string): Style => ({
    ...sheet,
    ...col({
      position: 'absolute',
      top: '94px',
      right,
      'z-index': '6',
      width: `${width}px`,
      'max-height': '70vh',
      'overflow-y': 'auto',
      'overflow-x': 'hidden',
    }),
  });
  return {
    type: 'box',
    when: [{ test: `flag:${flag}` }],
    role: 'dialog',
    label,
    escape: flag,
    returnFocus,
    style: at('calc(3.3% + 16px)'),
    states: shifted.map(when => ({ when, style: at('calc(3.3% + 60px)') })),
    small: { left: '0px', right: 'auto', width: 'calc(100vw - 28px)' },
    children,
  } as Node;
};
const toolBtn = (
  testId: string,
  domId: string,
  label: string,
  press: Press,
  icon: Node,
  extra: Partial<Node> = {},
): Node =>
  ({
    type: 'box',
    id: domId,
    testId,
    press,
    label,
    style: iconBtn(40),
    hover: iconBtnHover,
    focus: iconBtnFocus,
    children: [icon],
    ...extra,
  }) as Node;
const sortButton = (when: Condition[]): Node =>
  toolBtn('jt-sort', 'jt-library-sort', '{s:sortBy}', { action: 'only', arg: 'sort' }, glyph('sort', 21), {
    when,
    a11y: { haspopup: 'dialog', expanded: [{ test: 'flag:sort' }] },
  });
const filterIcon: Style = { ...iconBtn(40) };

const libraryHeader: Node = {
  type: 'box',
  style: col({ position: 'sticky', top: '0px', 'z-index': '5', 'background-color': '$page', ...hairline }),
  children: [
    {
      type: 'text',
      text: '{library.name}',
      role: 'heading',
      level: 1,
      style: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        opacity: '0',
        'pointer-events': 'none',
      },
    },
    {
      type: 'box',
      role: 'tablist',
      label: '{library.name}',
      style: row({
        'overflow-x': 'auto',
        'overflow-y': 'hidden',
        'scrollbar-width': 'none',
        'box-sizing': 'border-box',
        padding: '6px 8px 0px',
      }),
      children: [
        { type: 'box', style: { flex: '1' } },
        libraryTab('{library.name}', { test: 'library.kindFilter', not: true }, 'kind|'),
        {
          type: 'repeat',
          over: 'library.kinds',
          when: [{ test: 'library.kindCount', is: 'gt', value: '1' }],
          item: libraryTab('{opt.label}', { test: 'opt.on' }, 'kind|{opt.id}'),
        },
        { type: 'box', style: { flex: '1' } },
      ],
    },
    {
      type: 'box',
      role: 'toolbar',
      label: '{s:libraryTools}',
      style: row({
        'align-items': 'center',
        gap: '4px',
        ...side,
        'padding-top': '4px',
        'padding-bottom': '6px',
      }),
      small: sideSmall,
      children: [
        {
          type: 'text',
          when: [{ test: 'library.sortCount', is: 'gt', value: '0' }],
          text: '{library.sortLabel}',
          style: {
            'font-size': '13px',
            color: '$secondary',
            flex: '1',
            'min-width': '0px',
            'line-clamp': '1',
          },
        },
        { type: 'box', when: [{ test: 'library.sortCount', is: 'eq', value: '0' }], style: { flex: '1' } },
        toolBtn(
          'jt-favourites',
          'jt-library-favourites',
          '{s:favourites}',
          { action: 'libraryFilter', arg: 'favorite|true' },
          glyph('heart', 21),
          {
            when: [{ test: 'library.canFavorite' }, { test: 'library.favoriteFilter', not: true }],
            a11y: { pressed: [{ test: 'library.favoriteFilter' }] },
          },
        ),
        toolBtn(
          'jt-favourites',
          'jt-library-favourites',
          '{s:favourites}',
          { action: 'libraryFilter', arg: 'favorite|' },
          glyph('heart-fill', 21),
          {
            when: [{ test: 'library.canFavorite' }, { test: 'library.favoriteFilter' }],
            a11y: { pressed: [{ test: 'library.favoriteFilter' }] },
            style: { ...iconBtn(40), color: '$accent' },
          },
        ),
        sortButton([{ test: 'library.sortCount', is: 'gt', value: '1' }]),
        sortButton([{ test: 'library.sortCount', is: 'lt', value: '2' }, { test: 'library.canFlip' }]),
        ...hasFilters.map((w, i) =>
          toolBtn(
            'jt-filter',
            'jt-library-filter',
            '{s:filters}',
            { action: 'only', arg: 'filter' },
            glyph('filter', 21),
            {
              // Shown once, by the first condition that holds; accent while a filter is on.
              when: [
                ...hasFilters.slice(0, i).map(
                  c =>
                    ({
                      ...c[0],
                      ...(c[0].is === 'gt' ? { is: 'lt', value: '1' } : { not: true }),
                    }) as Condition,
                ),
                ...w,
              ],
              a11y: { haspopup: 'dialog', expanded: [{ test: 'flag:filter' }] },
              style: filterIcon,
              states: filtering.map(f => ({
                when: f,
                style: { ...filterIcon, color: '$accent' },
                hover: iconBtnHover,
                focus: iconBtnFocus,
              })),
            },
          ),
        ),
      ],
    },
    // A tap outside an open menu closes it.
    {
      type: 'box',
      when: [{ test: 'flag:sort' }],
      press: { action: 'close', arg: 'sort' },
      label: '{s:close}',
      controlStates: false,
      style: {
        position: 'absolute',
        top: '0px',
        left: '0px',
        width: '100vw',
        height: '100vh',
        'z-index': '5',
        'background-color': 'transparent',
      },
    } as Node,
    {
      type: 'box',
      when: [{ test: 'flag:filter' }],
      press: { action: 'close', arg: 'filter' },
      label: '{s:close}',
      controlStates: false,
      style: {
        position: 'absolute',
        top: '0px',
        left: '0px',
        width: '100vw',
        height: '100vh',
        'z-index': '5',
        'background-color': 'transparent',
      },
    } as Node,
    menuSheet('sort', '{s:sortBy}', 280, hasFilters, 'jt-library-sort', [
      menuHeading('{s:sortBy}'),
      {
        type: 'repeat',
        over: 'library.sorts',
        item: choice('{opt.label}', { test: 'opt.on' }, { action: 'librarySort', arg: '{opt.id}' }),
      },
      divider([{ test: 'library.canFlip' }]),
      menuHeading('{s:sortOrder}', [{ test: 'library.canFlip' }]),
      choice(
        '{s:ascending}',
        { test: 'library.direction', is: 'eq', value: 'asc' },
        { action: 'librarySort', arg: '{library.sort}' },
        [{ test: 'library.canFlip' }, { test: 'library.direction', is: 'eq', value: 'asc' }],
      ),
      choice(
        '{s:ascending}',
        { test: 'library.direction', is: 'eq', value: 'asc' },
        { action: 'librarySortFlip' },
        [{ test: 'library.canFlip' }, { test: 'library.direction', is: 'ne', value: 'asc' }],
      ),
      choice(
        '{s:descending}',
        { test: 'library.direction', is: 'eq', value: 'desc' },
        { action: 'librarySort', arg: '{library.sort}' },
        [{ test: 'library.canFlip' }, { test: 'library.direction', is: 'eq', value: 'desc' }],
      ),
      choice(
        '{s:descending}',
        { test: 'library.direction', is: 'eq', value: 'desc' },
        { action: 'librarySortFlip' },
        [{ test: 'library.canFlip' }, { test: 'library.direction', is: 'ne', value: 'desc' }],
      ),
    ]),
    // The filter menu opens under the rightmost button;
    // the sort menu, one button to its left, moves over when it is there.
    menuSheet('filter', '{s:filters}', 300, [], 'jt-library-filter', [
      menuHeading('{s:status}', [{ test: 'library.canPlayed' }]),
      choice(
        '{s:all}',
        { test: 'library.playedFilter', not: true },
        { action: 'libraryFilter', arg: 'played|' },
        [{ test: 'library.canPlayed' }],
      ),
      choice(
        '{s:unplayed}',
        { test: 'library.playedFilter', is: 'eq', value: 'false' },
        { action: 'libraryFilter', arg: 'played|false' },
        [{ test: 'library.canPlayed' }],
      ),
      choice(
        '{s:played}',
        { test: 'library.playedFilter', is: 'eq', value: 'true' },
        { action: 'libraryFilter', arg: 'played|true' },
        [{ test: 'library.canPlayed' }],
      ),
      divider([{ test: 'library.genreCount', is: 'gt', value: '0' }]),
      menuHeading('{s:genres}', [{ test: 'library.genreCount', is: 'gt', value: '0' }]),
      choice(
        '{s:anyGenre}',
        { test: 'library.genreFilter', not: true },
        { action: 'libraryFilter', arg: 'genre|' },
        [{ test: 'library.genreCount', is: 'gt', value: '0' }],
      ),
      {
        type: 'repeat',
        over: 'library.genres',
        item: choice('{opt.label}', { test: 'opt.on' }, { action: 'libraryFilter', arg: 'genre|{opt.id}' }),
      },
      divider([{ test: 'library.canYear' }]),
      {
        type: 'box',
        when: [{ test: 'library.canYear' }],
        style: col({ gap: '6px', padding: '8px 16px 10px' }),
        children: [
          {
            type: 'text',
            text: '{s:year}',
            style: { 'font-size': '13px', 'font-weight': '600', color: '$secondary' },
          },
          {
            type: 'widget',
            widget: 'yearInput',
            params: { placeholder: '{s:anyYear}', label: '{s:year}' },
            style: {
              'box-sizing': 'border-box',
              width: '100%',
              height: '40px',
              padding: '0px 10px',
              border: '1px solid $field',
              'border-radius': '4px',
              'background-color': '$field',
              color: '$ink-strong',
              'font-size': '15px',
            },
          },
        ],
      },
    ]),
  ],
};

const libraryGrid: Node = {
  type: 'box',
  style: {
    display: 'grid',
    'grid-template-columns': 'repeat(auto-fill, minmax(160px, 1fr))',
    'column-gap': '18px',
    'row-gap': '26px',
    ...side,
  },
  small: {
    'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
    'column-gap': '10px',
    'row-gap': '16px',
    ...sideSmall,
  },
  children: [{ type: 'repeat', over: 'library.items', item: { type: 'use', template: 'gridPoster' } }],
};
export const library: Node = {
  type: 'box',
  style: col({ 'min-height': '100%', color: '$ink', 'font-family': sans, 'padding-bottom': '56px' }),
  children: [
    waiting(140, '{s:findingTitles}'),
    failure('{s:libraryFailed}'),
    ...(
      [
        libraryHeader,
        {
          type: 'box',
          style: col({ 'padding-top': '22px' }),
          small: { 'padding-top': '14px' },
          children: [
            {
              type: 'box',
              when: [{ test: 'env.libraryLoading' }, { test: 'library.itemCount', is: 'eq', value: '0' }],
              role: 'status',
              label: '{s:findingTitles}',
              style: row({ 'justify-content': 'center', padding: '64px' }),
              children: [spinner(48)],
            },
            emptyState(glyph('filter', 44), '{s:libraryEmpty}', '{s:libraryEmptyHint}', [
              { test: 'env.libraryLoading', not: true },
              { test: 'library.itemCount', is: 'eq', value: '0' },
            ]),
            {
              type: 'box',
              when: [{ test: 'library.itemCount', is: 'gt', value: '0' }],
              style: col({ opacity: '1', transition: 'opacity 160ms linear' }),
              states: [
                {
                  when: [{ test: 'env.libraryLoading' }],
                  style: col({ opacity: '0.6', transition: 'opacity 160ms linear' }),
                },
              ],
              children: [libraryGrid],
            },
            {
              type: 'box',
              when: [{ test: 'library.itemCount', is: 'gt', value: '0' }, { test: 'library.more' }],
              style: row({ 'justify-content': 'center', 'padding-top': '28px' }),
              children: [
                {
                  type: 'box',
                  when: [{ test: 'env.libraryMoreLoading' }],
                  role: 'status',
                  label: '{s:loadingMore}',
                  style: row(),
                  children: [spinner(36)],
                },
                {
                  type: 'box',
                  when: [{ test: 'env.libraryMoreLoading', not: true }],
                  press: { action: 'libraryMore' },
                  label: '{s:showMore}',
                  testId: 'jt-more',
                  style: raised,
                  hover: { 'background-color': '$raised-hover' },
                  focus: { 'box-shadow': '0px 0px 0px 2px $accent', outline: 'auto' },
                  children: [{ type: 'text', text: '{s:showMore}' }],
                },
              ],
            },
          ],
        },
      ] as Node[]
    ).map(n => ({ ...n, when: [ready, ...(n.when ?? [])] }) as Node),
  ],
};

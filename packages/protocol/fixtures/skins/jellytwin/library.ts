// A library page: kind tabs, the toolbar with its sort and filter menus, and the poster grid.
import type { Node } from '../../../skin';
import { sans, side, sideSmall, row, col, hairline, glyph, spinner, emptyState, ready, waiting, failure, raised } from './look';

const libraryHeader: Node = {
  type: 'box',
  style: col({ position: 'sticky', top: '0px', 'z-index': '5', 'background-color': '$page', ...hairline }),
  children: [{ type: 'text', text: '{library.name}', role: 'heading', level: 1, style: { position: 'absolute', width: '1px', height: '1px', opacity: '0' } }, { type: 'use', template: 'velaLibraryViews' }],
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
        { type: 'use', template: 'velaLibraryAlternative' },
        {
          type: 'box',
          when: [{ test: 'library.view', is: 'eq', value: 'library' }],
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

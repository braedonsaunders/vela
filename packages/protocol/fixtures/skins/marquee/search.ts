// Marquee's search field: in the bar's middle on a wide home, in a strip under the bar on phones.
// Typing searches in place on home; elsewhere the bar shows a button that goes there.
import type { Node, Style } from '../../../skin';
import { sans, set, glyph, round } from './look';

const fieldStyle = (focused: boolean): Style => ({
  position: 'relative',
  display: 'flex',
  'flex-direction': 'row',
  width: '100%',
  'max-width': '560px',
  'align-items': 'center',
  gap: '10px',
  height: '38px',
  'box-sizing': 'border-box',
  padding: '0px 4px 0px 12px',
  'border-radius': '6px',
  'background-color': focused ? '$field-focus' : '$field',
  'box-shadow': focused ? '0px 0px 0px 1px $line-strong' : 'none',
  transition: 'background-color 120ms linear, box-shadow 120ms linear',
});

export const searchBox: Node = {
  type: 'box',
  style: fieldStyle(false),
  states: [{ when: [set('env.searchFocused')], style: fieldStyle(true) }],
  children: [
    glyph('search', 18, {
      style: { color: '$ink-faint' },
      states: [
        {
          when: [set('env.searchFocused')],
          style: { width: '18px', height: '18px', 'flex-shrink': '0', color: '$ink' },
        },
      ],
    } as Partial<Node>),
    {
      type: 'widget',
      widget: 'searchInput',
      params: {
        placeholder: '{s:search}',
        label: '{s:searchYourLibrary}',
        placeholderColor: '$ink-faint',
      },
      style: {
        flex: '1',
        'min-width': '0px',
        height: '100%',
        padding: '0px',
        outline: 'none',
        color: '$ink',
        'font-size': '15px',
        'font-family': sans,
      },
    },
    {
      type: 'box',
      when: [set('env.searching')],
      press: { action: 'clearSearch' },
      label: '{s:clearSearch}',
      ...round(30),
      children: [glyph('close', 16)],
    },
  ],
} as Node;

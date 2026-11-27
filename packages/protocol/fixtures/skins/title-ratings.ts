import type { Node } from '../../skin';

/** Keep the source, value and following separator together when the line wraps. */
export function titleRatings(color: string): Node {
  const tv = [{ test: 'env.tv' }];
  return {
    type: 'box',
    testId: 'title-ratings',
    when: [{ test: 'detail.hasRatings' }],
    style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '4px 7px', color },
    children: [{
      type: 'repeat', over: 'detail.ratings', item: {
        type: 'box',
        style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'flex-shrink': '0', gap: '4px' },
        children: [
          ...['rating-tomato', 'rating-splat', 'rating-certified', 'rating-popcorn'].map((symbol): Node => ({
            type: 'icon', symbol,
            when: [{ test: 'rating.icon', is: 'eq', value: symbol }],
            a11y: { hidden: true },
            style: { width: '16px', height: '16px' },
            states: [{ when: tv, style: { width: '22px', height: '22px' } }],
          })),
          {
            type: 'text', text: '{rating.display}', label: '{rating.accessibleLabel}',
            style: { 'font-size': '14px', 'font-variant-numeric': 'tabular-nums' },
            small: { 'font-size': '13px' },
            states: [{ when: tv, style: { 'font-size': '20px' } }],
          },
          {
            type: 'text', text: '·', a11y: { hidden: true },
            when: [{ test: 'rating.hasNext' }],
            style: { 'font-size': '14px' },
            states: [{ when: tv, style: { 'font-size': '20px' } }],
          },
        ],
      },
    }],
  };
}

// Loading and failure states: skeletons, Mochi hopping in a dashed banner, the sad-Mochi bubble with Try again.
import type { Node } from '../../../skin';
import {
  Candy,
  Extra,
  candy,
  col,
  emptyState,
  gutter,
  gutterSmall,
  is,
  loader,
  moving,
  row,
  set,
} from './look';

// A loading placeholder: a candy block swept by a soft highlight (look.contract Skeleton).
export const skeleton = (width: string, height: string, radius: number, extra: Extra = {}): Node =>
  ({
    type: 'box',
    ...extra,
    style: {
      ...col,
      width,
      height,
      'flex-shrink': '0',
      'border-radius': `${radius}px`,
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
      'background-color': '$skeleton',
      ...(extra.style ?? {}),
    },
    children: [
      {
        type: 'box',
        when: [moving],
        motion: 'shimmer',
        style: {
          width: '100%',
          height: '100%',
          'background-image': 'linear-gradient(90deg, $page-clear 0%, $skeleton-light 50%, $page-clear 100%)',
        },
      },
    ],
  }) as Node;
// A row-shaped placeholder while titles load (slots.contract RowSkeleton).
export const rowSkeleton: Node = {
  type: 'box',
  style: { ...col, gap: '18px', 'padding-bottom': '24px' },
  children: [
    {
      type: 'box',
      style: { ...col, ...gutter },
      small: gutterSmall,
      children: [skeleton('190px', '22px', 8)],
    },
    {
      type: 'box',
      style: { ...row, gap: '20px', ...gutter, 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
      small: { gap: '14px', ...gutterSmall },
      children: [0, 1, 2, 3, 4, 5, 6, 7].map(
        () =>
          ({
            type: 'box',
            style: { ...col, gap: '10px', 'flex-shrink': '0' },
            children: [
              skeleton('clamp(146px, 11.6vw, 208px)', 'clamp(219px, 17.4vw, 312px)', 20, {
                small: { width: '132px', height: '198px' },
              }),
              skeleton('70%', '12px', 6),
            ],
          }) as Node,
      ),
    },
  ],
};
// Home while it loads: Mochi hopping inside a banner-shaped frame, the field and rows as
// skeletons; when it fails, a sad Mochi and, when the foundation can ask again, Try again
// (slots.contract Status).
export const homeLoading: Node = {
  type: 'box',
  when: [is('env.load', 'loading')],
  role: 'status',
  label: '{s:findingYourEvening}',
  motion: 'statusIn',
  style: { ...col, 'padding-top': '10px', gap: '34px' },
  small: { 'padding-top': '6px', gap: '26px' },
  children: [
    {
      type: 'box',
      style: {
        ...col,
        position: 'relative',
        'margin-left': 'max(24px, 3.6vw)',
        'margin-right': 'max(24px, 3.6vw)',
        height: 'clamp(380px, 54vh, 560px)',
        'box-sizing': 'border-box',
        border: '3px dashed $shadow',
        'border-radius': '34px',
        'align-items': 'center',
        'justify-content': 'center',
        'background-color': '$lavender-soft',
      },
      small: { 'margin-left': '16px', 'margin-right': '16px', height: '440px', 'border-radius': '26px' },
      children: [
        { ...loader('{s:findingYourEvening}', 80), small: { display: 'none' } } as Node,
        {
          ...loader('{s:findingYourEvening}', 64),
          style: { display: 'none' },
          small: { ...col, 'align-items': 'center', gap: '14px' },
        } as Node,
      ],
    },
    {
      type: 'box',
      style: { ...col, 'align-items': 'center', ...gutter },
      small: gutterSmall,
      children: [skeleton('min(720px, 100%)', '62px', 31)],
    },
    rowSkeleton,
  ],
};
export const retryButton: Node = {
  type: 'box',
  when: [set('env.canRetry')],
  style: { ...row, 'justify-content': 'center' },
  children: [
    {
      type: 'box',
      press: { action: 'retry' },
      label: '{s:tryAgain}',
      style: { ...Candy, height: '46px', padding: '0px 24px' },
      ...candy,
      children: [{ type: 'text', text: '{s:tryAgain}' }],
    },
  ],
};
export const failed = (message: string): Node => ({
  type: 'box',
  when: [is('env.load', 'failed')],
  style: { ...col, 'padding-top': '48px' },
  small: { 'padding-top': '24px' },
  children: [
    {
      type: 'box',
      style: { ...col, gap: '4px' },
      children: [emptyState('sad', '{s:somethingWentQuiet}', message), retryButton],
    },
  ],
});

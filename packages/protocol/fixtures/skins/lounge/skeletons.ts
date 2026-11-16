import type { Node, Style } from '../../../skin';
import { gutter, gutterSmall } from './look';

// Home before it has anything to show: the shelf and two rows in outline, breathing; and if
// the server can't be reached, one sentence and a large Try again a remote can land on.
export const bone = (style: Style): Node => ({
  type: 'box',
  motion: 'pulse',
  style: { 'border-radius': '999px', 'background-color': 'rgba(245, 241, 233, 0.08)', ...style } as Style,
});

export const posterBone: Node = {
  type: 'box',
  motion: 'pulse',
  style: {
    width: 'clamp(150px, 11.2vw, 252px)',
    'aspect-ratio': '2 / 3',
    'flex-shrink': '0',
    'border-radius': 'clamp(12px, 0.9vw, 18px)',
    'background-color': 'rgba(245, 241, 233, 0.06)',
  },
  small: { width: '128px' },
};

export const boneRow: Node = {
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    gap: 'clamp(22px, 2vw, 40px)',
    'padding-bottom': 'clamp(30px, 2.6vw, 52px)',
    'overflow-x': 'hidden',
    ...gutter,
  },
  small: { ...gutterSmall },
  children: [
    bone({ width: 'clamp(160px, 14vw, 280px)', height: 'clamp(18px, 1.4vw, 28px)' } as Style),
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: 'clamp(20px, 1.9vw, 40px)' },
      small: { gap: '14px' },
      children: Array.from({ length: 8 }, () => posterBone),
    },
  ],
};

// The same directional slide is used for section tabs and library views.
export const SECTION_SLIDE_MS = 260;
export type SectionDirection = 1 | -1;

export function sectionDirection(next: number, previous: number): SectionDirection {
  return next >= previous ? 1 : -1;
}

export const slideInForward = { from: { transform: [{ translateX: '100%' }] }, to: { transform: [{ translateX: '0%' }] } };
export const slideInBackward = { from: { transform: [{ translateX: '-100%' }] }, to: { transform: [{ translateX: '0%' }] } };
export const slideOutForward = { from: { transform: [{ translateX: '0%' }] }, to: { transform: [{ translateX: '-100%' }] } };
export const slideOutBackward = { from: { transform: [{ translateX: '0%' }] }, to: { transform: [{ translateX: '100%' }] } };

// The same directional slide is used for section tabs and library views.
export const SECTION_SLIDE_MS = 260;
export type SectionDirection = 1 | -1;

export function sectionDirection(next: number, previous: number): SectionDirection {
  return next >= previous ? 1 : -1;
}

export interface ScenePosition { section: string; current: boolean; visible: boolean; width: number }

/** Resize/keyboard updates settle in place; only a section change starts a slide. */
export function sceneMotion(previous: ScenePosition | null, next: ScenePosition, animated: boolean, direction: SectionDirection) {
  const changed = !previous || previous.section !== next.section || previous.current !== next.current || previous.visible !== next.visible;
  if (!next.visible || !changed || !animated) return { from: 0, to: 0 };
  return next.current ? { from: direction * next.width, to: 0 } : { from: 0, to: -direction * next.width };
}

export const slideInForward = { from: { transform: [{ translateX: '100%' }] }, to: { transform: [{ translateX: '0%' }] } };
export const slideInBackward = { from: { transform: [{ translateX: '-100%' }] }, to: { transform: [{ translateX: '0%' }] } };
export const slideOutForward = { from: { transform: [{ translateX: '0%' }] }, to: { transform: [{ translateX: '-100%' }] } };
export const slideOutBackward = { from: { transform: [{ translateX: '0%' }] }, to: { transform: [{ translateX: '100%' }] } };

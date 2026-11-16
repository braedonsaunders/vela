// Motion presets (docs/skin-schema.md) as Reanimated 4 CSS animations: the library's keyframes,
// a document's own, duration, delay with stagger, easing, iterations, direction and fill. Under
// reduced motion a preset's `still` alternative runs, or nothing.
import { cubicBezier, type CSSAnimationKeyframes } from 'react-native-reanimated';
import { library, type Keyframes } from './keyframes';
export { documentKeyframes, type Motion } from './keyframes';

/** A CSS easing as Reanimated takes it. */
export function easing(text: string | undefined): string | ReturnType<typeof cubicBezier> {
  const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(text?.trim() ?? '');
  if (bezier) {
    const [a, b, c, d] = bezier[1].split(',').map(Number);
    return cubicBezier(a, b, c, d);
  }
  return text && /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/.test(text) ? text : 'ease';
}

/** A node's animation style for its preset, or none. `index` staggers the delay. */
export function animation(preset: Motion | undefined, own: Record<string, Keyframes>, still: boolean, index: number, stagger?: { step: number; cap: number }): Record<string, unknown> | undefined {
  if (!preset) return undefined;
  const name = still ? preset.still?.keyframes : preset.keyframes;
  const keyframes = name && name !== 'none' ? library[name] ?? own[name] : undefined;
  if (!keyframes) return undefined;
  const delay = (still ? 0 : preset.delay ?? 0) + (stagger && !still ? Math.min(index, stagger.cap) * stagger.step : 0);
  return {
    animationName: keyframes as CSSAnimationKeyframes,
    animationDuration: still ? preset.still!.duration : preset.duration,
    animationDelay: delay,
    animationTimingFunction: still ? 'linear' : easing(preset.easing),
    animationIterationCount: still ? 1 : preset.iterations ?? 1,
    animationDirection: still ? 'normal' : preset.direction ?? 'normal',
    animationFillMode: still ? 'both' : preset.fill ?? 'both',
  };
}

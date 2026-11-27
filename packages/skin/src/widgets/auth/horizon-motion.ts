// The horizon scene's ambient motion presets. A document may override any of them by name in
// its `motion` block; these are the defaults. Each loops by alternating direction on a sine-like
// ease, so nothing ever jumps back to its start; geometry moves on slow envelopes (the sail's sway,
// the reflection's ripple) and only light moves faster (the glints, the waiting sweep).
import type { Frame, Motion } from '../../keyframes';

const SINE = 'cubic-bezier(0.45, 0, 0.55, 1)';
const STILL = { keyframes: 'none', duration: 0 };

function ambient(name: string, from: Frame, to: Frame, duration: number, delay = 0): Motion {
  return {
    keyframes: name,
    frames: { [name]: { from, to } },
    duration,
    delay,
    easing: SINE,
    iterations: 'infinite',
    direction: 'alternate',
    fill: 'both',
    still: STILL,
  };
}

export const HORIZON_MOTION: Record<string, Motion> = {
  // The sail rocks a degree on the swell, about its keel.
  velaSailSway: ambient('velaSailSway', { transform: [{ rotate: '-0.7deg' }, { translateY: 0 }] }, { transform: [{ rotate: '0.7deg' }, { translateY: -1.5 }] }, 7400, 1500),
  // Its reflection stretches and settles with the water.
  velaReflectionRipple: ambient('velaReflectionRipple', { opacity: 0.85, transform: [{ scaleX: 1 }, { scaleY: 1 }] }, { opacity: 1, transform: [{ scaleX: 1.045 }, { scaleY: 0.96 }] }, 5300),
  // The glow along the horizon breathes.
  velaHorizonBreath: ambient('velaHorizonBreath', { opacity: 0.72, transform: [{ scaleX: 1 }] }, { opacity: 1, transform: [{ scaleX: 1.08 }] }, 8800),
  // A highlight drifts along the line.
  velaHorizonDrift: ambient('velaHorizonDrift', { transform: [{ translateX: '-18%' }] }, { transform: [{ translateX: '18%' }] }, 21000),
  // Waiting (a code, servers): a brighter light travels the line and back, like a lighthouse.
  velaHorizonSweep: ambient('velaHorizonSweep', { transform: [{ translateX: '-36%' }] }, { transform: [{ translateX: '36%' }] }, 3400),
  // The dusk itself shifts a little.
  velaSkyDrift: ambient('velaSkyDrift', { opacity: 0.8, transform: [{ translateX: '-6%' }, { scale: 1 }] }, { opacity: 1, transform: [{ translateX: '6%' }, { scale: 1.12 }] }, 36000),
  // Glints on the water: each twinkles at its own (prime) pace so the pattern never repeats visibly.
  velaGlint0: ambient('velaGlint0', { opacity: 0.07, transform: [{ translateX: -4 }] }, { opacity: 0.45, transform: [{ translateX: 4 }] }, 2900),
  velaGlint1: ambient('velaGlint1', { opacity: 0.42, transform: [{ translateX: 5 }] }, { opacity: 0.06, transform: [{ translateX: -3 }] }, 3700),
  velaGlint2: ambient('velaGlint2', { opacity: 0.09, transform: [{ translateX: 3 }] }, { opacity: 0.39, transform: [{ translateX: -5 }] }, 4300),
  velaGlint3: ambient('velaGlint3', { opacity: 0.36, transform: [{ translateX: -2 }] }, { opacity: 0.05, transform: [{ translateX: 4 }] }, 5300),
  velaGlint4: ambient('velaGlint4', { opacity: 0.06, transform: [{ translateX: 2 }] }, { opacity: 0.33, transform: [{ translateX: -2 }] }, 6100),
  // Under a code: a pool of light breathing while the code waits to be entered.
  velaCodeGlow: ambient('velaCodeGlow', { opacity: 0.45, transform: [{ scaleX: 0.92 }] }, { opacity: 1, transform: [{ scaleX: 1.06 }] }, 2600),
  // Rows not yet found: placeholders breathing on the water.
  velaGhostRow: ambient('velaGhostRow', { opacity: 0.35 }, { opacity: 0.8 }, 1500),
};

/** How long the horizon takes to move between steps: an unhurried, decelerating glide. */
export const HORIZON_MS = 820;
export const HORIZON_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** While the iOS keyboard moves: its own duration on a curve close to its own (nearly linear,
 * settling softly), so the horizon and the step rise with the keys rather than ahead of them. */
export const KEYBOARD_EASE = 'cubic-bezier(0.25, 0.25, 0.2, 1)';

export interface Move {
  ms: number;
  ease: string;
}

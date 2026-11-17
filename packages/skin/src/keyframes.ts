// The motion vocabulary as data: the library's keyframes presets (tools/renderer.ts KEYFRAMES),
// a document's own keyframes, and a preset's shape. Free of React Native, so the resolver and the
// document checker run under Bun.
export type Frame = { opacity?: number; transform?: Record<string, number | string>[] };
export type Keyframes = Record<string, Frame>;

export interface Motion {
  keyframes: string;
  duration: number;
  delay?: number;
  easing?: string;
  fill?: 'none' | 'both' | 'forwards';
  iterations?: number | 'infinite';
  direction?: 'normal' | 'alternate';
  still?: { keyframes: string; duration: number };
}

function frame(text: string): Frame {
  const out: Frame = {};
  const transform: Record<string, number | string>[] = [];
  for (const [, prop, value] of text.matchAll(/(\w+)=("[^"]*"|\S+)/g)) {
    const v = value.replace(/"/g, '');
    if (prop === 'opacity') out.opacity = Number(v);
    else if (prop === 'scale') transform.push({ scale: Number(v) });
    else if (prop === 'rotate') transform.push({ rotate: `${Number(v)}deg` });
    else if (prop === 'translate') {
      const [x, y = '0px'] = v.split(/\s+/);
      const len = (s: string) => (s.endsWith('%') ? s : parseFloat(s) || 0);
      transform.push({ translateX: len(x) }, { translateY: len(y) });
    }
  }
  if (transform.length) out.transform = transform;
  return out;
}

/** The library's presets, in the compiled renderer's syntax (tools/renderer.ts KEYFRAMES). */
const LIBRARY: Record<string, string> = {
  rise: 'from opacity=0 translate="0px 22px"', dissolve: 'from opacity=0', vanish: 'to opacity=0',
  pop: 'from opacity=0 scale=0.94 translate="0px -6px"', open: 'from opacity=0 scale=0.94 translate="0px 28px"', expose: 'from opacity=0 scale=1.08',
  drift: 'from scale=1.04 translate="0px 0px"\nto scale=1.14 translate="-2.4% -1.6%"', fill: 'from translate="-100% 0px"\nto translate="0px 0px"',
  shimmer: 'from translate="-100% 0px"\nto translate="100% 0px"', spin: 'from rotate=0\nto rotate=360', breathe: '50% opacity=0.45', glow: '50% opacity=0.75 scale=1.06',
  float: '50% translate="0px -8px"', bounce: '30% translate="0px -14px" scale=1.04\n60% translate="0px 0px" scale=0.98', twinkle: '50% opacity=0.2 scale=0.7',
  slideUp: 'from translate="0px 100%"', slideIn: 'from opacity=0 translate="-24px 0px"', zoom: 'from opacity=0 scale=0.8', wiggle: '25% rotate=-4\n75% rotate=4',
  auroraA: 'from translate="-8% -6%" scale=1\nto translate="10% 8%" scale=1.25', auroraB: 'from translate="12% 6%" scale=1.2\nto translate="-10% -8%" scale=0.95',
  auroraC: 'from translate="0% 10%" scale=0.9\nto translate="-6% -12%" scale=1.2', scan: 'from translate="0px -100%"\nto translate="0px 100%"',
  sway: '25% rotate=-1.5\n75% rotate=1.5', sheen: 'from translate="-120% 0px"\nto translate="120% 0px"', tick: '50% opacity=0',
  tvOn: 'from opacity=0 scale=0.02\n40% opacity=1 scale=1.02', jitter: '20% translate="-3px 0px"\n40% translate="3px 0px"\n60% translate="-2px 0px"\n80% translate="2px 0px"',
};

export const library: Record<string, Keyframes> = Object.fromEntries(Object.entries(LIBRARY).map(([name, text]) => [
  name,
  Object.fromEntries(text.split('\n').map(line => {
    const [at, ...rest] = line.trim().split(' ');
    return [at, frame(rest.join(' '))];
  })),
]));

/** A document's own keyframes (`doc:<name>`): opacity, translate, scale and rotate. */
export function documentKeyframes(own: Record<string, Record<string, { opacity?: number; translate?: string; scale?: number; rotate?: number }>> | undefined): Record<string, Keyframes> {
  return Object.fromEntries(Object.entries(own ?? {}).map(([name, steps]) => [
    `doc:${name}`,
    Object.fromEntries(Object.entries(steps).map(([at, p]) => [at, frame(Object.entries(p).map(([k, v]) => `${k}="${v}"`).join(' '))])),
  ]));
}


/** The final explicit keyframe for content mounted after its entrance has settled. */
export function settledFrame(preset: Motion, own: Record<string, Keyframes>, still: boolean): Frame | undefined {
  if (preset.iterations === 'infinite') return undefined;
  const name = still ? preset.still?.keyframes : preset.keyframes;
  const frames = name && name !== 'none' ? library[name] ?? own[name] : undefined;
  return frames?.to ?? frames?.['100%'];
}

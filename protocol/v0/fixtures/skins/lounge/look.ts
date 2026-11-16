import type { Style } from '../../../skin';

// Ten-foot geometry: sizes scale with the screen between a 1280 laptop and a 1920 TV,
// and the gutters keep the TV's 5% overscan margin (Apple TV's 90 px at 1080p).
export const side = 'max(48px, 5vw)';

export const gutter = { 'padding-left': side, 'padding-right': side } as Style;

export const gutterSmall = { 'padding-left': '20px', 'padding-right': '20px' } as Style;

export const sans =
  'system-ui, -apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", Roboto, sans-serif';

export const ease = 'cubic-bezier(0.2, 0.9, 0.25, 1)';

export const lift = [
  `scale 420ms ${ease}`,
  `translate 420ms ${ease}`,
  `box-shadow 420ms ${ease}`,
  'background-color 200ms linear',
  'color 200ms linear',
].join(', ');

// The focus language, one recipe everywhere: white light on the edge, a warm halo, a deep shadow.
export const ring = [
  '0px 0px 0px 4px rgba(255, 255, 255, 0.94)',
  '0px 30px 60px -14px rgba(0, 0, 0, 0.85)',
  '0px 0px 60px 6px rgba(220, 185, 152, 0.30)',
].join(', ');

export const rest = '0px 0px 0px 1px rgba(255, 255, 255, 0.08), 0px 14px 30px -16px rgba(0, 0, 0, 0.8)';

// A capsule button: glass at rest, white with dark ink when focused (the tvOS idiom).
export const capsule = (height: string): Style =>
  ({
    position: 'relative',
    display: 'flex',
    'flex-direction': 'row',
    'align-items': 'center',
    'justify-content': 'center',
    gap: '14px',
    'box-sizing': 'border-box',
    height,
    'padding-left': 'clamp(26px, 2vw, 40px)',
    'padding-right': 'clamp(28px, 2.2vw, 44px)',
    'border-radius': '999px',
    'flex-shrink': '0',
    'background-color': 'rgba(255, 255, 255, 0.14)',
    'backdrop-filter': 'blur(28px) saturate(1.4)',
    color: '$ink',
    'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.10)',
    'font-size': 'clamp(17px, 1.3vw, 25px)',
    'font-weight': '650',
    transition: lift,
  }) as Style;

export const capsuleFocus: Style = {
  'background-color': '$ink',
  color: '$ground',
  scale: '1.08',
  'box-shadow': '0px 18px 44px -10px rgba(0, 0, 0, 0.7), 0px 0px 44px 4px rgba(220, 185, 152, 0.35)',
} as Style;

// The band of light that crosses a card as it takes focus, at a given strength.
export const glint = (alpha: string) =>
  `linear-gradient(100deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, ${alpha}) 50%, rgba(255, 255, 255, 0) 100%)`;

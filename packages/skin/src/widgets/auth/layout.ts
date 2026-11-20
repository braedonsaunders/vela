import type { Viewport } from '../../css';

/** Android TV's IME already resizes the app window. Applying KeyboardAvoidingView's height
 * reduction as well can collapse the served TextInput and make the TV keyboard restart focus. */
export function keyboardAvoidanceEnabled(os: string, tv: boolean): boolean {
  return os !== 'web' && !(os === 'android' && tv);
}

/** Sizes in the usable auth area. Height reduces decoration; only a small touch
 * viewport may change the form structure. Foldables/tablets keep the column. */
export function authLayout(viewport: Viewport, availableHeight = viewport.height, tv = false, touch = false) {
  const height = Math.max(0, availableHeight - viewport.insets.top - viewport.insets.bottom);
  const compact = !tv && touch && Math.min(viewport.width, viewport.height) < 600;
  const landscape = compact && viewport.width > viewport.height;
  const tight = !tv && height < 760;
  const padding = compact ? (height < 420 ? 8 : 16) : tight ? 16 : Math.max(28, viewport.height * 0.07);
  const logoHeight = compact ? (height < 580 ? 0 : tight ? 44 : 64) : tight ? 44 : 104;
  const gap = compact ? (tight ? 8 : 16) : tight ? 12 : 24;
  const cardHeight = Math.max(0, height - padding * 2 - (logoHeight ? logoHeight + gap : 0));
  const minimal = compact && cardHeight < 330;
  return { compact, landscape, tight, minimal, padding, logoHeight, gap, cardHeight,
    headingSize: tight ? 24 : compact ? 30 : 42 };
}

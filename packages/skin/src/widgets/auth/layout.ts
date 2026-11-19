import type { Viewport } from '../../css';

/** Sizes in the usable auth area, before any content is laid out. */
export function authLayout(viewport: Viewport, availableHeight = viewport.height, tv = false) {
  const height = Math.max(0, availableHeight - viewport.insets.top - viewport.insets.bottom);
  const compact = !tv && (Math.min(viewport.width, viewport.height) < 600 || height < 760);
  const landscape = compact && viewport.width > viewport.height;
  const tight = compact && height < 700;
  const padding = compact ? (height < 420 ? 8 : 16) : Math.max(28, viewport.height * 0.07);
  const logoHeight = compact ? (height < 580 ? 0 : tight ? 44 : 64) : 104;
  const gap = compact ? (tight ? 8 : 16) : 32;
  const cardHeight = Math.max(0, height - padding * 2 - (logoHeight ? logoHeight + gap : 0));
  const minimal = compact && cardHeight < 330;
  return { compact, landscape, tight, minimal, padding, logoHeight, gap, cardHeight,
    headingSize: tight ? 24 : compact ? 30 : 42 };
}

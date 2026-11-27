/** A paired light/dark inset ring stays visible on either artwork or a solid fill.
 * Keeping it inside the control also survives clipped rows, cards and guide cells.
 *
 * `around` is for a line of text the document marks as a reading stop (a menu's About line): such a
 * box has no padding of its own, so the inset ring and its dark band fell on the glyphs and clipped
 * them. Its ring sits just outside the box instead, clear of the text. */
export function focusStyle(transform?: unknown, still = false, around = false) {
  return {
    opacity: 1,
    outlineColor: '#ffffff',
    outlineStyle: 'solid' as const,
    outlineWidth: around ? 2 : 3,
    outlineOffset: around ? AROUND_OFFSET : -3,
    ...(around ? {} : { boxShadow: 'inset 0px 0px 0px 5px #101216' }),
    ...(!still ? { transform: [...(Array.isArray(transform) ? transform : []), { scale: 1.025 }] } : {}),
  };
}

/** How far outside a marked reading stop its ring sits: room for the glyphs' side bearings. */
export const AROUND_OFFSET = 6;

/** A final web fallback for controls and native selects. Text fields are left out: every one draws
 * its own focus look (its box's border and halo), and a browser counts any clicked field as
 * focus-visible, so the fallback drew a hard white rectangle over the field's own look.
 * !important deliberately wins over controls that suppress the platform outline inline. */
export const FOCUS_CSS = `
:where(button, select, [tabindex]):not(input, textarea, [data-vela-focus="frame"], [data-vela-focus="timeline"]):focus-visible {
  outline: 3px solid #fff !important;
  outline-offset: -3px !important;
  box-shadow: inset 0 0 0 5px #101216 !important;
  scale: 1.025;
}
/* A timeline spans the picture: a fine inset edge is enough when tabbed to. */
[data-vela-focus="timeline"]:focus-visible {
  outline: 1px solid #ffffff99 !important;
  outline-offset: -1px !important;
  box-shadow: none !important;
}
@media (prefers-reduced-motion: reduce) {
  :where(button, select, [tabindex]):not(input, textarea, [data-vela-focus="frame"], [data-vela-focus="timeline"]):focus-visible { scale: none; }
}
@media (forced-colors: active) {
  :where(button, select, [tabindex]):not(input, textarea, [data-vela-focus="frame"], [data-vela-focus="timeline"]):focus-visible { outline-color: Highlight !important; }
  [data-vela-focus="timeline"]:focus-visible { outline-color: Highlight !important; }
}
`;

/** A paired light/dark inset ring stays visible on either artwork or a solid fill.
 * Keeping it inside the control also survives clipped rows, cards and guide cells. */
export function focusStyle(transform?: unknown, still = false) {
  return {
    opacity: 1,
    outlineColor: '#ffffff',
    outlineStyle: 'solid' as const,
    outlineWidth: 3,
    outlineOffset: -3,
    boxShadow: 'inset 0px 0px 0px 5px #101216',
    ...(!still ? { transform: [...(Array.isArray(transform) ? transform : []), { scale: 1.025 }] } : {}),
  };
}

/** A final web fallback for controls and native selects. Text fields are left out: every one draws
 * its own focus look (its box's border and halo), and a browser counts any clicked field as
 * focus-visible, so the fallback drew a hard white rectangle over the field's own look.
 * !important deliberately wins over controls that suppress the platform outline inline. */
export const FOCUS_CSS = `
:where(button, select, [tabindex]):not(input, textarea, [data-vela-focus="frame"]):focus-visible {
  outline: 3px solid #fff !important;
  outline-offset: -3px !important;
  box-shadow: inset 0 0 0 5px #101216 !important;
  scale: 1.025;
}
@media (prefers-reduced-motion: reduce) {
  :where(button, select, [tabindex]):not(input, textarea, [data-vela-focus="frame"]):focus-visible { scale: none; }
}
@media (forced-colors: active) {
  :where(button, select, [tabindex]):not(input, textarea, [data-vela-focus="frame"]):focus-visible { outline-color: Highlight !important; }
}
`;

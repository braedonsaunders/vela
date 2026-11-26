interface ToastPlacementInput {
  pathname: string;
  photoFullscreen: boolean;
  titleControlsBottoms?: readonly number[];
  sectionTop: number;
  titleFallbackBottom: number;
  clearance: number;
}

/** Keep alerts outside title controls and hold them while the photo owns the display. */
export function surfaceToastPlacement({
  pathname, photoFullscreen, titleControlsBottoms, sectionTop, titleFallbackBottom, clearance,
}: ToastPlacementInput): { top: number; deferred: boolean } {
  const title = pathname.startsWith('/title/');
  const chrome = titleControlsBottoms?.length ? Math.max(...titleControlsBottoms) : titleFallbackBottom;
  return {
    top: title ? Math.max(sectionTop, chrome + clearance) : sectionTop,
    deferred: title && photoFullscreen,
  };
}

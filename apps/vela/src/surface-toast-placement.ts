interface ToastPlacementInput {
  pathname: string;
  photoFullscreen: boolean;
  titleControlsBottoms?: readonly number[];
  sectionTop: number;
  titleFallbackBottom: number;
  clearance: number;
}

/** Keep alerts outside title controls and hold them while the photo owns the display, or while the
 * Downloads library is open: its rows' actions span the page's width, so a corner alert would sit on them. */
export function surfaceToastPlacement({
  pathname, photoFullscreen, titleControlsBottoms, sectionTop, titleFallbackBottom, clearance,
}: ToastPlacementInput): { top: number; deferred: boolean } {
  const title = pathname.startsWith('/title/');
  const chrome = titleControlsBottoms?.length ? Math.max(...titleControlsBottoms) : titleFallbackBottom;
  return {
    top: title ? Math.max(sectionTop, chrome + clearance) : sectionTop,
    deferred: (title && photoFullscreen) || pathname === '/downloads',
  };
}

interface ToastPlacementInput {
  pathname: string;
  photoFullscreen: boolean;
  titleControlsBottom?: number;
  sectionTop: number;
  titleFallbackBottom: number;
  clearance: number;
}

/** Keep alerts outside title controls and hold them while the photo owns the display. */
export function surfaceToastPlacement({
  pathname, photoFullscreen, titleControlsBottom, sectionTop, titleFallbackBottom, clearance,
}: ToastPlacementInput): { top: number; deferred: boolean } {
  const title = pathname.startsWith('/title/');
  return {
    top: title ? Math.max(sectionTop, (titleControlsBottom ?? titleFallbackBottom) + clearance) : sectionTop,
    deferred: title && photoFullscreen,
  };
}

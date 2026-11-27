type ScrubBounds = { x: number; width: number };
export type MiniScrub = {
  pageX: number;
  released: boolean;
  bounds?: ScrubBounds;
};

export function miniScrubPosition(pageX: number, { x, width }: ScrubBounds, duration: number): number {
  return Math.min(1, Math.max(0, (pageX - x) / Math.max(1, width))) * duration;
}

/** Release clears the preview immediately. If layout is pending, retain only the seek. */
export function miniScrubResult(gesture: MiniScrub, duration: number) {
  const position = gesture.bounds ? miniScrubPosition(gesture.pageX, gesture.bounds, duration) : null;
  return {
    preview: gesture.released ? null : position,
    seek: gesture.released ? position : null,
  };
}

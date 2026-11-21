/**
 * Whether playback is behind live in a way the viewer should be told about. Live HLS always plays
 * some seconds short of the newest segment on purpose (the latency target), and the edge jumps by
 * a segment each time one is published, so being under the target is normal and changes every few
 * seconds. Only a real lag counts (at least 10 s, or two segments when segments are longer), and
 * once shown it holds until playback is back within 3 s of its usual position, so it cannot flicker.
 */
export function behindLive(lagSeconds: number | null, wasBehind: boolean, segmentSeconds: number): boolean {
  if (lagSeconds === null) return false;
  return wasBehind ? lagSeconds > 3 : lagSeconds >= Math.max(10, 2 * segmentSeconds);
}

/**
 * Seconds playback trails its usual live position (the edge less the latency target), or null when
 * that cannot be told yet: no edge, or a position outside the live window (0 while a channel starts
 * or recovers), which is where the engine is about to be put, not a lag the viewer should hear about.
 */
export function liveLag(edge: number | null, start: number | null, targetSeconds: number, position: number): number | null {
  if (edge === null || !Number.isFinite(position)) return null;
  if (start !== null && position < start - 1) return null;
  return Math.max(0, edge - targetSeconds - position);
}

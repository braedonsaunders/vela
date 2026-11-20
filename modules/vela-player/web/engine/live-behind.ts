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

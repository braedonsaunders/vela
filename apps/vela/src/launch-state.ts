/** Launch is a one-way latch, independent of routes, refreshes and later sign-ins. */
export type LaunchStage = 'intro' | 'exit' | 'done';
export const LAUNCH_BUILD_MS = 2260 + 260; // The final letter has finished lighting.
export function launchDelay(elapsed: number, still: boolean): number {
  return Math.max(0, (still ? 0 : LAUNCH_BUILD_MS) - elapsed);
}
export function searchlightGeometry(width: number, height: number) {
  const vmin = Math.min(width, height);
  const markWidth = Math.min(vmin * 0.42, 300), markHeight = Math.min(vmin * 0.266, 190);
  const scale = Math.min(markWidth / 88, markHeight / 55.8);
  return { markWidth, markHeight, wordWidth: Math.min(vmin * 0.164, 118), wordHeight: Math.min(vmin * 0.073, 52.6),
    scale, offsetX: (markWidth - 88 * scale) / 2, offsetY: (markHeight - 55.8 * scale) / 2 };
}
export function launchReady(phase: string, load: string, fonts: boolean, authRoute: boolean, docError: boolean): boolean {
  return fonts && (docError || ((phase === 'signed-out' || phase === 'offline') && authRoute) ||
    (phase === 'signed-in' && (load === 'ready' || load === 'failed')));
}

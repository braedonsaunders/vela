/** Launch is a one-way latch, independent of routes, refreshes and later sign-ins. */
export type LaunchStage = 'intro' | 'exit' | 'done';
export const LAUNCH_BUILD_MS = 2260 + 260; // The final letter has finished lighting.
export function launchDelay(elapsed: number, still: boolean): number {
  return Math.max(0, (still ? 0 : LAUNCH_BUILD_MS) - elapsed);
}
export { searchlightGeometry } from '@vela/skin/src/widgets/common/searchlight-geometry';
export function launchReady(phase: string, load: string, fonts: boolean, authRoute: boolean, docError: boolean, homeSlow = false): boolean {
  return fonts && (docError || ((phase === 'signed-out' || phase === 'offline') && authRoute) ||
    (phase === 'signed-in' && (load === 'ready' || load === 'failed' || homeSlow)));
}

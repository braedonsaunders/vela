/** Launch is a session latch, independent of routes and section loading. */
export type LaunchStage = 'intro' | 'exit' | 'done';
export interface LaunchState { signedIn: boolean; stage: LaunchStage; run: number }
export function launchSession(state: LaunchState, signedIn: boolean): LaunchState {
  if (state.signedIn === signedIn) return state;
  return { signedIn, stage: signedIn && state.stage === 'done' ? 'intro' : state.stage,
    run: signedIn && state.stage === 'done' ? state.run + 1 : state.run };
}
export function launchReady(phase: string, load: string, fonts: boolean, authRoute: boolean, docError: boolean): boolean {
  return fonts && (docError || (phase === 'signed-out' && authRoute) ||
    (phase === 'signed-in' && (load === 'ready' || load === 'failed')));
}

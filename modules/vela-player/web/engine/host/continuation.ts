// A session the server moves on to a new source after the media ended plays on: a title stacked
// from several files continues with its next part rather than stopping at a part's end.

export interface Continuation {
  /** The media of the current source has ended. */
  ended: boolean;
  /** The plan is for the session already playing. */
  sameSession: boolean;
  /** The server's state for the session in the new plan. */
  serverState: string | undefined;
  /** The new plan's source generation, and the playing one's. */
  sourceGeneration: number | undefined;
  previousSourceGeneration: number | undefined;
}

export function playsOnAfterEnd(c: Continuation): boolean {
  return c.ended && c.sameSession && c.serverState === 'playing' &&
    c.sourceGeneration !== undefined && c.sourceGeneration > (c.previousSourceGeneration ?? -1);
}

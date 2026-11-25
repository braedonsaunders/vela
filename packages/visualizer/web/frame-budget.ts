/** Only repeated misses after the adaptive scene resolution reaches its floor affect capability. */
export function frameBudget() {
  let elapsed = 0, frames = 0, misses = 0;
  function reset() { elapsed = 0; frames = 0; misses = 0; }
  return {
    reset,
    sample(seconds: number, target: number, atFloor: boolean): 'keep' | 'limit30' | 'disable' {
      if (!atFloor) { reset(); return 'keep'; }
      if (seconds <= 0) return 'keep';
      // A single suspend, garbage collection, or driver stall contributes at most a quarter second.
      elapsed += Math.min(seconds, 0.25);
      frames++;
      if (elapsed < 2 || frames < 20) return 'keep';
      misses = elapsed / frames > target * 1.35 ? misses + 1 : 0;
      elapsed = 0;
      frames = 0;
      if (misses < 2) return 'keep';
      reset();
      return target < 1 / 30 ? 'limit30' : 'disable';
    },
  };
}

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

/** A cold compiler may miss one 400 ms entry. Repeated foreground misses, or one entry over four
 * times the budget, return the device to artwork. Asset fetch time is excluded by the caller. */
export function entryBudget() {
  let consecutiveMisses = 0;
  return (milliseconds: number) => {
    consecutiveMisses = milliseconds > 400 ? consecutiveMisses + 1 : 0;
    return milliseconds > 1600 || consecutiveMisses >= 2;
  };
}

/** The debug extension is optional. Unidentified GPUs still receive the measured budget checks. */
export function softwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render driver|\bwarp\b|software rasterizer/i.test(name);
}

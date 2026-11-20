import type { VelaState } from '@vela/core';

/** Dedicated page/player subscribers own these high-frequency slices. */
export function createHostStateSelector() {
  let previous: VelaState | undefined;
  return (next: VelaState): VelaState => {
    if (previous && (Object.keys(next) as (keyof VelaState)[]).every(key =>
      key === 'library' || key === 'collections' || key === 'playback' || next[key] === previous![key])) return previous;
    return previous = next;
  };
}

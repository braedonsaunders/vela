// The live stream's reconnect backoff, shared by the screens stream.

/** Reconnect delay after `failures` consecutive failures: 1 s doubling to 30 s, with up to 20% jitter. */
export function backoffMs(failures: number, jitter = Math.random()): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (1 + 0.2 * Math.min(1, Math.max(0, jitter))));
}

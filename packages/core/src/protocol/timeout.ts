/** A signal that aborts after `ms`, without relying on `AbortSignal.timeout` (absent on some hosts). */
export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('Request timed out')), ms);
  return controller.signal;
}

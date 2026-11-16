/** Whether this browser can run the core's original-file route at all: a secure context with WebGPU,
 * WebCodecs frames and workers. Per-source admission still decides each title. */
export function canAttemptOriginal() {
  return (
    isSecureContext &&
    !!(navigator as Navigator & { gpu?: unknown }).gpu &&
    typeof VideoFrame === 'function' &&
    typeof Worker === 'function'
  );
}

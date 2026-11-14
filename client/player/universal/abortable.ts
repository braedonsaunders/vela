/** Caller-scoped cancellation; never cancels a shared page capability probe. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted','AbortError'));
  return new Promise((resolve,reject) => {
    const abort = () => { signal.removeEventListener('abort',abort); reject(signal.reason ?? new DOMException('Aborted','AbortError')); };
    signal.addEventListener('abort',abort,{once:true});
    work.then(value => { signal.removeEventListener('abort',abort); resolve(value); },error => { signal.removeEventListener('abort',abort); reject(error); });
  });
}

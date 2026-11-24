import { randomId } from '../../random-id';
/** Imports an ES module from a run-time URL (a verified blob). Metro refuses `import()` of a computed
 * specifier at build time, so a one-off module script imports it and hands the namespace back through
 * a single-use global callback, which is removed as soon as it settles. */
export function importModuleURL<T>(url: string, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const key = `__velaModule_${randomId().replaceAll('-', '')}`;
  const slots = globalThis as unknown as Record<string, (namespace: unknown) => void>;
  const source = [
    `import * as namespace from ${JSON.stringify(url)};`,
    `globalThis[${JSON.stringify(key)}]?.(namespace);`,
  ].join('\n');
  const wrapper = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const script = document.createElement('script');
  script.type = 'module';
  script.src = wrapper;
  return new Promise<T>((resolve, reject) => {
    const settle = () => {
      delete slots[key];
      script.remove();
      URL.revokeObjectURL(wrapper);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      settle();
      reject(signal.reason);
    };
    slots[key] = (namespace) => {
      settle();
      resolve(namespace as T);
    };
    script.onerror = () => {
      settle();
      reject(new Error('Module script failed to load'));
    };
    signal.addEventListener('abort', abort, { once: true });
    document.head.append(script);
  });
}

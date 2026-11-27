/**
 * Imperative navigation that a press can always call. Expo Router's module-level `router` throws
 * until a mounted root binds it ("The imperative router is unavailable before the first render has
 * finished"), and an Android Activity relaunch used to leave it unbound (issue #76). A remote press
 * in that window ran the throw inside the press handler, and React Native ended the app.
 *
 * The guard calls the router as before. A call the router refuses because no root is ready waits
 * in a short queue and runs, in order, once the router accepts calls again. A repeat of a waiting
 * call (a remote's select pressed several times) waits once. Calls that still cannot run after
 * `waitMs` are dropped. Any other error is reported, never thrown, and a query (`canGoBack`,
 * `canDismiss`) that cannot be answered says `false`.
 */

/** Errors Expo Router raises while no mounted root is bound to the imperative router. */
const NOT_READY = /before the first render has finished|before mounting the Root Layout/;

export function isRouterNotReady(error: unknown): boolean {
  return error instanceof Error && NOT_READY.test(error.message);
}

export interface RouterGuardOptions {
  /** Run `retry` a frame or so later. */
  schedule(retry: () => void): void;
  now(): number;
  /** Errors other than "not ready", and calls dropped after waiting. Never throws. */
  report(message: string, error?: unknown): void;
  /** How long a call may wait for the router to become ready. */
  waitMs?: number;
}

const QUERIES = new Set(['canGoBack', 'canDismiss']);
type Call = { method: string; args: unknown[]; key: string; at: number };

function callKey(method: string, args: unknown[]): string {
  try {
    return `${method}:${JSON.stringify(args)}`;
  } catch {
    // Arguments that cannot be compared never count as repeats.
    return `${method}:${Math.random()}`;
  }
}

/**
 * Wrap `target`, an object of router methods, so that no call throws. Method lookups happen at call
 * time, because Expo Router binds and unbinds its router by replacing the methods in place.
 */
export function guardRouter<R extends object>(target: R, options: RouterGuardOptions): R {
  const waitMs = options.waitMs ?? 2000;
  const queue: Call[] = [];
  let scheduled = false;
  const methods = target as unknown as Record<string, (...args: unknown[]) => unknown>;

  /** Run one call: true when the router took it (or rejected it for good), false when not ready. */
  const run = (call: Pick<Call, 'method' | 'args'>): boolean => {
    try {
      methods[call.method]!(...call.args);
      return true;
    } catch (error) {
      if (isRouterNotReady(error)) return false;
      options.report(`router.${call.method} failed`, error);
      return true;
    }
  };

  const flush = () => {
    scheduled = false;
    while (queue.length) {
      const call = queue[0]!;
      if (options.now() - call.at > waitMs) {
        queue.shift();
        options.report(`router.${call.method} dropped: the router was not ready within ${waitMs} ms`);
        continue;
      }
      if (!run(call)) break;
      queue.shift();
    }
    if (queue.length) later();
  };

  const later = () => {
    if (scheduled) return;
    scheduled = true;
    options.schedule(flush);
  };

  const action = (method: string) => (...args: unknown[]) => {
    // Calls made while others wait keep their order behind them.
    if (!queue.length && run({ method, args })) return;
    const key = callKey(method, args);
    if (!queue.some(call => call.key === key)) queue.push({ method, args, key, at: options.now() });
    later();
  };

  const query = (method: string) => (...args: unknown[]) => {
    try {
      return methods[method]!(...args);
    } catch (error) {
      if (!isRouterNotReady(error)) options.report(`router.${method} failed`, error);
      return false;
    }
  };

  const guarded: Record<string, unknown> = {};
  for (const method of Object.keys(target)) {
    if (typeof methods[method] !== 'function') continue;
    guarded[method] = QUERIES.has(method) ? query(method) : action(method);
  }
  return guarded as R;
}

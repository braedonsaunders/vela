import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { guardRouter, isRouterNotReady } from '../src/router-guard';

const NOT_READY = 'The imperative router is unavailable before the first render has finished.';
const NOT_MOUNTED = 'Attempted to navigate before mounting the Root Layout component. Ensure the Root Layout component is rendering a Slot, or other navigator on the first render.';

/** A stand-in for Expo Router's module-level router: unbound methods throw, binding replaces them. */
function fakeRouter() {
  const calls: string[] = [];
  const unbound = () => { throw new Error(NOT_READY); };
  const router = {
    push: unbound as (href: string) => void,
    replace: unbound as (href: string) => void,
    back: unbound as () => void,
    setParams: (() => { throw new Error(NOT_MOUNTED); }) as (params: object) => void,
    canGoBack: unbound as () => boolean,
    canDismiss: unbound as () => boolean,
  };
  const bind = () => Object.assign(router, {
    push: (href: string) => { calls.push(`push ${href}`); },
    replace: (href: string) => { calls.push(`replace ${href}`); },
    back: () => { calls.push('back'); },
    setParams: (params: object) => { calls.push(`setParams ${JSON.stringify(params)}`); },
    canGoBack: () => true,
    canDismiss: () => false,
  });
  return { router, calls, bind };
}

function harness(waitMs = 2000) {
  const fake = fakeRouter();
  let time = 0;
  let pending: (() => void) | null = null;
  const reports: string[] = [];
  const router = guardRouter(fake.router, {
    schedule: retry => { pending = retry; },
    now: () => time,
    report: message => { reports.push(message); },
    waitMs,
  });
  /** Advance the clock and run the scheduled retry, as the next frame would. */
  const frame = (ms = 32) => {
    time += ms;
    const retry = pending;
    pending = null;
    retry?.();
  };
  return { ...fake, guarded: router, frame, reports, scheduled: () => pending !== null };
}

test('recognises only the not-ready errors', () => {
  expect(isRouterNotReady(new Error(NOT_READY))).toBe(true);
  expect(isRouterNotReady(new Error(NOT_MOUNTED))).toBe(true);
  expect(isRouterNotReady(new Error('Network request failed'))).toBe(false);
  expect(isRouterNotReady('The imperative router is unavailable before the first render has finished.')).toBe(false);
});

test('a bound router runs calls straight away', () => {
  const h = harness();
  h.bind();
  h.guarded.push('/title/1');
  h.guarded.back();
  expect(h.calls).toEqual(['push /title/1', 'back']);
  expect(h.scheduled()).toBe(false);
  expect(h.guarded.canGoBack()).toBe(true);
});

test('a press before the router is ready does not throw, and runs once the router binds', () => {
  const h = harness();
  expect(() => h.guarded.push('/title/1')).not.toThrow();
  expect(h.calls).toEqual([]);
  h.frame();
  expect(h.calls).toEqual([]);
  expect(h.scheduled()).toBe(true);
  h.bind();
  h.frame();
  expect(h.calls).toEqual(['push /title/1']);
  expect(h.scheduled()).toBe(false);
  expect(h.reports).toEqual([]);
});

test('waiting calls keep their order, and later calls queue behind them even once bound', () => {
  const h = harness();
  h.guarded.replace('/');
  h.guarded.setParams({ tab: 'films' });
  h.bind();
  // The router is bound, but two calls still wait: this one must not overtake them.
  h.guarded.push('/row/1');
  expect(h.calls).toEqual([]);
  h.frame();
  expect(h.calls).toEqual(['replace /', 'setParams {"tab":"films"}', 'push /row/1']);
});

test('repeated presses of the same action wait once', () => {
  const h = harness();
  for (let i = 0; i < 5; i++) h.guarded.push('/title/1');
  h.guarded.push('/title/2');
  h.guarded.push('/title/1');
  h.bind();
  h.frame();
  expect(h.calls).toEqual(['push /title/1', 'push /title/2']);
});

test('calls that wait longer than the limit are dropped and reported', () => {
  const h = harness(100);
  h.guarded.push('/title/1');
  h.frame(64);
  h.frame(64);
  expect(h.reports).toEqual(['router.push dropped: the router was not ready within 100 ms']);
  expect(h.scheduled()).toBe(false);
  h.bind();
  h.frame();
  expect(h.calls).toEqual([]);
  // A later press works normally.
  h.guarded.push('/title/2');
  expect(h.calls).toEqual(['push /title/2']);
});

test('queries answer false instead of throwing while the router is unbound', () => {
  const h = harness();
  expect(h.guarded.canGoBack()).toBe(false);
  expect(h.guarded.canDismiss()).toBe(false);
  expect(h.scheduled()).toBe(false);
});

test('other errors are reported rather than thrown, and are not retried', () => {
  const h = harness();
  h.bind();
  h.router.push = () => { throw new Error('boom'); };
  expect(() => h.guarded.push('/x')).not.toThrow();
  expect(h.reports).toEqual(['router.push failed']);
  expect(h.scheduled()).toBe(false);
});

test('the app imports the imperative router only through the guard', () => {
  const root = join(import.meta.dir, '..');
  const offenders: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.tsx?$/.test(name) && !path.endsWith(join('src', 'router.ts'))) {
        const source = readFileSync(path, 'utf8');
        for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'expo-router'/g)) {
          if (/(^|,)\s*(router|useRouter)\s*(,|$)/.test(match[1]!)) offenders.push(path.slice(root.length + 1));
        }
      }
    }
  };
  visit(join(root, 'app'));
  visit(join(root, 'src'));
  expect(offenders).toEqual([]);
});

import type { SkinHost } from './host';
import type { RNode } from './resolve';

// Compiled bindings declare their flag reads. Unknown accessors remain conservative.
const bindings = new WeakMap<Function, string | null>();
export function flagBinding<T extends Function>(read: T, flag: string | null): T {
  bindings.set(read, flag);
  return read;
}
const dependencies = new WeakMap<RNode, Set<string> | null>();
function flagsFor(node: RNode): Set<string> | null {
  if (dependencies.has(node)) return dependencies.get(node)!;
  const flags = new Set<string>();
  let unknown = false;
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'function') {
      if (!bindings.has(value)) unknown = true;
      else { const flag = bindings.get(value); if (flag) flags.add(flag); }
    } else if (Array.isArray(value)) {
      if (key === 'escape') for (const flag of value) flags.add(flag);
      else value.forEach(item => visit(item));
    } else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      // A supplied child can read flags the enclosing document cannot inspect.
      if (object.kind === 'slot' && object.slot === 'children') unknown = true;
      Object.entries(object).forEach(([name, item]) => visit(item, name));
    }
  };
  visit(node);
  const result = unknown ? null : flags;
  dependencies.set(node, result);
  return result;
}

/** A shell menu must not redraw every route card. Keep every other host/environment
 * change observable, including search focus and authored Escape/TV focus scopes. */
export function sameRouteHost(a: SkinHost, b: SkinHost, nodes: readonly (RNode | undefined)[]): boolean {
  if (a === b) return true;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key !== 'env' && a[key as keyof SkinHost] !== b[key as keyof SkinHost]) return false;
  }
  for (const key of new Set([...Object.keys(a.env), ...Object.keys(b.env)])) {
    if (key !== 'flags' && a.env[key as keyof typeof a.env] !== b.env[key as keyof typeof b.env]) return false;
  }
  if (a.env.flags === b.env.flags) return true;
  for (const node of nodes) {
    if (!node) continue;
    const flags = flagsFor(node);
    if (!flags) return false;
    for (const flag of flags) if (a.env.flags.includes(flag) !== b.env.flags.includes(flag)) return false;
  }
  return true;
}

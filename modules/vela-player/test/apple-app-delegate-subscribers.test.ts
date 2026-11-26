// Every app delegate subscriber Expo registers for Apple platforms must exist on every Apple OS the app
// builds for (iOS and tvOS); a class declared only under `#if os(iOS)` breaks the tvOS archive.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const config = JSON.parse(readFileSync(join(root, 'expo-module.config.json'), 'utf8'));
const sources = readdirSync(join(root, 'ios')).filter(f => f.endsWith('.swift')).map(f => readFileSync(join(root, 'ios', f), 'utf8'));

/** Whether the class is declared outside any platform condition, or in both branches of one. */
function declaredOnEveryApplePlatform(name: string): boolean {
  for (const source of sources) {
    const lines = source.split('\n');
    const stack: { cond: string; inElse: boolean }[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('#if ')) stack.push({ cond: t.slice(4), inElse: false });
      else if (t.startsWith('#else')) { if (stack.length) stack[stack.length - 1]!.inElse = true; }
      else if (t.startsWith('#endif')) stack.pop();
      else if (new RegExp(`\\bclass ${name}\\b`).test(t)) {
        if (!stack.length) return true;
        const top = stack[stack.length - 1]!;
        seen.add(`${top.cond}:${top.inElse ? 'else' : 'if'}`);
        if (seen.has(`${top.cond}:if`) && seen.has(`${top.cond}:else`)) return true;
      }
    }
  }
  return false;
}

test('Apple app delegate subscribers exist on iOS and tvOS', () => {
  const subscribers: string[] = config.apple?.appDelegateSubscribers ?? [];
  expect(subscribers.length).toBeGreaterThan(0);
  for (const name of subscribers) expect(declaredOnEveryApplePlatform(name)).toBe(true);
});

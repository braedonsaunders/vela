import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// React Native's Android accessibility delegate throws on any role outside this list (a `group`
// role closed the app on every title page). Web-only ARIA roles must be gated to Platform.OS web.
const ANDROID_ROLES = new Set(['none', 'button', 'dropdownlist', 'togglebutton', 'link', 'search', 'image', 'imagebutton',
  'keyboardkey', 'text', 'adjustable', 'summary', 'header', 'alert', 'checkbox', 'combobox', 'menu', 'menubar', 'menuitem',
  'progressbar', 'radio', 'radiogroup', 'scrollbar', 'spinbutton', 'switch', 'tab', 'tabbar', 'tablist', 'timer', 'list',
  'grid', 'pager', 'scrollview', 'horizontalscrollview', 'viewgroup', 'webview', 'drawerlayout', 'slidingdrawer', 'iconmenu', 'toolbar']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'test') return [];
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test('no literal accessibilityRole that Android would reject', () => {
  const root = join(import.meta.dir, '..', '..', '..');
  const offenders: string[] = [];
  for (const file of [...files(join(root, 'packages/skin/src')), ...files(join(root, 'apps/vela/src')), ...files(join(root, 'apps/vela/app'))]) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/accessibilityRole(?:=|:\s*)["']([a-z]+)["']/g))
      if (!ANDROID_ROLES.has(match[1]!)) offenders.push(`${file.slice(root.length + 1)}: ${match[1]}`);
  }
  expect(offenders).toEqual([]);
});

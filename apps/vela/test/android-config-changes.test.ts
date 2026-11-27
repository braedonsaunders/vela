import { expect, test } from 'bun:test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withConfigChanges } = require('../plugins/android-config-changes.js') as { withConfigChanges(value?: string, changes?: string[]): string };

test('adds navigation and colorMode to the activity, keeping what is there', () => {
  expect(withConfigChanges('keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode'))
    .toBe('keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|navigation|colorMode');
  expect(withConfigChanges(undefined)).toBe('navigation|colorMode');
});

test('is idempotent, and leaves density and locale to relaunch the activity', () => {
  const once = withConfigChanges('orientation|navigation');
  expect(once).toBe('orientation|navigation|colorMode');
  expect(withConfigChanges(once)).toBe(once);
  expect(once).not.toContain('density');
  expect(once).not.toContain('locale');
});

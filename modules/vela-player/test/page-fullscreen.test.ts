import { expect, test } from 'bun:test';
import { pageFullscreenContainer } from '../web/engine/host/surface';

test('a player fullscreen request takes the whole page, so the chrome drawn over the video stays visible', () => {
  const root = { tag: 'html' } as unknown as HTMLElement;
  const player = { ownerDocument: { documentElement: root } } as unknown as HTMLElement;
  expect(pageFullscreenContainer(player)).toBe(root);
  const detached = { ownerDocument: null } as unknown as HTMLElement;
  expect(pageFullscreenContainer(detached)).toBe(detached);
});

import { expect, test } from 'bun:test';
import { PreviewMuteCommands } from '../src/widgets/guide/preview-command';

test('pending preview audio is suppressed and the viewer mute choice is restored with a newer command', () => {
  const commands = new PreviewMuteCommands();
  const playing = commands.next(1, false, false);
  const pending = commands.next(1, false, true);
  const restored = commands.next(1, false, false);
  expect(playing).toMatchObject({ type: 'mute', muted: false });
  expect(pending).toMatchObject({ type: 'mute', muted: true });
  expect(pending.id).toBeGreaterThan(playing.id);
  expect(restored).toMatchObject({ type: 'mute', muted: false });
  expect(restored.id).toBeGreaterThan(pending.id);
  expect(commands.next(1, false, false)).toBe(restored);
});

test('muted previews remain muted and fresh source commands are not ignored', () => {
  const commands = new PreviewMuteCommands();
  const playing = commands.next(undefined, true, false);
  expect(commands.next(undefined, true, true)).toBe(playing);
  const changed = commands.next(2, true, false);
  expect(changed.id).toBeGreaterThan(playing.id);
  expect(changed).toMatchObject({ type: 'mute', muted: true });
});

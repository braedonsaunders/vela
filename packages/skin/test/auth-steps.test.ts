import { describe, expect, test } from 'bun:test';
import { blockEntrance, plexDetail, stepCopy, stepDirection, stepKey } from '../src/widgets/auth/connect/steps';

describe('auth step choreography', () => {
  test('the key changes with the page, the server and what the page shows', () => {
    expect(stepKey({ page: 'add' })).toBe('add');
    expect(stepKey({ page: 'signin', serverId: 'a' })).not.toBe(stepKey({ page: 'signin', serverId: 'b' }));
    expect(stepKey({ page: 'plex' }, 'link')).not.toBe(stepKey({ page: 'plex' }, 'servers'));
  });
  test('Plex’s states that change the page', () => {
    expect(plexDetail(null, true)).toBe('link');
    expect(plexDetail(null, false)).toBe('start');
    const link = { code: 'ABCD', linkUrl: 'https://plex.tv/link', choices: [] };
    expect(plexDetail({ ...link, state: 'waiting' }, false)).toBe('link');
    expect(plexDetail({ ...link, state: 'linked' }, false)).toBe('servers');
    expect(plexDetail({ ...link, state: 'profiles' }, false)).toBe('profiles');
    expect(plexDetail({ ...link, state: 'expired' }, false)).toBe('start');
  });
  test('returning through history is back; deeper or the same depth is forward', () => {
    expect(stepDirection(2, 1)).toBe('back');
    expect(stepDirection(1, 2)).toBe('forward');
    expect(stepDirection(1, 1)).toBe('forward');
  });
  test('blocks enter in turn, capped so long lists do not keep the viewer waiting', () => {
    const delays = [0, 1, 2, 8, 30].map(i => blockEntrance(i, 'forward').delay!);
    expect(delays[1]! - delays[0]!).toBe(70);
    expect(delays[2]!).toBeGreaterThan(delays[1]!);
    expect(delays[4]).toBe(delays[3]);
  });
  test('the first step waits for the mark to draw', () => {
    expect(blockEntrance(0, 'forward', true).delay!).toBeGreaterThan(blockEntrance(0, 'forward').delay! + 500);
  });
  test('going back the blocks settle from above; forward they rise from below', () => {
    const offset = (direction: 'forward' | 'back') => {
      const motion = blockEntrance(0, direction);
      const from = motion.frames![motion.keyframes]!.from!;
      return (from.transform![0] as { translateY: number }).translateY;
    };
    expect(offset('forward')).toBeGreaterThan(0);
    expect(offset('back')).toBeLessThan(0);
  });
  test('reduced motion only dissolves', () => {
    expect(blockEntrance(3, 'forward').still).toEqual({ keyframes: 'dissolve', duration: 200 });
  });
  test('each step’s words', () => {
    expect(stepCopy({ page: 'add', first: true, name: '' }).title).toBe('Vela');
    expect(stepCopy({ page: 'add', first: false, name: '' }).title).toBe('Add a server');
    expect(stepCopy({ page: 'choose', first: true, name: '' }).title).toBe('Choose a server');
    expect(stepCopy({ page: 'signin', first: true, name: 'Den' }).title).toBe('Sign in to Den');
    expect(stepCopy({ page: 'plex', first: false, name: '', plex: 'servers' }).title).toBe('Choose a server');
    expect(stepCopy({ page: 'signin', first: true, name: 'Den', savedOffline: true }).title).toBe("You're offline");
  });
});
test('blocks arriving into a showing step come at once, in turn', () => {
  expect(blockEntrance(0, 'forward', false, true).delay!).toBeLessThan(blockEntrance(0, 'forward').delay!);
  expect(blockEntrance(1, 'forward', false, true).delay! - blockEntrance(0, 'forward', false, true).delay!).toBe(70);
});

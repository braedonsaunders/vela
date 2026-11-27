import { describe, expect, test } from 'bun:test';
import { blockEntrance, kindLabel, plexDetail, serverAddress, signInOptions, stepCopy, stepDirection, stepKey } from '../src/widgets/auth/connect/steps';

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
    expect(plexDetail({ ...link, state: 'expired' }, false)).toBe('expired');
    expect(plexDetail({ ...link, state: 'failed' }, false)).toBe('failed');
    // A refusal after approval (no link left, an error) is a failure, never the start again.
    expect(plexDetail(null, false, 'This Plex account doesn\'t have access to this server.')).toBe('failed');
    expect(plexDetail(null, true, 'old error')).toBe('link');
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

describe('server sign-in', () => {
  test('Plex comes first wherever the server offers it; a password is a choice', () => {
    const both = signInOptions({ plex: true, password: true, quick: true, typing: false });
    expect(both).toMatchObject({ plexPrimary: true, fields: false, offerFields: true, quick: true });
    const chose = signInOptions({ plex: true, password: true, quick: true, typing: true });
    expect(chose).toMatchObject({ plexPrimary: false, fields: true, offerFields: false });
  });
  test('a password-only server opens its fields at once', () => {
    expect(signInOptions({ plex: false, password: true, quick: false, typing: false })).toMatchObject({ plex: false, fields: true, offerFields: false });
  });
  test('Plex alone is the only action', () => {
    expect(signInOptions({ plex: true, password: false, quick: false, typing: false })).toMatchObject({ plexPrimary: true, fields: false, offerFields: false, quick: false });
  });
  test('the address reads as typed: no scheme, the path only when there is one', () => {
    expect(serverAddress('https://den.example.net', '/')).toBe('den.example.net');
    expect(serverAddress('http://192.168.1.20:8096/')).toBe('192.168.1.20:8096');
    expect(serverAddress('https://example.org', '/vela/')).toBe('example.org/vela');
    expect(serverAddress('')).toBe('');
  });
  test('the kind is always named', () => {
    expect(kindLabel('jellyfin')).toBe('Jellyfin');
    expect(kindLabel('ether', 'Ether')).toBe('Ether');
    expect(kindLabel('unknown')).toBe('');
  });
  test('the expired and refused steps say so in their titles', () => {
    expect(stepCopy({ page: 'server-plex', first: false, name: '', plex: 'failed' }).title).toBe('Plex sign-in didn’t work');
    expect(stepCopy({ page: 'plex', first: false, name: '', plex: 'expired' }).title).toBe('That code expired');
    expect(stepCopy({ page: 'code', first: false, name: '', quickExpired: true }).title).toBe('That code ended');
  });
});

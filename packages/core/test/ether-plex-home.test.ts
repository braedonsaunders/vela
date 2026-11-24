import { afterEach, expect, test } from 'bun:test';
import { beginPlexHomeSignIn, selectPlexHomeProfile } from '../src/adapter/ether/plex';
import { EtherAdapter } from '../src/adapter/ether';
import { FakeCredentials, device, restoreFetch, routeFetch, tokens } from './helpers';

afterEach(restoreFetch);
const origin = 'https://ether.example';

test('capable Plex sign-in returns an opaque Home profile selection', async () => {
  const selection = { selectionToken: 'choose-once', expiresAt: '2099-01-01T00:00:00Z', profiles: [
    { id: 'owner', name: 'Alex', protected: true, avatarUrl: '/vela/v0/images/plexavatar-sealed' },
    { id: 'child', name: 'Kids', protected: false, restricted: true },
  ] };
  const seen = routeFetch({ 'POST /vela/v0/auth/plex': selection });
  const answer = await beginPlexHomeSignIn(origin, 'plex-secret', device, 'begin-once');
  // Ether's relative, sealed avatar path resolves on the same server.
  expect(answer).toEqual({ ...selection, profiles: [{ ...selection.profiles[0]!, avatarUrl: 'https://ether.example/vela/v0/images/plexavatar-sealed' }, selection.profiles[1]!] });
  expect(seen[0]?.body).toEqual({ plexToken: 'plex-secret', selectProfile: true, device, idempotencyKey: 'begin-once' });
});

test('profile completion sends only the challenge, selection and optional PIN', async () => {
  const issued = tokens('kids-viewer');
  const seen = routeFetch({ 'POST /vela/v0/auth/plex/profile': issued });
  const request = { selectionToken: 'choose-once', profileId: 'child', pin: '1234', device, idempotencyKey: 'finish-once' };
  expect(await selectPlexHomeProfile(origin, request)).toEqual(issued);
  expect(seen[0]?.body).toEqual(request);
  expect(JSON.stringify(seen[0]?.body)).not.toContain('plex-secret');
});

test('signed-in switching authenticates its challenge and atomically stores the replacement', async () => {
  const old = tokens('old-access', 'owner'), next = tokens('new-access', 'kids');
  const credentials = new FakeCredentials(old);
  const selection = { selectionToken: 'switch-once', expiresAt: '2099-01-01T00:00:00Z', profiles: [
    { id: 'owner', name: 'Owner', protected: false }, { id: 'kids', name: 'Kids', protected: false },
  ] };
  const seen = routeFetch({
    'POST /vela/v0/auth/plex/profiles/challenge': selection,
    'POST /vela/v0/auth/plex/profile': next,
  });
  const adapter = new EtherAdapter(origin, credentials, '');
  expect(await adapter.startPlexProfileSwitch({ device, idempotencyKey: 'challenge-once' })).toEqual(selection);
  expect(seen[0]?.headers.get('authorization')).toBe('Bearer old-access');
  expect(seen[0]?.headers.get('x-vela-device-id')).toBe(device.id);
  expect(seen[0]?.body).toEqual({ device, idempotencyKey: 'challenge-once' });
  const request = { selectionToken: 'switch-once', profileId: 'kids', device, idempotencyKey: 'complete-once' };
  expect(await adapter.completePlexProfileSwitch(request)).toEqual(next);
  expect(seen[1]?.headers.has('authorization')).toBe(false);
  expect(seen[1]?.body).toEqual(request);
  expect(credentials.current).toEqual(next);
});

test('an invalid profile selection is never accepted as credentials', async () => {
  routeFetch({ 'POST /vela/v0/auth/plex': { selectionToken: 'choose-once', expiresAt: '2099-01-01T00:00:00Z', profiles: [{ id: 'only', name: 'Only', protected: false }] } });
  await expect(beginPlexHomeSignIn(origin, 'plex-secret', device, 'begin-once')).rejects.toThrow('invalid sign-in response');
});

test('an unusable avatar URL is dropped, not trusted, and the profiles still load', async () => {
  routeFetch({ 'POST /vela/v0/auth/plex': { selectionToken: 'choose-once', expiresAt: '2099-01-01T00:00:00Z', profiles: [
    { id: 'owner', name: 'Owner', protected: false, avatarUrl: 'file:///secret' },
    { id: 'child', name: 'Child', protected: false },
  ] } });
  const answer = await beginPlexHomeSignIn(origin, 'plex-secret', device, 'begin-once');
  expect('selectionToken' in answer && answer.profiles.map(p => p.avatarUrl)).toEqual([undefined, undefined]);
});

test('Plex Home avatars resolve on the server and never invalidate the profile list', () => {
  const { profileAvatar } = require('../src/adapter/ether/plex') as typeof import('../src/adapter/ether/plex');
  expect(profileAvatar('http://192.168.68.65:32550', '/vela/v0/images/plexavatar-abc')).toBe('http://192.168.68.65:32550/vela/v0/images/plexavatar-abc');
  expect(profileAvatar('https://ether.example', 'https://ether.example/vela/v0/images/plexavatar-x')).toBe('https://ether.example/vela/v0/images/plexavatar-x');
  expect(profileAvatar('https://ether.example', 'https://plex.tv/users/1/avatar')).toBeUndefined();
  expect(profileAvatar('https://ether.example', '/vela/v0/titles/1')).toBeUndefined();
  expect(profileAvatar('https://ether.example', undefined)).toBeUndefined();
});

test('Plex sign-in sends a same-origin auth proxy its cookie', async () => {
  // A tunnel or auth proxy in front of Ether admits requests by its own cookie and answers 401 without it.
  let credentials: RequestCredentials | undefined;
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
    credentials = init?.credentials;
    return Response.json(tokens('vela-session'));
  }, { preconnect: () => {} }) as typeof fetch;
  await beginPlexHomeSignIn(origin, 'plex-secret', device, 'proxy-once');
  expect(credentials).toBe('same-origin');
});

import { afterEach, expect, test } from 'bun:test';
import { beginPlexHomeSignIn, selectPlexHomeProfile } from '../src/adapter/ether/plex';
import { device, restoreFetch, routeFetch, tokens } from './helpers';

afterEach(restoreFetch);
const origin = 'https://ether.example';

test('capable Plex sign-in returns an opaque Home profile selection', async () => {
  const selection = { selectionToken: 'choose-once', expiresAt: '2099-01-01T00:00:00Z', profiles: [
    { id: 'owner', name: 'Alex', protected: true, avatarUrl: 'https://ether.example/avatar/alex' },
    { id: 'child', name: 'Kids', protected: false, restricted: true },
  ] };
  const seen = routeFetch({ 'POST /vela/v0/auth/plex': selection });
  expect(await beginPlexHomeSignIn(origin, 'plex-secret', device, 'begin-once')).toEqual(selection);
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

test('an invalid profile selection is never accepted as credentials', async () => {
  routeFetch({ 'POST /vela/v0/auth/plex': { selectionToken: 'choose-once', expiresAt: '2099-01-01T00:00:00Z', profiles: [{ id: 'only', name: 'Only', protected: false }] } });
  await expect(beginPlexHomeSignIn(origin, 'plex-secret', device, 'begin-once')).rejects.toThrow('invalid sign-in response');
});

test('profile avatar URLs cannot expose non-web schemes', async () => {
  routeFetch({ 'POST /vela/v0/auth/plex': { selectionToken: 'choose-once', expiresAt: '2099-01-01T00:00:00Z', profiles: [
    { id: 'owner', name: 'Owner', protected: false, avatarUrl: 'file:///secret' },
    { id: 'child', name: 'Child', protected: false },
  ] } });
  await expect(beginPlexHomeSignIn(origin, 'plex-secret', device, 'begin-once')).rejects.toThrow('invalid sign-in response');
});

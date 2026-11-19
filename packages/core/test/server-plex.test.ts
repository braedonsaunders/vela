import { test, expect } from 'bun:test';
import { Auth, initialAuth } from '../src/store/auth';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import type { Session } from '../src/store/session';
import { tokens } from './helpers';
import { authFlow, initialAuthFlow } from '../src/store/auth-flow';

test('server Plex navigation retains the selected server and returns to its sign-in', () => {
  const signin = authFlow(initialAuthFlow(1), {type: 'server', serverId: 'target'});
  const plex = authFlow(signin, {type: 'server-plex'});
  expect(plex.step).toEqual({page: 'server-plex', serverId: 'target'});
  expect(authFlow(plex, {type: 'back'})).toEqual(signin);
});

test('approved Plex PIN exchanges only with the selected Ether and saves Vela tokens', async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  let saved: unknown;
  let reset = false;
  const issued = tokens('vela-only');
  const connection = {record: {id: 'target', kind: 'ether', origin: 'https://selected.test'}, adapter: {describe: async () => ({server: {}, plexAccountSignIn: true, features: {}})}, credentials: {set: async (value: unknown) => {saved = value;}}};
  const session = {onReset() {}, selected: () => connection, epoch: 0, device: {id: 'device'}, names: new Map(), key: () => 'once', servers: {standalone: true}, resetSession() {reset = true;}};
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push(url);
    if (url.includes('/auth/plex')) {expect(JSON.parse(String(init?.body)).plexToken).toBe('account-secret'); return Response.json(issued);}
    return Response.json({id: 1, code: 'ABCD', expiresAt: new Date(Date.now()+60000).toISOString(), ...(init?.method === 'POST' ? {} : {authToken: 'account-secret'})});
  }) as typeof fetch;
  const box = new StateBox({auth: initialAuth} as VelaState);
  const auth = new Auth(box, session as unknown as Session, {} as VelaPlatform);
  try {
    await auth.startPlex();
    expect(box.get().auth.plex?.code).toBe('ABCD');
    await Bun.sleep(2150);
    expect(requests).toHaveLength(3);
    expect(requests[2]).toBe('https://selected.test/vela/v0/auth/plex');
    expect(saved).toEqual(issued);
    expect(reset).toBe(true);
  } finally {auth.cancelPlex(); globalThis.fetch = original;}
});

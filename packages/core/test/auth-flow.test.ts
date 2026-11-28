import { expect, test } from 'bun:test';
import { authFlow, initialAuthFlow, selectedAuthFlow } from '../src/store/auth-flow';
test('saved servers are the first screen; a first install starts at Add', () => {
  expect(initialAuthFlow(3).step.page).toBe('choose');
  expect(initialAuthFlow(0).step.page).toBe('add');
});
test('late restoration shows the saved servers without interrupting an active flow', () => {
  expect(authFlow(initialAuthFlow(0), {type: 'servers', count: 3}).step.page).toBe('choose');
  const signin = authFlow(initialAuthFlow(0), {type: 'server', serverId: 'a'});
  expect(authFlow(signin, {type: 'servers', count: 3})).toBe(signin);
});
test('Back returns through code, sign-in, add, chooser in order', () => {
  let flow = initialAuthFlow(3);
  flow = authFlow(flow, {type: 'add'});
  flow = authFlow(flow, {type: 'server', serverId: 'a'});
  flow = authFlow(flow, {type: 'code'});
  expect(flow.step).toEqual({page: 'code', serverId: 'a'});
  for (const page of ['signin', 'add', 'choose'] as const) { flow = authFlow(flow, {type: 'back'}); expect(flow.step.page).toBe(page); }
  expect(authFlow(flow, {type: 'back'})).toBe(flow);
});
test('Plex account selection has the same history and preserves the selected server', () => {
  let flow = authFlow(initialAuthFlow(0), {type: 'plex'});
  flow = authFlow(flow, {type: 'server', serverId: 'plex-ether'});
  expect(flow.step).toEqual({page: 'signin', serverId: 'plex-ether'});
  expect(authFlow(flow, {type: 'back'}).step.page).toBe('plex');
});
test('code is only valid for a selected server', () => {
  const flow = initialAuthFlow(3);
  expect(authFlow(flow, {type: 'code'})).toBe(flow);
});
test('standalone sign-in has no inert Back destination', () => {
  const flow = selectedAuthFlow('server-a', 2, false);
  expect(flow.history).toEqual([]);
  expect(authFlow(flow, { type: 'server', serverId: 'server-a' })).toBe(flow);
});

test('standalone sign-in can open the chooser and remove its last server', () => {
  const signIn = selectedAuthFlow('old', 1, false);
  const chooser = authFlow(signIn, { type: 'choose' });
  expect(chooser).toEqual({ step: { page: 'choose' }, history: [] });
  expect(authFlow(chooser, { type: 'sync-server', serverId: 'remaining' })).toBe(chooser);
  expect(authFlow(chooser, { type: 'servers', count: 0 }).step.page).toBe('add');
});

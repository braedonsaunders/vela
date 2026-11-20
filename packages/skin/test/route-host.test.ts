import { expect, test } from 'bun:test';
import { flagBinding, sameRouteHost } from '../src/route-host';
import { resolveDocument, type RNode } from '../src/resolve';
import type { SkinHost } from '../src/host';
import mochi from '../../protocol/fixtures/skins/mochi/document';

const host = { env: { flags: [] } } as unknown as SkinHost;
const changed = (flags: string[]) => ({ ...host, env: { ...host.env, flags } });
const node = (read?: Function, escape?: string[]) => ({ kind: 'text', text: 'body', when: read ? [{ read }] : [], escape }) as unknown as RNode;

test('shell flags leave static route content alone', () => {
  expect(sameRouteHost(host, changed(['menu']), [node()])).toBe(true);
  expect(sameRouteHost(host, changed(['menu']), [node(flagBinding(() => '', null))])).toBe(true);
});

test('authored flag bindings and Escape/TV focus scopes remain live', () => {
  const readsMenu = node(flagBinding(() => '', 'menu'));
  expect(sameRouteHost(host, changed(['menu']), [readsMenu])).toBe(false);
  expect(sameRouteHost(host, changed(['other']), [readsMenu])).toBe(true);
  expect(sameRouteHost(host, changed(['menu']), [node(undefined, ['menu'])])).toBe(false);
});

test('unclassified bindings and supplied children keep all changes observable', () => {
  expect(sameRouteHost(host, changed(['menu']), [node(() => '')])).toBe(false);
  const slot = { kind: 'slot', slot: 'children' } as RNode;
  expect(sameRouteHost(host, changed(['menu']), [slot])).toBe(false);
});

test('data and callbacks are compared even when flags are irrelevant', () => {
  expect(sameRouteHost(host, { ...host, env: { ...host.env, query: 'new' } }, [node()])).toBe(false);
  expect(sameRouteHost(host, { ...host, dispatch: () => {} }, [node()])).toBe(false);
});

test('compiled Mochi home ignores profile menu but responds to empty search focus', () => {
  const home = resolveDocument(mochi, 1280).routes.home!;
  expect(sameRouteHost(host, changed(['menu']), [home])).toBe(true);
  expect(sameRouteHost(host, changed(['search-focused']), [home])).toBe(false);
});

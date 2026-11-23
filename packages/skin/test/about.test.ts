// The About line (about.ts): which Vela this is, where it runs and the server it is connected to,
// as every built-in skin's profile menu ends with it.
import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { VelaState } from '@vela/core';
import { aboutLabel, aboutLine, aboutOf, type About } from '../src/about';
import { fill, holds, resolveDocument, type RNode } from '../src/resolve';
import { accessor, type Env } from '../src/vocabulary';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import type { SkinDocument } from '../../protocol/skin';

const android: About = { version: '0.2.48', build: '2048', platform: 'Android', server: 'Ether', serverName: 'Basement', serverVersion: '0.3.19' };
const read = (key: string, about?: About) => accessor(key)!({ index: 0 }, { about } as Env);

test('the line names the build, the platform and the server with its version', () => {
  expect(aboutLine(android)).toBe('Vela 0.2.48 (2048) · Android · Ether 0.3.19');
  expect(aboutLine({ ...android, build: '', platform: 'Web' })).toBe('Vela 0.2.48 · Web · Ether 0.3.19');
});

test('a fact not known yet is left out, not shown empty', () => {
  expect(aboutLine({ ...android, serverVersion: '' })).toBe('Vela 0.2.48 (2048) · Android · Ether');
  expect(aboutLine({ ...android, server: '', serverName: '', serverVersion: '' })).toBe('Vela 0.2.48 (2048) · Android');
  expect(aboutLine({ ...android, version: '' })).toBe('');
  expect(aboutLine(undefined)).toBe('');
});

test('a screen reader hears words for the build and the server, and the server by its own name', () => {
  expect(aboutLabel(android)).toBe('About: Vela 0.2.48, build 2048, Android, server Ether 0.3.19, Basement');
  // A server that names itself as its product is not named twice.
  expect(aboutLabel({ ...android, build: '', platform: 'Apple TV', serverName: 'Ether' })).toBe('About: Vela 0.2.48, Apple TV, server Ether 0.3.19');
  expect(aboutLabel(undefined)).toBe('');
});

test('documents read the line, the label and each fact', () => {
  expect(read('env.aboutLine', android)).toBe('Vela 0.2.48 (2048) · Android · Ether 0.3.19');
  expect(read('env.aboutLabel', android)).toContain('build 2048');
  expect([read('env.appVersion', android), read('env.appBuild', android), read('env.platform', android)]).toEqual(['0.2.48', '2048', 'Android']);
  expect([read('env.serverProduct', android), read('env.serverName', android), read('env.serverVersion', android)]).toEqual(['Ether', 'Basement', '0.3.19']);
  // A host that gives no facts draws no line (documents draw it `when` env.aboutLine).
  for (const key of ['env.aboutLine', 'env.aboutLabel', 'env.appVersion', 'env.serverVersion']) expect(read(key)).toBe('');
});

const app = { version: '0.2.48', build: '', platform: 'Web' };
const state = (phase: VelaState['auth']['phase'], selected = 'lab') => ({
  auth: { phase, serverId: 'lab', serverName: 'Basement', serverVersion: '0.3.19' },
  servers: { list: [{ id: 'lab', kindLabel: 'Ether', selected: selected === 'lab' }, { id: 'jf', kindLabel: 'Jellyfin', selected: selected === 'jf' }] },
}) as unknown as VelaState;

test('the server facts are the selected server\'s, kept while it is unreachable', () => {
  expect(aboutOf(state('signed-in'), app)).toEqual({ ...app, server: 'Ether', serverName: 'Basement', serverVersion: '0.3.19' });
  expect(aboutOf(state('offline'), app).serverVersion).toBe('0.3.19');
  expect(aboutLine(aboutOf(state('signed-out'), app))).toBe('Vela 0.2.48 · Web');
  // Switching: the session still names the old server until the new one settles.
  expect(aboutLine(aboutOf(state('signed-in', 'jf'), app))).toBe('Vela 0.2.48 · Web');
});

// Every built-in skin, under each of its Sign out controls (Jellytwin's menu and phone drawer
// alike), ends with the About line: a reading stop on TV, named by its label.
const fixtures = join(import.meta.dir, '../../protocol/fixtures/skins');
const documents: [string, SkinDocument][] = [['cinematic', cinematicDoc]];
for (const entry of readdirSync(fixtures, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (entry.isDirectory() && existsSync(join(fixtures, entry.name, 'document.ts'))) {
    documents.push([entry.name, (await import(join(fixtures, entry.name, 'document.ts'))).default as SkinDocument]);
  }
}

type Box = Extract<RNode, { kind: 'box' }>;
const within = (node: RNode, predicate: (node: RNode) => boolean): boolean => predicate(node)
  || node.kind === 'box' && node.children.some(child => within(child, predicate))
  || node.kind === 'repeat' && within(node.item, predicate);
const signsOut = (node: RNode) => node.kind === 'box' && node.press?.action === 'signOut';
const isAbout = (node: RNode): node is Box => node.kind === 'box' && node.readingStop === true;

test.each(documents)('%s ends its profile menu with the About line', (_name, doc) => {
  const env = { about: android, viewer: 'Demo', flags: [] } as unknown as Env;
  for (const width of [390, 1440]) {
    const shell = resolveDocument(doc, width, 'en').shell!;
    let menus = 0;
    const walk = (node: RNode) => {
      if (node.kind === 'repeat') return walk(node.item);
      if (node.kind !== 'box') return;
      const out = node.children.findIndex(signsOut);
      if (out >= 0) {
        menus++;
        const about = node.children.slice(out + 1).find(isAbout);
        expect(about).toBeDefined();
        expect(holds(about!.when, { index: 0 }, env)).toBe(true);
        expect(fill(about!.label!, { index: 0 }, env)).toBe(aboutLabel(android));
        expect(within(about!, n => n.kind === 'text' && fill(n.text, { index: 0 }, env) === 'Vela 0.2.48 (2048) · Android · Ether 0.3.19')).toBe(true);
        expect(holds(about!.when, { index: 0 }, { ...env, about: undefined })).toBe(false);
      }
      node.children.forEach(walk);
    };
    walk(shell);
    expect(menus).toBeGreaterThan(0);
  }
});

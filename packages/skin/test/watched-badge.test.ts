// Every built-in skin marks a watched title wherever it draws a title's artwork (home rows, Top 10,
// library grids and lists, collections, search, filmographies, seasons, episode stills, related
// rows), and the mark follows the rules of card.played: never beside a resume bar, never on music,
// books or audiobooks.
import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDocument } from '../src/resolve';
import { watchedMark } from '../src/vocabulary';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import type { Node, SkinDocument, Style } from '../../protocol/skin';

const fixtures = join(import.meta.dir, '../../protocol/fixtures/skins');
const documents: [string, SkinDocument][] = [['cinematic', cinematicDoc]];
for (const folder of readdirSync(fixtures).sort()) {
  if (existsSync(join(fixtures, folder, 'document.ts'))) documents.push([folder, (await import(join(fixtures, folder, 'document.ts'))).default as SkinDocument]);
}

const ART = /\{card\.(poster|backdrop)\}/;
const styles = (node: Node): (Style | undefined)[] => [node.style, node.small, node.wide, ...(node.states ?? []).map(state => state.style)];

/** The cards each skin draws: every repeat item that shows a title's art, with whether it marks
 * card.played. A nested repeat is another card and is checked on its own. */
function cards(doc: SkinDocument): { where: string; marked: boolean }[] {
  const found: { where: string; marked: boolean }[] = [];
  const inline = (node: Node | undefined, seen: Set<string>, visit: (node: Node) => boolean): boolean => {
    if (!node) return false;
    if (visit(node)) return true;
    if (node.type === 'use') return !seen.has(node.template) && inline(doc.templates?.[node.template], new Set([...seen, node.template]), visit);
    if (node.type === 'repeat') return false;
    return node.type === 'box' && !!node.children?.some(child => inline(child, seen, visit));
  };
  const drawsArt = (item: Node) => inline(item, new Set(), node => node.type === 'image' && ART.test(node.src)
    || styles(node).some(style => ART.test(style?.['background-image'] ?? '')));
  const marked = (item: Node) => inline(item, new Set(), node => [...(node.when ?? []), ...(node.states ?? []).flatMap(state => state.when)]
    .some(condition => condition.test === 'card.played' && !condition.not && (condition.is ?? 'set') === 'set'));
  const walk = (node: Node | undefined, where: string, seen: Set<string>) => {
    if (!node) return;
    if (node.type === 'use') {
      if (!seen.has(node.template)) walk(doc.templates?.[node.template], `${where}>${node.template}`, new Set([...seen, node.template]));
      return;
    }
    if (node.type === 'repeat') {
      if (drawsArt(node.item)) found.push({ where: `${where} over ${node.over}`, marked: marked(node.item) });
      walk(node.item, `${where}>${node.over}`, seen);
      return;
    }
    if (node.type === 'box') for (const child of node.children ?? []) walk(child, where, seen);
  };
  walk(doc.slots?.home ?? doc.routes?.home, 'home', new Set());
  for (const [route, tree] of Object.entries(doc.routes ?? {})) if (route !== 'home') walk(tree as Node | undefined, route, new Set());
  if (doc.slots?.shell) walk(doc.slots.shell, 'shell', new Set());
  return found;
}

test('every built-in skin marks a watched title on every card that draws its artwork', () => {
  for (const [name, own] of documents) {
    const drawn = cards(resolveDocument(own, 1920, 'en').document);
    expect(drawn.length).toBeGreaterThan(0);
    expect({ skin: name, unmarked: drawn.filter(card => !card.marked).map(card => card.where) }).toEqual({ skin: name, unmarked: [] });
  }
});

test('the watched mark: a played video title, never beside a resume bar or on books and music', () => {
  const video = { played: true, progressSeconds: 0, durationSeconds: 6000 };
  expect(watchedMark(video)).toBe(true);
  expect(watchedMark({ ...video, played: false })).toBe(false);
  // A rewatch in progress shows its bar instead.
  expect(watchedMark({ ...video, progressSeconds: 1200 })).toBe(false);
  // A series or season with no duration of its own.
  expect(watchedMark({ played: true, progressSeconds: 0, durationSeconds: 0 })).toBe(true);
  const media = (cls: 'book' | 'music' | 'audiobook' | 'video') => ({ ...video, media: { class: cls } as never });
  expect(watchedMark(media('book'))).toBe(false);
  expect(watchedMark(media('music'))).toBe(false);
  expect(watchedMark(media('audiobook'))).toBe(false);
  expect(watchedMark(media('video'))).toBe(true);
});

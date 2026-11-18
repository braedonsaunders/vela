import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../MainWindow.cs', import.meta.url), 'utf8');
const script = source.match(/private const string NativeVideoLayer = """\n([\s\S]*?)\n\s*""";/)![1];
class Element {
  parentElement: Element | null = null;
  children: Element[] = [];
  values = new Map<string, [string, string]>();
  style = {
    getPropertyValue: (key: string) => this.values.get(key)?.[0] || '',
    getPropertyPriority: (key: string) => this.values.get(key)?.[1] || '',
    setProperty: (key: string, value: string, priority: string) => { this.values.set(key, [value, priority]); },
    removeProperty: (key: string) => { this.values.delete(key); },
  };
  constructor(parent?: Element) { if (parent) { this.parentElement = parent; parent.children.push(this); } }
}
function fixture() {
  const body = new Element(); const root = new Element(body);
  const home = new Element(root); const title = new Element(root); const watch = new Element(root);
  const stage = new Element(watch); const video = new Element(stage); const controls = new Element(stage);
  const window = {};
  const apply = runInNewContext(`(${script})`, { window, HTMLElement: Element, document: { body, querySelector: () => stage } });
  return { home, title, stage, video, controls, apply };
}
describe('native video navigator layers', () => {
  test('hides previous screens while preserving the watch stage and controls', () => {
    const f = fixture(); f.apply(true);
    expect(f.home.values.get('visibility')).toEqual(['hidden', 'important']);
    expect(f.title.values.get('visibility')).toEqual(['hidden', 'important']);
    for (const e of [f.stage, f.video, f.controls]) expect(e.values.has('visibility')).toBe(false);
  });
  test('restores original visibility and priority on close and repeated mounts', () => {
    const f = fixture(); f.home.style.setProperty('visibility', 'visible', 'important');
    f.apply(true); f.apply(true); f.apply(false); f.apply(false);
    expect(f.home.values.get('visibility')).toEqual(['visible', 'important']);
    expect(f.title.values.has('visibility')).toBe(false);
  });
});

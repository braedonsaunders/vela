// Renderer 20, the document system for experiences (docs/experiences.md): built-in documents, skin
// overrides merged over them, platform and form variants, rich blocks with their parts and part
// templates, generic block fallbacks, slot nodes and slot surfaces, and the vela.* rules.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RENDERER_VERSION, fill, type RNode } from '../src/resolve';
import { checkScreenDocument, formFactor, resolveScreenDocument, velaUseProblems, type ScreenViewport } from '../src/resolve/screen';
import { builtinDocument, builtinIndex, builtinScreenId } from '../src/resolve/builtin';
import { platformOf } from '../src/screen/platform-of';
import { slotContext, slotSurfaces } from '../src/surfaces/model';
import { screenRoot } from '../src/screen/items';
import { builtinHref, parseBuiltinHref, slotSpec, surfaceSlot, SLOTS } from '../../protocol/experiences';
import { RICH_BLOCKS } from '../../protocol/rich-blocks';
import type { ScreenDocument, SurfaceContribution } from '../../protocol/screen';
import type { Node, SkinDocument } from '../../protocol/skin';
import type { ScreenPageState } from '../../core/src/screens/types';
import type { Ctx, Env } from '../src/vocabulary';

const env = { small: false, tv: false, still: false, width: 1440 } as Env;
const builtIn = (tree: Node, extra: Partial<ScreenDocument> = {}): ScreenDocument => ({
  schema: 1, kind: 'screen', renderer: 20, owner: 'vela', experience: 'listen', screen: 'listen', page: 'album', version: '1',
  title: 'Album', presentation: 'section', sources: { album: { from: 'vela.title', id: '{param.id}' } }, tree, ...extra,
});
const plugin = (tree: Node, extra: Partial<ScreenDocument> = {}): ScreenDocument => ({
  schema: 1, kind: 'screen', renderer: 19, screen: 'probe', page: 'index', version: '1', title: 'Probe', presentation: 'section', sources: {}, tree, ...extra,
});
const at = (viewport: Partial<ScreenViewport> = {}): ScreenViewport => ({ width: 1440, height: 900, ...viewport });
const skinWith = (experiences: SkinDocument['experiences'], extra: Partial<SkinDocument> = {}) => ({ experiences, ...extra });
const page = (sources: Record<string, unknown> = {}): ScreenPageState => ({ href: 'h', key: 'k', params: {}, sources, pending: {}, errors: {}, load: 'ready', rev: 1 });
const root = (sources: Record<string, unknown> = {}): Ctx => screenRoot(page(sources), () => undefined);
const textOf = (n: RNode, c: Ctx = root()) => fill((n as Extract<RNode, { kind: 'text' }>).text, c, env);
const children = (n: RNode) => (n as Extract<RNode, { kind: 'box' }>).children;
const rich = (n: RNode) => n as Extract<RNode, { kind: 'rich' }>;

describe('renderer 20 and the renderer-bump rule', () => {
  test('the renderer is 20', () => expect(RENDERER_VERSION).toBe(20));
  test('a renderer-21 document is refused whole on its version, never half-drawn', () => {
    const over = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/renderer-21-page.json'), 'utf8')) as ScreenDocument;
    expect(() => checkScreenDocument(over)).toThrow('needs renderer 21; this client draws 20');
    expect(() => resolveScreenDocument(over, at())).toThrow('needs renderer 21');
  });
  test('every renderer-19 plugin document (Sports, the news desk) still resolves unchanged in shape', () => {
    const fixtures = join(import.meta.dir, '../../protocol/fixtures/screens');
    const files = readdirSync(fixtures, { recursive: true }).map(String).filter(f => f.endsWith('.json') && !/(^|\/)data/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const doc = JSON.parse(readFileSync(join(fixtures, file), 'utf8')) as ScreenDocument;
      expect(doc.renderer).toBe(19);
      for (const viewport of [at(), at({ width: 390, height: 844, platform: 'ios' }), at({ width: 1920, height: 1080, tv: true, platform: 'tv' })]) {
        const resolved = resolveScreenDocument(doc, viewport);
        expect(resolved.tree.kind).not.toBe('rich');
        expect(resolved.warnings.filter(w => /Unknown node type|no prop|no part/.test(w))).toEqual([]);
      }
    }
  });
});

describe('built-in documents', () => {
  test('are addressed vela:<experience>/<page> under the screen vela.<experience>', () => {
    expect(builtinHref('listen', 'album')).toBe('vela:listen/album');
    expect(parseBuiltinHref('vela:listen/nowPlaying')).toEqual({ experience: 'listen', page: 'nowPlaying' });
    expect(parseBuiltinHref('https://x/vela:listen/album')).toBeUndefined();
    expect(parseBuiltinHref('vela:Listen/album')).toBeUndefined();
    expect(builtinScreenId('listen')).toBe('vela.listen');
    expect(builtinDocument('vela:nothing/here')).toBeUndefined();
  });
  test('an index refuses a document not owned by vela, or two at one address', () => {
    const a = builtIn({ type: 'box' });
    expect(builtinIndex([a]).get('vela:listen/album')).toBe(a);
    expect(() => builtinIndex([a, a])).toThrow('Two built-in documents');
    expect(() => builtinIndex([plugin({ type: 'box' })])).toThrow('not owned by vela');
  });
  test('owner vela needs an experience; owner is vela or absent', () => {
    expect(() => checkScreenDocument(builtIn({ type: 'box' }, { experience: undefined }))).toThrow('names its experience');
    expect(() => checkScreenDocument(builtIn({ type: 'box' }, { owner: 'ether' as 'vela' }))).toThrow('owner is "vela"');
    expect(() => checkScreenDocument(builtIn({ type: 'box' }))).not.toThrow();
  });
  test('the bundled ones resolve at every form', () => {
    const dir = join(import.meta.dir, '../../protocol/fixtures/experiences');
    for (const experience of readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())) {
      for (const file of readdirSync(join(dir, experience.name)).filter(f => f.endsWith('.json'))) {
        const doc = builtinDocument(builtinHref(experience.name, file.replace(/\.json$/, '')));
        expect(doc).toBeDefined();
        for (const viewport of [at(), at({ width: 390, height: 844 }), at({ width: 1920, height: 1080, tv: true })]) resolveScreenDocument(doc!, viewport);
      }
    }
  });
});

describe('vela.* sources and actions', () => {
  test('a source that is not published refuses any document', () => {
    expect(velaUseProblems(builtIn({ type: 'box' }, { sources: { x: { from: 'vela.secrets' } } }))[0]).toContain('not a published vela.* source');
  });
  test('a built-in document passes any arguments, a plugin document only {context.*} holes', () => {
    expect(velaUseProblems(builtIn({ type: 'box' }))).toEqual([]);
    const ok = plugin({ type: 'box' }, { presentation: 'slot', slot: 'listen.album.panel', sources: { t: { from: 'vela.title', id: '{context.title}' } } });
    expect(velaUseProblems(ok)).toEqual([]);
    const param = plugin({ type: 'box' }, { sources: { t: { from: 'vela.title', id: '{param.id}' } } });
    expect(velaUseProblems(param)[0]).toContain('argument id is not a {context.*} hole');
    const literal = plugin({ type: 'box' }, { sources: { t: { from: 'vela.title', id: 'item:42' } } });
    expect(() => checkScreenDocument(literal)).toThrow('not a {context.*} hole');
    // Ether's own fields are not arguments.
    expect(velaUseProblems(plugin({ type: 'box' }, { sources: { t: { from: 'vela.title', id: '{context.title}', lazy: true, deps: [] } } }))).toEqual([]);
  });
  test('local actions: built-in documents only, published names only', () => {
    const like: Node = { type: 'box', press: { action: 'plugin', args: { name: 'vela.like', ref: '{src.album.$key}' } } };
    expect(velaUseProblems(builtIn(like))).toEqual([]);
    expect(velaUseProblems(plugin(like))[0]).toContain('cannot press the local action vela.like');
    expect(velaUseProblems(builtIn({ type: 'box', children: [{ type: 'box', press: { action: 'plugin', args: { name: 'vela.launch' } } }] }))[0]).toContain('not a published');
    // A plugin's own actions are untouched.
    expect(velaUseProblems(plugin({ type: 'box', press: { action: 'plugin', args: { name: 'ether.favorite' } } }))).toEqual([]);
  });
});

describe('platform and form variants', () => {
  test('every device is one platform', () => {
    expect(platformOf('ios', true, false)).toBe('tv');
    expect(platformOf('android', true, false)).toBe('tv');
    expect(platformOf('ios', false, false)).toBe('ios');
    expect(platformOf('android', false, false)).toBe('android');
    expect(platformOf('web', false, true)).toBe('desktop');
    expect(platformOf('web', false, false)).toBe('web');
  });
  test('the form: tv, a partly open fold, two panes from 980 (or a landscape 840), else small', () => {
    expect(formFactor(at({ tv: true, width: 1920 }))).toBe('tv');
    expect(formFactor(at({ fold: true, width: 867, height: 600 }))).toBe('fold');
    expect(formFactor(at({ width: 1000, height: 1300 }))).toBe('wide');
    expect(formFactor(at({ width: 867, height: 600 }))).toBe('wide');
    expect(formFactor(at({ width: 834, height: 1194 }))).toBe('small');
    expect(formFactor(at({ width: 390, height: 844 }))).toBe('small');
  });
  test('a node\'s platform overlay applies last, after small, wide, tv and fold', () => {
    const tree: Node = { type: 'text', text: 'x', style: { 'font-size': '10px', color: '$ui.ink' }, tv: { 'font-size': '20px' }, fold: { 'font-size': '15px' },
      platforms: { tv: { 'font-size': '30px' }, ios: { color: '$ui.accent' } } };
    const style = (viewport: ScreenViewport) => resolveScreenDocument(builtIn(tree), viewport).tree.base.style;
    expect(fill(style(at({ tv: true, platform: 'tv' }))['font-size'], root(), env)).toBe('30px');
    expect(fill(style(at({ tv: true, platform: 'android' }))['font-size'], root(), env)).toBe('20px');
    expect(fill(style(at({ fold: true, platform: 'ios' }))['font-size'], root(), env)).toBe('15px');
    expect(style(at({ platform: 'ios' })).color).not.toEqual(style(at({ platform: 'web' })).color);
  });
  test('a page\'s platform tree wins over its form tree, which wins over its tree; a fold falls back to its width', () => {
    const doc = builtIn({ type: 'text', text: 'tree' }, {
      forms: { small: { type: 'text', text: 'small' }, tv: { type: 'text', text: 'tv' } },
      platforms: { android: { type: 'text', text: 'android' } },
    });
    const drawn = (viewport: ScreenViewport) => textOf(resolveScreenDocument(doc, viewport).tree);
    expect(drawn(at())).toBe('tree');
    expect(drawn(at({ width: 390, height: 844 }))).toBe('small');
    expect(drawn(at({ width: 390, height: 844, platform: 'android' }))).toBe('android');
    expect(drawn(at({ tv: true, width: 1920, height: 1080, platform: 'tv' }))).toBe('tv');
    expect(drawn(at({ fold: true, width: 600, height: 800 }))).toBe('small');
  });
});

describe('skin overrides of an experience', () => {
  const doc = builtIn({ type: 'box', children: [{ type: 'use', template: 'heading' }, { type: 'text', text: 'body' }] }, {
    templates: { heading: { type: 'text', text: 'Vela heading' } }, strings: { hi: 'Vela hi' },
  });
  test('an absent page keeps Vela\'s; a page drawn whole replaces the tree and keeps the sources', () => {
    expect(textOf(children(resolveScreenDocument(doc, at(), 'en', {}, { skin: skinWith({ listen: { pages: { artist: { type: 'text', text: 'x' } } } }) }).tree)[0]!)).toBe('Vela heading');
    const replaced = resolveScreenDocument(doc, at(), 'en', {}, { skin: skinWith({ listen: { pages: { album: { type: 'text', text: '{src.album.name}' } } } }) });
    expect(textOf(replaced.tree, root({ album: { name: 'Blue' } }))).toBe('Blue');
    expect(replaced.document.sources).toEqual(doc.sources);
  });
  test('a page override with variants picks per platform and form', () => {
    const skin = skinWith({ listen: { pages: { album: { tree: { type: 'text', text: 'skin' }, forms: { tv: { type: 'text', text: 'skin tv' } } } } } });
    expect(textOf(resolveScreenDocument(doc, at(), 'en', {}, { skin }).tree)).toBe('skin');
    expect(textOf(resolveScreenDocument(doc, at({ tv: true }), 'en', {}, { skin }).tree)).toBe('skin tv');
  });
  test('templates merge by name over the page\'s; skin strings and tokens are there for overrides', () => {
    const skin = skinWith({ listen: { templates: { heading: { type: 'text', text: '{s:big} heading', style: { 'font-size': '$big' } } } } },
      { strings: { en: { big: 'Skin', hi: 'Skin hi' } }, tokens: { big: '40px' } });
    const resolved = resolveScreenDocument(doc, at(), 'en', {}, { skin });
    const heading = children(resolved.tree)[0]!;
    expect(textOf(heading)).toBe('Skin heading');
    expect(fill(heading.base.style['font-size'], root(), env)).toBe('40px');
  });
  test('the shell takes the skin\'s tree for its form', () => {
    const shell = builtIn({ type: 'text', text: 'vela shell' }, { page: 'shell', forms: { tv: { type: 'text', text: 'vela tv shell' } } });
    const skin = skinWith({ listen: { shell: { wide: { type: 'text', text: 'skin wide shell' } } } });
    expect(textOf(resolveScreenDocument(shell, at(), 'en', {}, { skin }).tree)).toBe('skin wide shell');
    expect(textOf(resolveScreenDocument(shell, at({ tv: true }), 'en', {}, { skin }).tree)).toBe('vela tv shell');
  });
  test('overrides apply only to built-in pages of that experience', () => {
    const skin = skinWith({ listen: { pages: { index: { type: 'text', text: 'hijacked' } } } });
    expect(textOf(resolveScreenDocument(plugin({ type: 'text', text: 'mine' }), at(), 'en', {}, { skin }).tree)).toBe('mine');
    const read = builtIn({ type: 'text', text: 'reader' }, { experience: 'read' });
    expect(textOf(resolveScreenDocument(read, at(), 'en', {}, { skin: skinWith({ listen: { pages: { album: { type: 'text', text: 'no' } } } }) }).tree)).toBe('reader');
  });
});

describe('rich blocks, parts and part templates', () => {
  test('every rich block is a node type the resolver knows', () => {
    for (const block of Object.keys(RICH_BLOCKS)) {
      if (block === 'visualizer' || block === 'player') continue;
      const spec = RICH_BLOCKS[block as keyof typeof RICH_BLOCKS];
      const props = Object.fromEntries(Object.entries(spec.props as Record<string, { required?: boolean; type: string; values?: readonly string[] }>)
        .filter(([, p]) => p.required).map(([name, p]) => [name, p.type === 'enum' ? p.values![0]! : '{src.x}']));
      const tree = resolveScreenDocument(builtIn({ type: block, props } as Node), at()).tree;
      expect(tree.kind).toBe('rich');
      expect(rich(tree).block).toBe(block as never);
    }
  });
  test('props compile; a single hole keeps its raw value; unknown props are dropped with a warning', () => {
    const resolved = resolveScreenDocument(builtIn({ type: 'trackTable', props: { tracks: '{src.album.tracks}', covers: 'true', bogus: '1' } }), at());
    const node = rich(resolved.tree);
    expect(Object.keys(node.props).sort()).toEqual(['covers', 'tracks']);
    expect(node.props.tracks!.value!(root({ album: { tracks: [1, 2] } }), env)).toEqual([1, 2]);
    expect(resolved.warnings.some(w => w.includes('no prop bogus'))).toBe(true);
  });
  test('a missing required prop draws the fallback', () => {
    const resolved = resolveScreenDocument(builtIn({ type: 'trackTable', fallback: { type: 'text', text: 'no tracks' } }), at());
    expect(resolved.tree.kind).toBe('box');
    expect(textOf(children(resolved.tree)[0]!)).toBe('no tracks');
  });
  test('part styles merge: the document\'s, the node\'s, then the skin\'s; variants are picked', () => {
    const doc = builtIn({ type: 'queue', parts: { 'queue.row': { style: { padding: '4px', color: '$ui.ink' }, tv: { padding: '8px' }, focus: { opacity: '0.5' } }, 'queue.bogus': { color: 'white' } } },
      { parts: { 'queue.row': { 'border-radius': '2px', padding: '1px' }, 'trackTable.row': { padding: '9px' } } });
    const skin = skinWith({ listen: { parts: { 'queue.row': { 'border-radius': '12px' } } } });
    const resolved = resolveScreenDocument(doc, at(), 'en', {}, { skin });
    const row = rich(resolved.tree).parts['queue.row']!;
    expect(fill(row.style.padding, root(), env)).toBe('4px');
    expect(fill(row.style['border-radius'], root(), env)).toBe('12px');
    expect(fill(row.focus!.opacity, root(), env)).toBe('0.5');
    expect(Object.keys(rich(resolved.tree).parts)).toEqual(['queue.row']);
    expect(resolved.warnings.some(w => w.includes('no part queue.bogus'))).toBe(true);
    const tv = rich(resolveScreenDocument(doc, at({ tv: true })).tree).parts['queue.row']!;
    expect(fill(tv.style.padding, root(), env)).toBe('8px');
  });
  test('part templates: a document template named after the part, the node\'s over it, the skin\'s over both; {item.*} and {part.*} read', () => {
    const doc = builtIn({ type: 'queue', partTemplates: { 'queue.row': { type: 'text', text: 'node {item.name}' } } },
      { templates: { 'queue.row': { type: 'text', text: 'doc {item.name}' } } });
    const item = (c: Ctx): Ctx => ({ ...c, screen: { ...c.screen!, items: { item: { value: { name: 'Song' }, index: 0 }, part: { value: { active: true }, index: 0 } } } }) as unknown as Ctx;
    expect(textOf(rich(resolveScreenDocument(doc, at()).tree).templates['queue.row']!, item(root()))).toBe('node Song');
    const docOnly = builtIn({ type: 'queue' }, { templates: { 'queue.row': { type: 'text', text: 'doc {item.name}' } } });
    expect(textOf(rich(resolveScreenDocument(docOnly, at()).tree).templates['queue.row']!, item(root()))).toBe('doc Song');
    const skin = skinWith({ listen: { templates: { 'queue.row': { type: 'text', text: 'skin {item.name} {part.active}' } } } });
    expect(textOf(rich(resolveScreenDocument(doc, at(), 'en', {}, { skin }).tree).templates['queue.row']!, item(root()))).toBe('skin Song true');
  });
  test('a part that takes no template warns', () => {
    const resolved = resolveScreenDocument(builtIn({ type: 'lyrics', partTemplates: { 'lyrics.line': { type: 'text', text: 'x' } } }), at());
    expect(resolved.warnings.some(w => w.includes('lyrics.line takes no template'))).toBe(true);
    expect(rich(resolved.tree).templates).toEqual({});
  });
  test('player: with a channel the preview, without it the rich player', () => {
    expect(resolveScreenDocument(plugin({ type: 'player', channel: '{src.c}' }), at()).tree.kind).toBe('player');
    expect(rich(resolveScreenDocument(builtIn({ type: 'player' }), at()).tree).block).toBe('player');
  });
  test('visualizer: mode and sceneId become props; its fallback rides along for when it cannot run', () => {
    const node = rich(resolveScreenDocument(builtIn({ type: 'visualizer', mode: 'background', sceneId: '{src.v.scene}', fallback: { type: 'text', text: 'art' },
      parts: { 'visualizer.caption': { color: '$ui.ink' } } }), at()).tree);
    expect(node.block).toBe('visualizer');
    expect(node.props.mode!.template).toBe('background');
    expect(node.props.sceneId!.value!(root({ v: { scene: 'aurora' } }), env)).toBe('aurora');
    expect(textOf(node.fallback!)).toBe('art');
    expect(Object.keys(node.parts)).toEqual(['visualizer.caption']);
  });
  test('an unknown block draws its fallback, or nothing', () => {
    const drawn = resolveScreenDocument(builtIn({ type: 'hologram', fallback: { type: 'text', text: 'flat' } } as unknown as Node), at());
    expect(textOf(children(drawn.tree)[0]!)).toBe('flat');
    expect(children(resolveScreenDocument(builtIn({ type: 'hologram' } as unknown as Node), at()).tree)).toEqual([]);
  });
  test('a known renderer-19 block carries its fallback', () => {
    const node = resolveScreenDocument(plugin({ type: 'player', channel: 'channel:1', fallback: { type: 'text', text: 'no preview' } } as Node), at()).tree;
    expect(textOf((node as { fallback?: RNode }).fallback!)).toBe('no preview');
  });
});

describe('env keys', () => {
  test('canVisualize, platform, form and fold read', () => {
    const tree: Node = { type: 'text', text: '{env.canVisualize}|{env.platform}|{env.form}|{env.fold}' };
    const node = resolveScreenDocument(builtIn(tree), at()).tree;
    expect(fill((node as Extract<RNode, { kind: 'text' }>).text, root(), env)).toBe('false||wide|');
    const on = { ...env, canVisualize: true, platform: 'ios', form: 'fold', fold: 'tabletop' } as Env;
    expect(fill((node as Extract<RNode, { kind: 'text' }>).text, root(), on)).toBe('true|ios|fold|tabletop');
  });
});

describe('slots', () => {
  test('the published list: ids, contexts and caps', () => {
    expect(SLOTS.map(s => s.id)).toEqual(['home.rows', 'title.panel', 'listen.album.panel', 'listen.artist.panel', 'listen.nowPlaying.panel', 'read.sidePanel',
      'gallery.photo.panel', 'player.overlay.topLeft', 'player.overlay.topRight', 'player.overlay.bottom', 'toast']);
    expect(slotSpec('player.overlay.bottom')!.cap.perSlot).toBe(2);
    expect(slotSpec('nope')).toBeUndefined();
  });
  test('the Sports presentations stand for their slots', () => {
    expect(surfaceSlot({ presentation: 'homeRow' })).toBe('home.rows');
    expect(surfaceSlot({ presentation: 'titlePanel' })).toBe('title.panel');
    expect(surfaceSlot({ presentation: 'playerOverlay', anchor: 'topRight' })).toBe('player.overlay.topRight');
    expect(surfaceSlot({ presentation: 'playerOverlay' })).toBeUndefined();
    expect(surfaceSlot({ presentation: 'toast' })).toBe('toast');
    expect(surfaceSlot({ presentation: 'slot', slot: 'listen.album.panel' })).toBe('listen.album.panel');
    expect(surfaceSlot({ presentation: 'slot', slot: 'listen.nowhere' })).toBeUndefined();
  });
  test('a slot surface names a published slot', () => {
    expect(() => checkScreenDocument(plugin({ type: 'box' }, { presentation: 'slot' }))).toThrow('names a published slot');
    expect(() => checkScreenDocument(plugin({ type: 'box' }, { presentation: 'slot', slot: 'listen.album.panel' }))).not.toThrow();
  });
  test('a slot node compiles its published context, drops other names and caps its limit', () => {
    const resolved = resolveScreenDocument(builtIn({ type: 'slot', slot: 'plugin:listen.album.panel', context: { title: '{src.album.id}', titleKind: 'album', other: 'x' }, limit: 9 }), at());
    const slot = resolved.tree as Extract<RNode, { kind: 'slot' }>;
    expect(slot.kind).toBe('slot');
    expect(slot.slot).toBe('plugin:listen.album.panel');
    expect(Object.keys(slot.context!)).toEqual(['title', 'titleKind']);
    expect(fill(slot.context!.title, root({ album: { id: 'a1' } }), env)).toBe('a1');
    expect(slot.limit).toBe(3);
    expect(resolved.warnings.some(w => w.includes('no context other'))).toBe(true);
    const unknown = resolveScreenDocument(builtIn({ type: 'slot', slot: 'plugin:listen.nowhere' } as unknown as Node), at());
    expect(unknown.tree.kind).toBe('box');
  });
  test('slot surfaces: by slot id or alias, filtered by title kind, capped', () => {
    const s = (id: string, extra: Partial<SurfaceContribution>): SurfaceContribution => ({ id, presentation: 'slot', document: { href: id, renderer: 20 }, ...extra });
    const surfaces = [
      s('a', { slot: 'listen.album.panel' }), s('b', { slot: 'listen.album.panel', when: { titleKind: 'album' } }), s('c', { slot: 'listen.album.panel', when: { titleKind: 'show' } }),
      s('d', { slot: 'listen.artist.panel' }), s('e', { slot: 'listen.album.panel' }), s('f', { slot: 'listen.album.panel' }), s('g', { presentation: 'titlePanel' }),
    ];
    expect(slotSurfaces(surfaces, 'listen.album.panel', { titleKind: 'album' }).map(x => x.id)).toEqual(['a', 'b', 'e']);
    expect(slotSurfaces(surfaces, 'listen.album.panel', {}, 1).map(x => x.id)).toEqual(['a']);
    expect(slotSurfaces(surfaces, 'title.panel', {}).map(x => x.id)).toEqual(['g']);
  });
  test('a slot\'s context: server keys go to Ether (a title as its item: key), the rest stay local', () => {
    expect(slotContext({ title: 'a1', titleKind: 'album', kind: 'title', chrome: 'true', empty: '' })).toEqual({ server: { title: 'item:a1', kind: 'title' }, local: { chrome: 'true' } as never });
  });
});

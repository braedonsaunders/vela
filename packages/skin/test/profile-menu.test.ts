// The profile menu primitive (renderer 22): the app's entries as data, each skin's look over them,
// and every built-in skin's menu offering every entry, with the TV focus guide, Back to its trigger
// and the About line's reading stop kept (0.2.79's scrolling-menu guide, 03976bde's stop and rows).
import { describe, expect, mock, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('react-native-reanimated', () => ({ cubicBezier: (...values: number[]) => values }));
mock.module('../src/fonts', () => ({ fontFace: (name: string) => name }));
const { boxStyle } = await import('../src/translate');
const { scrollGuide } = await import('../src/scroll-styles');
const { conditionsHold, fill, holds, resolveDocument } = await import('../src/resolve');
const { collection } = await import('../src/vocabulary');
const { arrangement, expandProfileMenu } = await import('../src/profile-menu/expand');
const { PROFILE_MENU_ENTRIES } = await import('../src/profile-menu/entries');
const { velaProfileMenu } = await import('../src/resolve/vela-base/profile-menu');
const { cinematicDoc } = await import('../../protocol/fixtures/skins/cinematic');
type RNode = import('../src/resolve').RNode;
type Box = Extract<RNode, { kind: 'box' }>;
type Env = import('../src/vocabulary').Env;
type Ctx = import('../src/vocabulary').Ctx;
type Node = import('../../protocol/skin').Node;
type SkinDocument = import('../../protocol/skin').SkinDocument;
type ProfileMenuLook = import('../../protocol/skin').ProfileMenuLook;

const fixtures = join(import.meta.dir, '../../protocol/fixtures/skins');
const documents: [string, SkinDocument][] = [['cinematic', cinematicDoc]];
for (const folder of readdirSync(fixtures, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(fixtures, e.name, 'document.ts'))).map(e => e.name).sort())
  documents.push([folder, (await import(join(fixtures, folder, 'document.ts'))).default as SkinDocument]);

const libraries = [{ id: 'movies', name: 'Movies', kind: 'movies', backdrop: '' }];
const about = { version: '0.2.80', build: '', platform: 'Web', server: 'Ether', serverName: 'Demo', serverVersion: '0.4.0' };
/** A signed-in viewer offered everything: profiles, playlists, downloads and the library manager. */
const everything = (width: number, flags: string[], extra: Partial<Env> = {}) => ({
  width, small: width < 640, tv: width >= 1600, section: 'home', viewer: 'Demo', canLive: true, canSwitchProfile: true, canPlaylists: true,
  canDownloads: true, canManageLibraries: true, still: true, flags, skinCount: 9, skinName: 'Skin', about, libraries, navigation: libraries, ...extra,
}) as unknown as Env;
const ctx: Ctx = { index: 0 };

/** An entry's marker in a resolved tree: its control's testId, or the server list's widget. */
const marks = (id: string) => (node: RNode) => id === 'servers'
  ? node.kind === 'widget' && node.widget === 'serverSwitcher' && node.params.entries === 'servers'
  : node.testId === PROFILE_MENU_ENTRIES.find(entry => entry.id === id)!.testId;
/** How many nodes matching `predicate` a viewer sees in the shell with `e`. */
function visible(doc: SkinDocument, e: Env, predicate: (node: RNode) => boolean): number {
  let found = 0;
  const walk = (node: RNode, c: Ctx) => {
    if (!holds(node.when, c, e)) return;
    const layer = node.states.find(state => holds(state.when, c, e))?.layer ?? node.base;
    if (fill(layer.style.display, c, e) === 'none') return;
    if (predicate(node)) found++;
    if (node.kind === 'box') node.children.forEach(child => walk(child, c));
    else if (node.kind === 'repeat') collection(node.over, c, e, node.limit).forEach(item => walk(node.item, item));
  };
  walk(resolveDocument(doc, e.width, 'en').shell!, ctx);
  return found;
}

// The flags that open each skin's profile surfaces: Kids' grown-ups corner is behind its gate, and
// Jelly Twin offers the entries in its header's menu and its phone drawer alike.
const SURFACES: Record<string, string[][]> = {
  cinematic: [['menu']], broadcast: [['menu']], index: [['menu']], jellytwin: [['menu'], ['drawer']], kids: [['gate', 'parent']],
  latenight: [['menu']], lounge: [['menu']], marquee: [['menu']], mochi: [['menu']],
};

describe('the entries', () => {
  const entry = (id: string) => PROFILE_MENU_ENTRIES.find(candidate => candidate.id === id)!;
  const shows = (id: string, e: Partial<Env>) => conditionsHold(entry(id).when, ctx, everything(1440, ['menu'], e));

  test('each has a stable, distinct testId, and every row an action', () => {
    expect(new Set(PROFILE_MENU_ENTRIES.map(e => e.testId)).size).toBe(PROFILE_MENU_ENTRIES.length);
    for (const e of PROFILE_MENU_ENTRIES.filter(e => e.kind === 'row')) expect(e.press?.action, e.id).toBeDefined();
  });

  test('Switch profile, Playlists, Downloads and Manage libraries show only where the app offers them', () => {
    for (const [id, key] of [['switchProfile', 'canSwitchProfile'], ['playlists', 'canPlaylists'], ['downloads', 'canDownloads'], ['manageLibraries', 'canManageLibraries']] as const) {
      expect(shows(id, {}), id).toBe(true);
      expect(shows(id, { [key]: false }), id).toBe(false);
    }
    // canDownloads is optional in Env: a host that leaves it out offers no downloads.
    expect(shows('downloads', { canDownloads: undefined })).toBe(false);
  });

  test('Appearance, the servers, Add a server and Sign out always show; the About line while there is one', () => {
    for (const id of ['viewer', 'appearance', 'servers', 'addServer', 'signOut']) expect(shows(id, { canPlaylists: false, canDownloads: false }), id).toBe(true);
    expect(shows('about', {})).toBe(true);
    expect(shows('about', { about: undefined })).toBe(false);
  });
});

describe('the arrangement', () => {
  const ids = (look: ProfileMenuLook) => arrangement(look).map(section => `${section.id}: ${section.entries.join(' ')}`);

  test('by default: who you are, what you do, your servers, signing out and which Vela this is', () => {
    expect(ids({})).toEqual([
      'viewer: viewer',
      'you: switchProfile playlists downloads manageLibraries appearance',
      'servers: servers addServer',
      'session: signOut',
      'about: about',
    ]);
  });

  test('an entry the look names nowhere joins its default section, which is added in the default order', () => {
    const look: ProfileMenuLook = { sections: [{ id: 'you', entries: ['appearance'] }, { id: 'about', entries: ['about'] }] };
    expect(ids(look)).toEqual([
      'viewer: viewer',
      'you: appearance switchProfile playlists downloads manageLibraries',
      'servers: servers addServer',
      'session: signOut',
      'about: about',
    ]);
  });

  test('extras are placed where named, else in the first sections\' default', () => {
    const extras = { back: { label: 'Back', press: { action: 'reset' as const } }, help: { label: 'Help', press: { action: 'openLink' as const } } };
    const look: ProfileMenuLook = { extras, sections: [{ id: 'session', entries: ['signOut', 'back'] }] };
    expect(arrangement(look).find(s => s.id === 'session')!.entries).toEqual(['signOut', 'back']);
    expect(arrangement(look).find(s => s.id === 'you')!.entries.at(-1)).toBe('help');
  });

  test('only the viewer may be left out; mistakes are refused, never half-drawn', () => {
    expect(arrangement({ hide: ['viewer'] }).flatMap(s => s.entries)).not.toContain('viewer');
    expect(() => arrangement({ hide: ['signOut' as never] })).toThrow('cannot leave out signOut');
    expect(() => arrangement({ sections: [{ entries: ['logout'] }] })).toThrow('Unknown profile menu entry logout');
    expect(() => arrangement({ sections: [{ entries: ['signOut'] }, { entries: ['signOut'] }] })).toThrow('placed twice');
    expect(() => arrangement({ extras: { signOut: { label: 'x', press: { action: 'signOut' } } } })).toThrow('cannot take the entry id signOut');
  });
});

describe('a look\'s parts', () => {
  const docWith = (look: ProfileMenuLook): SkinDocument => ({ ...cinematicDoc, profileMenus: { default: look } });
  const expand = (look: ProfileMenuLook) => expandProfileMenu({ type: 'profileMenu', style: { padding: '9px' } }, docWith(look), velaProfileMenu);
  const flat = (node: Node): Node[] => [node, ...(node.type === 'box' ? (node.children ?? []).flatMap(flat) : [])];
  const byTestId = (node: Node, testId: string) => flat(node).find(n => n.testId === testId);

  test('the node is the panel: its own style, with the entries as children', () => {
    const menu = expand({});
    expect(menu.type).toBe('box');
    expect(menu.style).toEqual({ padding: '9px' });
    expect(byTestId(menu, 'sign-out')).toMatchObject({ type: 'box', press: { action: 'signOut' }, label: '{t:ui.signOut}' });
  });

  test('a row reads its entry; an icon without one is left out; a condition on entry.* is decided now', () => {
    const row: Node = { type: 'box', children: [
      { type: 'icon', symbol: '{entry.icon}' },
      { type: 'text', text: '[{entry.label}]' },
      { type: 'text', when: [{ test: 'entry.detail' }], text: '{entry.detail}' },
    ] };
    const menu = expand({ parts: { row }, entries: { signOut: { icon: '' } } });
    const switcher = byTestId(menu, 'switch-profile')!;
    expect(flat(switcher).map(n => n.type === 'icon' ? n.symbol : n.type === 'text' ? n.text : n.type)).toEqual(['box', 'person', '[{t:ui.switchProfile}]']);
    expect(switcher.when).toEqual([{ test: 'env.canSwitchProfile' }]);
    const signOut = byTestId(menu, 'sign-out')!;
    expect(flat(signOut).some(n => n.type === 'icon')).toBe(false);
    // A look that draws its own rows draws Appearance with them, the skin's name as its detail.
    expect(flat(byTestId(menu, 'skin-picker')!).filter(n => n.type === 'text').map(n => (n as { text: string }).text)).toEqual(['[{t:ui.appearance}]', '{env.skinName}']);
  });

  test('a glyph stands in for the icon; a label override and a custom part apply to one entry', () => {
    const glyph: Node = { type: 'icon', paths: ['M0 0h9v9H0z'], viewBox: '0 0 9 9', style: { width: '14px' } };
    const big: Node = { type: 'box', style: { height: '60px' }, children: [{ type: 'text', text: '{entry.label}!' }] };
    const menu = expand({ parts: { big }, entries: { appearance: { label: 'Change the look', glyph, part: 'big' }, signOut: { glyph } } });
    expect(flat(byTestId(menu, 'skin-picker')!).map(n => n.type === 'text' ? n.text : n.type)).toEqual(['box', 'Change the look!']);
    const icon = flat(byTestId(menu, 'sign-out')!).find(n => n.type === 'icon')!;
    expect(icon).toMatchObject({ paths: ['M0 0h9v9H0z'], style: { width: '14px', height: '16px', 'flex-shrink': '0' } });
  });

  test('the control is the node marked {entry.testId}: the About line\'s stop is its text alone, below the rule', () => {
    const menu = expand({});
    const stop = byTestId(menu, 'about-line')!;
    expect(stop).toMatchObject({ readingStop: true, label: '{env.aboutLabel}' });
    const holder = flat(menu).find(n => n.type === 'box' && n.children?.includes(stop))!;
    expect(holder.style?.['border-top-width']).toBe('1px');
    expect(holder.when).toEqual([{ test: 'env.aboutLine' }]);
  });

  test('a named look must exist; a missing part falls back to the base\'s, but sections stay flat without a group', () => {
    expect(() => expandProfileMenu({ type: 'profileMenu', look: 'nope' }, docWith({}), velaProfileMenu)).toThrow('Unknown profile menu look nope');
    const menu = expand({ parts: { row: { type: 'box', children: [{ type: 'text', text: '{entry.label}' }] } } });
    expect(byTestId(menu, 'profile-menu-viewer')).toBeDefined();
    expect(menu.children!.some(n => n.testId === 'sign-out')).toBe(true);
  });
});

describe('every built-in skin', () => {
  test('has a profile surface listed here', () => {
    expect(documents.map(([name]) => name).sort()).toEqual(Object.keys(SURFACES).sort());
  });

  for (const [name, doc] of documents) {
    test(`${name} declares renderer 22 or draws the base's menu`, () => {
      const own = doc.slots?.shell;
      if (own) expect(doc.renderer).toBe(22);
    });

    test(`${name}'s menu offers every app entry once on each surface, on phones, desktops and TVs`, () => {
      for (const width of [390, 1440, 1920]) {
        for (const flags of SURFACES[name]!) {
          for (const entry of PROFILE_MENU_ENTRIES) {
            expect(visible(doc, everything(width, flags), marks(entry.id)), `${name} ${width} ${flags} ${entry.id}`).toBe(1);
          }
        }
        // Closed, it offers none of them.
        for (const entry of PROFILE_MENU_ENTRIES.filter(e => e.id !== 'viewer')) {
          expect(visible(doc, everything(width, []), marks(entry.id)), `${name} ${width} closed ${entry.id}`).toBe(0);
        }
        // What the app does not offer is not drawn.
        const none = everything(width, SURFACES[name]![0]!, { canSwitchProfile: false, canPlaylists: false, canDownloads: false, canManageLibraries: false });
        for (const id of ['switchProfile', 'playlists', 'downloads', 'manageLibraries']) expect(visible(doc, none, marks(id)), `${name} ${width} ${id} off`).toBe(0);
      }
    });

    if (name === 'kids') test('Kids offers the entries only past its grown-ups gate', () => {
      for (const width of [390, 1440]) for (const flags of [[], ['gate'], ['gate', 'g2']]) {
        expect(visible(doc, everything(width, flags), marks('manageLibraries')), `${width} ${flags}`).toBe(0);
        expect(visible(doc, everything(width, flags), marks('signOut')), `${width} ${flags}`).toBe(0);
      }
    });

    test(`${name}'s menu keeps the remote inside on TV and Back returns to its trigger`, () => {
      const resolved = resolveDocument(doc, 1920, 'en');
      const ids = new Set<string>();
      const collect = (node: RNode) => {
        if (node.id) ids.add(node.id as string);
        if (node.kind === 'box') node.children.forEach(collect);
        else if (node.kind === 'repeat') collect(node.item);
      };
      collect(resolved.shell!);
      const scopes = scopesOf(resolved.shell!, marks('signOut'));
      expect(scopes.length, name).toBe(SURFACES[name]!.length);
      for (const scope of scopes) {
        // The nearest box with `escape` around Sign out: a TV focus guide that Back closes, its focus
        // returned to the control that opened it.
        expect(scope.escape!.length, name).toBeGreaterThan(0);
        expect(ids.has(scope.returnFocus as string), `${name} returns focus to ${scope.returnFocus}`).toBe(true);
        // It scrolls, so the longer menu fits short screens, and scrolling keeps its guide (0.2.79).
        const { fx } = boxStyle(literal(scope), measure);
        expect(!!fx.scrollY, `${name} scrolls`).toBe(true);
        expect(scrollGuide(true, false, false, true)).toBe('scope');
      }
    });

    test(`${name}'s About line is a reading stop holding only its text, and the server rows stay inside the menu`, () => {
      const shell = resolveDocument(doc, 1920, 'en').shell!;
      for (const scope of scopesOf(shell, marks('signOut'))) {
        const stop = find(scope, marks('about')) as Box;
        expect(stop.kind).toBe('box');
        expect(stop.readingStop).toBe(true);
        expect(stop.children.every(child => child.kind === 'text'), name).toBe(true);
        expect(stop.base.style['border-top-width'], name).toBeUndefined();
        // The server rows reach 10px past their column (as the base's menu rows do): the boxes around
        // the list inset it by at least that much, so the rows line up inside the menu.
        const path = pathTo(scope, find(scope, marks('servers'))!);
        const inset = path.reduce((sum, node) => sum + leftPadding(node.base?.style ?? {}), 0);
        expect(inset, name).toBeGreaterThanOrEqual(10);
      }
    });
  }
});

const measure = { viewport: { width: 1920, height: 1080, insets: { top: 0, right: 0, bottom: 0, left: 0 } }, fontSize: 16, axis: 'x' as const };
const literal = (node: Box) => Object.fromEntries(Object.entries(node.base.style).filter((e): e is [string, string] => typeof e[1] === 'string'));
const px = (value: unknown) => typeof value === 'string' ? Number(/(-?[\d.]+)px/.exec(value)?.[1] ?? 0) : 0;
/** A box's left padding in px (its `padding-left`, else the `padding` shorthand's left value). */
function leftPadding(style: Record<string, unknown>): number {
  if (style['padding-left'] !== undefined) return px(style['padding-left']);
  const padding = style.padding;
  if (typeof padding !== 'string') return 0;
  const values: string[] = [];
  let depth = 0, current = '';
  for (const char of padding) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ' ' && depth === 0) { if (current) values.push(current); current = ''; } else current += char;
  }
  if (current) values.push(current);
  return px(values[3] ?? values[1] ?? values[0]);
}

function find(node: RNode, predicate: (node: RNode) => boolean): RNode | undefined {
  if (predicate(node)) return node;
  if (node.kind === 'box') for (const child of node.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return node.kind === 'repeat' ? find(node.item, predicate) : undefined;
}
function pathTo(from: RNode, to: RNode): RNode[] {
  if (from === to) return [from];
  if (from.kind !== 'box') return [];
  for (const child of from.children) {
    const rest = pathTo(child, to);
    if (rest.length) return [from, ...rest];
  }
  return [];
}
/** The nearest box with `escape` around each node matching `predicate`. */
function scopesOf(node: RNode, predicate: (node: RNode) => boolean, scope?: Box, found: Box[] = []): Box[] {
  if (predicate(node) && scope && !found.includes(scope)) found.push(scope);
  if (node.kind === 'box') {
    const inner = node.escape?.length ? node : scope;
    for (const child of node.children) scopesOf(child, predicate, inner, found);
  }
  return found;
}

/**
 * The skin registry generator. Every skin, official or third-party, is a package in
 * client/skins/<id>/: a skin.json manifest plus Contract files that export the slots it
 * implements (a top-level `component <Slot>`, or a `use` that re-exports one). This
 * writes client/foundation/skins.generated.contract from the installed packages: the
 * skin list, the picker manifests, each skin's traits, and one dispatch component per
 * slot. Nothing in the foundation names a skin by hand.
 *
 *   bun tools/skin.ts generate [<client-dir>] [--only <id>]
 *
 * `--only` keeps a single engine in the dispatch (plus the default skin's slots it falls
 * back to): release builds and skin-package builds use it. The registry data (ids,
 * aliases, manifests, traits) always covers every installed package, so a single-engine
 * build can still list and hand off to the others. See docs/skin-authoring.md.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The slot ABI: each slot's record prop and the app actions it offers, by the names a skin injects. */
/** `frame`: the element the foundation lays every skin's slot out in (a skin draws inside it). */
export interface SlotSpec { name: string; record: string; children?: boolean; frame?: string; actions: Record<string, string> }
export const SLOT_API = 2;
export const SLOTS: SlotSpec[] = [
  { name: 'Shell', record: 'ShellProps', children: true, actions: { chooseSkin: 'chooseSkin', signOut: 'logout', home: 'goHome', search: 'openSearch', live: 'openLive', library: 'goHome', openLibrary: 'openLibrary', goSecure: 'goSecure' } },
  { name: 'Home', record: 'HomeProps', children: true, actions: { selectTitle: 'selectTitle', observe: 'observe', pickHero: 'pickHero', reachEnd: 'loadMoreHome', reachRowEnd: 'loadMoreRow', previewIntent: 'previewIntent', playHero: 'playHero', openLibrary: 'openLibrary', live: 'openLive' } },
  { name: 'SearchSurface', record: 'SearchProps', actions: { openLiveProgramme: 'openLiveProgramme', retryDescriptive: 'retryDescriptive', selectTitle: 'selectTitle', observe: 'observe' } },
  { name: 'SearchField', record: 'SearchFieldProps', actions: { edit: 'edit' } },
  { name: 'Detail', record: 'DetailProps', actions: { play: 'play', playExtra: 'playExtra', selectTitle: 'selectTitle', observe: 'observeDetail' } },
  { name: 'Status', record: 'StatusProps', actions: { retry: 'retryFailed' } },
  { name: 'Collection', record: 'CollectionProps', actions: { close: 'close', selectTitle: 'selectTitle', observe: 'observe' } },
  { name: 'Library', record: 'LibraryProps', actions: { close: 'goHome', setSort: 'setLibrarySort', setFilter: 'setLibraryFilter', more: 'moreLibrary', selectTitle: 'selectTitle', observe: 'observe' } },
  { name: 'Guide', record: 'GuideProps', frame: 'column flex=1 min-height=0', actions: { watch: 'watchChannel', previous: 'earlierGuide', next: 'laterGuide', chooseDay: 'chooseGuideDay', setZoom: 'setGuideZoom', tileMessage: 'tileMessage', tileUnmute: 'tileUnmute', tileTuneIn: 'tileTuneIn', retune: 'retuneTile' } },
  { name: 'LiveControls', record: 'LiveControlsProps', actions: { toggleLowDelay: 'toggleLowDelay', catchUp: 'catchUpLive', zap: 'zap' } },
  { name: 'MiniGuide', record: 'MiniGuideProps', actions: { tune: 'tuneZap' } },
  { name: 'PlayerChrome', record: 'PlayerProps', actions: { command: 'watchControl', seek: 'watchSeek', editing: 'editWatch', close: 'closeWatch', toggleInfo: 'toggleWatchInfo' } },
  { name: 'AuthStage', record: 'AuthStageProps', children: true, actions: {} },
  { name: 'AuthNotice', record: 'AuthNoticeProps', actions: {} },
  { name: 'SignIn', record: 'SignInProps', actions: { editUsername: 'editUsername', editPassword: 'editPassword', submit: 'submitSignIn', quick: 'startCode', goSecure: 'goSecure' } },
  { name: 'QuickConnect', record: 'QuickConnectProps', actions: { cancel: 'cancelCode' } },
];
/** Functions a skin may export; a parameter is matched by its name (`width`, `doc`). */
export const FUNCTIONS = { detailPresentation: '"fullscreen"', detailSplit: '"none"' } as const;
const FUNCTION_ARGS: Record<string, string> = { width: 'width', doc: 'doc' };

/** What the root reads about the active skin instead of naming it. Missing values come from the default skin. */
export interface SkinTraits {
  page: string; ink: string; flatDetail: boolean; panSections: boolean; barMask: boolean; splashOnPaper: boolean;
  detailScrim: string; detailShadow: string; closeBorderWidth: number; closeBorderColor: string; closeBackground: string; closeInk: string;
}
const TRAIT_KEYS: (keyof SkinTraits)[] = ['page', 'ink', 'flatDetail', 'panSections', 'barMask', 'splashOnPaper', 'detailScrim', 'detailShadow', 'closeBorderWidth', 'closeBorderColor', 'closeBackground', 'closeInk'];

export interface InstalledSkin {
  schema: 1; id: string; name: string; tagline: string; preview: string; swatches: string[];
  /** Translated name and tagline (string keys); a package's literal name and tagline otherwise. */
  nameKey?: string; taglineKey?: string;
  /** Older ids that mean this skin (index: editorial). */
  aliases?: string[];
  /** In the appearance picker: always, only when the server lists it, or never (a document engine). */
  offer?: 'always' | 'server' | 'never';
  /** Picker order; packages default to 100, then by id. */
  order?: number;
  /** The skin every other skin falls back to for slots it does not implement. Exactly one. */
  default?: boolean;
  /** The engine that draws server skin documents. At most one. */
  documents?: boolean;
  traits?: Partial<SkinTraits>;
}
interface Found { skin: InstalledSkin; slots: Map<string, string>; functions: Map<string, { file: string; params: string[] }> }

const pascal = (id: string) => id.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('');
const str = (value: string) => JSON.stringify(value);

/** The slots and functions a package exports: own components and re-exported ones. */
async function scan(dir: string): Promise<Pick<Found, 'slots' | 'functions'>> {
  const slots = new Map<string, string>(), functions = new Map<string, { file: string; params: string[] }>();
  const names = new Set(SLOTS.map(s => s.name));
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.contract')).sort()) {
    const text = await readFile(join(dir, file), 'utf8');
    const claim = (slot: string) => {
      if (slots.has(slot) && slots.get(slot) !== file) throw new Error(`${dir}: slot ${slot} is exported by both ${slots.get(slot)} and ${file}`);
      slots.set(slot, file);
    };
    for (const m of text.matchAll(/^component (\w+)$/gm)) if (names.has(m[1])) claim(m[1]);
    for (const m of text.matchAll(/^use (.+) from "[^"]+"$/gm))
      for (const item of m[1].split(', ')) { const local = item.split(' as ').pop()!.trim(); if (names.has(local)) claim(local); }
    for (const m of text.matchAll(/^fn (\w+)\(([^)]*)\)/gm)) {
      if (!(m[1] in FUNCTIONS)) continue;
      const params = m[2].split(',').map(p => p.split(':')[0].trim()).filter(Boolean);
      for (const p of params) if (!(p in FUNCTION_ARGS)) throw new Error(`${dir}/${file}: fn ${m[1]} takes ${p}; the foundation passes only ${Object.keys(FUNCTION_ARGS).join(', ')}`);
      functions.set(m[1], { file, params });
    }
  }
  return { slots, functions };
}

export async function installed(client: string): Promise<Found[]> {
  const root = join(client, 'skins');
  const found: Found[] = [];
  for (const id of (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort()) {
    const manifest = join(root, id, 'skin.json');
    if (!(await Bun.file(manifest).exists())) continue;
    const skin = JSON.parse(await readFile(manifest, 'utf8')) as InstalledSkin;
    if (skin.id !== id) throw new Error(`skins/${id}/skin.json: id is ${skin.id}, not its directory's name`);
    for (const key of ['name', 'tagline', 'preview'] as const) if (typeof skin[key] !== 'string') throw new Error(`skins/${id}/skin.json: ${key} is required`);
    found.push({ skin, ...(await scan(join(root, id))) });
  }
  const defaults = found.filter(f => f.skin.default);
  if (defaults.length !== 1) throw new Error(`Exactly one installed skin must be the default (skin.json "default": true); found ${defaults.length}`);
  if (found.filter(f => f.skin.documents).length > 1) throw new Error('At most one installed skin draws documents');
  const missing = SLOTS.filter(s => !defaults[0].slots.has(s.name)).map(s => s.name);
  if (missing.length) throw new Error(`The default skin ${defaults[0].skin.id} must implement every slot; it lacks ${missing.join(', ')}`);
  const ids = new Map<string, string>();
  for (const f of found) for (const name of [f.skin.id, ...(f.skin.aliases ?? [])]) {
    if (ids.has(name)) throw new Error(`Skin id or alias ${name} is claimed by ${ids.get(name)} and ${f.skin.id}`);
    ids.set(name, f.skin.id);
  }
  return found.sort((a, b) => (a.skin.order ?? 100) - (b.skin.order ?? 100) || a.skin.id.localeCompare(b.skin.id));
}

function traitsOf(f: Found, base: SkinTraits): string {
  const t = { ...base, ...f.skin.traits };
  for (const key of TRAIT_KEYS) if (t[key] === undefined) throw new Error(`${f.skin.id}: trait ${key} has no value (the default skin must set every trait)`);
  return `SkinTraits(${TRAIT_KEYS.map(k => `${k}=${typeof t[k] === 'string' ? str(t[k] as string) : t[k]}`).join(', ')})`;
}
const manifestOf = (s: InstalledSkin) =>
  `SkinManifest(id=${str(s.id)}, name=${s.nameKey ? `t(${str(s.nameKey)})` : str(s.name)}, tagline=${s.taglineKey ? `t(${str(s.taglineKey)})` : str(s.tagline)}, preview=${str(s.preview)}, swatches=${JSON.stringify(s.swatches)})`;
/** `(id == "a" ? A : id == "b" ? B : Fallback)` over the skins, the default last. */
const chain = (subject: string, branches: [string, string][], fallback: string) =>
  branches.length ? `(${branches.map(([id, value]) => `${subject} == ${str(id)} ? ${value} : `).join('')}${fallback})` : fallback;

export async function generateRegistry(client: string, only?: string): Promise<string> {
  const skins = await installed(client);
  const fallback = skins.find(f => f.skin.default)!;
  if (only && !skins.some(f => f.skin.id === only)) throw new Error(`--only ${only}: no installed skin with that id`);
  const engines = only ? skins.filter(f => f.skin.id === only || f === fallback) : skins;
  const others = engines.filter(f => f !== fallback);
  const baseTraits = { ...fallback.skin.traits } as SkinTraits;
  const lines: string[] = [
    '// GENERATED by `bun tools/skin.ts generate` from client/skins/*/skin.json and the slots each',
    '// package exports. Do not edit: change a package and run the generator.',
    only ? `// Single-engine build: dispatches ${only}${only === fallback.skin.id ? '' : ` and ${fallback.skin.id}'s fallback slots`}.` : '// Every installed engine is dispatched.',
    'use SkinManifest from "./models.contract"',
    'use SkinTraits, ' + SLOTS.map(s => s.record).join(', ') + ' from "./slot-api.contract"',
    'use SkinDoc from "../renderer/shapes.contract"',
  ];
  const local = (f: Found, name: string) => `${pascal(f.skin.id)}${name[0].toUpperCase()}${name.slice(1)}`;
  const onlySkin = only ? skins.find(f => f.skin.id === only)! : undefined;
  for (const f of engines) {
    const byFile = new Map<string, string[]>();
    for (const slot of SLOTS) {
      const file = f.slots.get(slot.name);
      // In a single-engine build the default skin supplies only the slots the engine lacks.
      const drawn = !onlySkin || f === onlySkin || !onlySkin.slots.has(slot.name);
      if (file && drawn) byFile.set(file, [...(byFile.get(file) ?? []), `${slot.name} as ${local(f, slot.name)}`]);
    }
    for (const [name, fn] of f.functions) if (!onlySkin || f === onlySkin || !onlySkin.functions.has(name)) byFile.set(fn.file, [...(byFile.get(fn.file) ?? []), `${name} as ${local(f, name)}`]);
    for (const [file, items] of [...byFile].sort()) lines.push(`use ${items.join(', ')} from "../skins/${f.skin.id}/${file}"`);
  }
  const offered = skins.filter(f => (f.skin.offer ?? 'server') !== 'never');
  const serverOnly = offered.filter(f => (f.skin.offer ?? 'server') === 'server').map(f => f.skin.id);
  const aliases = skins.flatMap(f => (f.skin.aliases ?? []).map(a => [a, str(f.skin.id)] as [string, string]));
  const documents = skins.find(f => f.skin.documents);
  lines.push(
    '',
    '// Every installed skin, in picker order.',
    `fn installedSkins(): string[] = ${JSON.stringify(skins.map(f => f.skin.id))}`,
    `fn defaultSkin(): string = ${str(fallback.skin.id)}`,
    '// The skin that draws server skin documents ("" when none is installed).',
    `fn documentsSkin(): string = ${str(documents?.skin.id ?? '')}`,
    '// An id or alias to its skin; an unknown id is the default skin.',
    `fn resolveSkin(id: string): string = ${chain('id', aliases, `(installedSkins().includes(id) ? id : defaultSkin())`)}`,
    '// The picker entry of each skin.',
    `fn skinManifest(id: string): SkinManifest = ${chain('resolveSkin(id)', skins.filter(f => f !== fallback).map(f => [f.skin.id, manifestOf(f.skin)]), manifestOf(fallback.skin))}`,
    '// The skins the picker offers: the always-offered ones, and the server-listed ones the server lists.',
    `fn pickerSkins(serverSkins: string[]): SkinManifest[] = ${JSON.stringify(offered.map(f => f.skin.id))}${serverOnly.length ? `.filter(id => not ${JSON.stringify(serverOnly)}.includes(id) or serverSkins.includes(id))` : ''}.map(id => skinManifest(id))`,
    '// What the root reads about the active skin (page colours, detail frame, section motion).',
    `fn skinTraits(id: string): SkinTraits = ${chain('id', skins.filter(f => f !== fallback).map(f => [f.skin.id, traitsOf(f, baseTraits)]), traitsOf(fallback, baseTraits))}`,
  );
  for (const [name, otherwise] of Object.entries(FUNCTIONS)) {
    const call = (f: Found) => { const fn = f.functions.get(name)!; return `${local(f, name)}(${fn.params.map(p => FUNCTION_ARGS[p]).join(', ')})`; };
    const branches = others.filter(f => f.functions.has(name)).map(f => [f.skin.id, call(f)] as [string, string]);
    const base = fallback.functions.has(name) ? call(fallback) : otherwise;
    // A single-engine build has one answer; a runtime chain would compile every branch.
    const body = only ? (branches.length ? branches[0][1] : base) : chain('skin', branches, base);
    lines.push(`fn skin${name[0].toUpperCase()}${name.slice(1)}(skin: string, width: number, doc: SkinDoc): string = ${body}`);
  }
  for (const slot of SLOTS) {
    const aliased = Object.entries(slot.actions).filter(([local, app]) => local !== app);
    const own = others.filter(f => f.slots.has(slot.name));
    // A single-engine build draws exactly one implementation: the engine's own, else the
    // default's. No runtime test, so no other skin's slot is compiled into it.
    const branching = !only && own.length > 0;
    lines.push('', `component ${slot.name}`, '  props', `    p: ${slot.record}`, '  inject', ...(branching ? ['    activeSkin: string'] : []));
    for (const app of [...new Set(aliased.map(([, app]) => app))]) lines.push(`    ${app}: action`);
    if (lines[lines.length - 1] === '  inject') lines.pop();
    if (aliased.length) { lines.push('  provide'); for (const [name, app] of aliased) lines.push(`    ${name} = ${app}`); }
    if (slot.children) lines.push('  slot');
    lines.push('  view');
    const at = slot.frame ? '      ' : '    ';
    if (slot.frame) lines.push(`    ${slot.frame}`);
    const draw = (f: Found, depth: string) => [`${depth}${local(f, slot.name)}(p=p)`, ...(slot.children ? [`${depth}  children`] : [])];
    if (!branching) lines.push(...draw(own[0] ?? fallback, at));
    else {
      own.forEach((f, i) => lines.push(`${at}${i ? 'else if' : 'if'} activeSkin == ${str(f.skin.id)}`, ...draw(f, `${at}  `)));
      lines.push(`${at}else`, ...draw(fallback, `${at}  `));
    }
  }
  // The route view (docs/skin-distribution.md, "End state"): the documents skin's Route,
  // when that skin is part of this build; otherwise a route is never handed to it.
  const docs = engines.find(f => f.skin.documents);
  // `close` is a host command too: the route view gets the app's close as `leave`.
  lines.push('', '// The route view: the one place the renderer draws a whole route.', 'component DocRoute', '  props', '    p: RouteProps', '  inject', '    close: action', '  provide', '    leave = close', '  view');
  if (docs) {
    lines.splice(lines.indexOf('use SkinDoc from "../renderer/shapes.contract"'), 1, 'use SkinDoc, RouteProps from "../renderer/shapes.contract"', `use Route as DocumentsRoute from "../skins/${docs.skin.id}/slots.contract"`);
    lines.push('    DocumentsRoute(p=p)');
  } else {
    lines.splice(lines.indexOf('use SkinDoc from "../renderer/shapes.contract"'), 1, 'use SkinDoc, RouteProps from "../renderer/shapes.contract"');
    lines.push('    column display="none" aria-hidden=true');
  }
  const text = lines.join('\n') + '\n';
  await writeFile(join(client, 'foundation/skins.generated.contract'), text);
  return text;
}

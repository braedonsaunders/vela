/**
 * Vela skin packages: check, build and sign a third-party skin as its own engine build.
 *
 *   bun tools/skin.ts generate [<client>] [--only <id>]  regenerate client/foundation/skins.generated.contract
 *                                                from the installed packages (client/skins/<id>/)
 *   bun tools/skin.ts init <dir> [--id <id>]     scaffold a package from the reference (example) skin
 *   bun tools/skin.ts check <dir>                validate a package without building
 *   bun tools/skin.ts keygen <key-id>            make an Ed25519 signing key (~/.config/vela/keys)
 *   bun tools/skin.ts build <dir> [--key <id>]   compile the package with the committed Vela source and the
 *                                                pinned Exact into a signed single-engine build (/vela/engines/<id>/<version>/)
 *
 * A package is source, not code that runs at build time: Contract files against the
 * slot ABI (foundation/slot-api.contract), a skin.json manifest, optional strings and
 * assets. Official skins are packages too (client/skins/<id>/), installed by the same
 * generator. The build installs a package as client/skins/<id>/ in a staged, committed
 * Vela snapshot (never the working tree), generates that build's registry, compiles it
 * with Exact's production web build and signs the result. See docs/skin-authoring.md.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { generateLocales } from './locales';
import { mountRoutes, prepareEngine } from './engine';
import { SLOT_API, SLOTS, FUNCTIONS, generateRegistry, installed } from './skin-registry';
import { finalizeEngineRoot } from './release/engine-root';

const root = resolve(import.meta.dir, '..');
// Build output stays on the internal disk, inside the checkout (gitignored), never on ~/.scratch.
const out = join(root, '.artifacts/skins');
const keys = join(homedir(), '.config/vela/keys');
/** Shared models, the slot records and official skins' parts a package may import, as written from its own directory. */
const IMPORTS = /^(\.\/[a-z0-9-]+\.contract|\.\.\/\.\.\/foundation\/(models|player-models|skin-picker|slot-api)\.contract|\.\.\/\.\.\/live\/models\.contract|\.\.\/(cinematic|index|jellytwin|mochi|marquee)\/[a-z0-9-]+\.contract)$/;
/** Contract a skin may not write: data access, persistence, native views, foreign origins. */
const FORBIDDEN: [RegExp, string][] = [
  [/^\s*(resource|mutation|members)\b/m, 'declares data access (resource, mutation or members)'],
  [/^\s*(send|refresh)\s/m, 'sends or refreshes a source'],
  [/\bpersist\b/, 'persists state'],
  [/^\s*vela-[a-z-]+\b/m, 'mounts a native view'],
  [/\bhttps?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}\//i, 'names a URL outside the app'],
];
const ASSET = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.ttf', '.otf', '.woff', '.woff2']);
const LIMITS = { files: 200, contractBytes: 512 * 1024, assetBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024 };

interface SkinJson { schema: 1; id: string; name: string; version: string; tagline: string; slotApi: number; vela: string; preview: string; swatches: string[] }
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
/** Sorted keys, no whitespace: the bytes a signature covers (as Exact's update envelope). */
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  const child = Bun.spawn(cmd, { cwd, env, stdout: 'pipe', stderr: 'inherit' });
  const text = await new Response(child.stdout).text();
  if (await child.exited) throw new Error(`${cmd.slice(0, 3).join(' ')} failed`);
  return text;
}
async function files(dir: string, base = dir): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`${relative(base, path)}: links are not allowed`);
    if (entry.isDirectory()) found.push(...await files(path, base));
    else if (entry.isFile()) found.push(relative(base, path));
    else throw new Error(`${relative(base, path)}: not a regular file`);
  }
  return found.sort();
}

/** Every rule a package must meet before it is compiled; returns its manifest. */
async function check(dir: string): Promise<{ skin: SkinJson; list: string[] }> {
  const problems: string[] = [];
  const skin = JSON.parse(await readFile(join(dir, 'skin.json'), 'utf8')) as SkinJson;
  if (skin.schema !== 1) problems.push('skin.json: schema must be 1');
  const builtIn = (await installed(join(root, 'client'))).flatMap(f => [f.skin.id, ...(f.skin.aliases ?? [])]);
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(skin.id ?? '') || builtIn.includes(skin.id)) problems.push('skin.json: id must be a new lowercase name, not an installed skin');
  if (typeof skin.name !== 'string' || !skin.name || skin.name.length > 40) problems.push('skin.json: name is 1-40 characters');
  if (!/^\d+\.\d+\.\d+$/.test(skin.version ?? '')) problems.push('skin.json: version is semver x.y.z');
  if (skin.slotApi !== SLOT_API) problems.push(`skin.json: slotApi ${skin.slotApi} is not this Vela's (${SLOT_API})`);
  if (!Array.isArray(skin.swatches) || skin.swatches.length > 5 || skin.swatches.some(c => !/^#[0-9a-f]{6}$/.test(c))) problems.push('skin.json: swatches are up to five #rrggbb colours');
  const list = await files(dir);
  if (list.length > LIMITS.files) problems.push(`more than ${LIMITS.files} files`);
  let total = 0, contracts = 0;
  for (const path of list) {
    const bytes = await readFile(join(dir, path));
    total += bytes.length;
    if (path === 'skin.json' || /^strings\/[a-z]{2}(-[A-Z]{2})?\.json$/.test(path)) continue;
    if (/^[a-z0-9-]+\.contract$/.test(path)) {
      contracts += bytes.length;
      const text = bytes.toString('utf8');
      for (const [pattern, why] of FORBIDDEN) if (pattern.test(text)) problems.push(`${path}: ${why}`);
      for (const m of text.matchAll(/^use .* from "([^"]+)"/gm)) if (!IMPORTS.test(m[1])) problems.push(`${path}: imports ${m[1]}, outside the slot API`);
      continue;
    }
    if (path.startsWith('assets/') && ASSET.has(extname(path).toLowerCase())) {
      if (bytes.length > LIMITS.assetBytes) problems.push(`${path}: over ${LIMITS.assetBytes} bytes`);
      if (extname(path) === '.svg' && /<script|\bon[a-z]+=|href="(?!#)|https?:/i.test(bytes.toString('utf8'))) problems.push(`${path}: SVG with script, handlers or external references`);
      continue;
    }
    problems.push(`${path}: not a package file (contract, skin.json, strings/<locale>.json, assets/ images or fonts)`);
  }
  if (contracts > LIMITS.contractBytes) problems.push(`Contract source over ${LIMITS.contractBytes} bytes`);
  if (total > LIMITS.totalBytes) problems.push(`package over ${LIMITS.totalBytes} bytes`);
  if (skin.preview && !list.includes(skin.preview)) problems.push(`skin.json: preview ${skin.preview} is not in the package`);
  for (const path of list.filter(p => p.startsWith('strings/'))) {
    const strings = JSON.parse(await readFile(join(dir, path), 'utf8')) as Record<string, unknown>;
    for (const [k, v] of Object.entries(strings)) if (!k.startsWith(`skin.${skin.id}.`) || typeof v !== 'string') problems.push(`${path}: ${k} must be a skin.${skin.id}.* string`);
  }
  // A package implements any slots it likes (the default skin draws the rest); each takes the slot's record.
  const sources = await Promise.all(list.filter(p => p.endsWith('.contract')).map(async path => [path, await readFile(join(dir, path), 'utf8')] as const));
  for (const slot of SLOTS) for (const [path, text] of sources) {
    const m = new RegExp(`^component ${slot.name}\\n  props\\n((?:    .*\\n)+)`, 'm').exec(text);
    if (m && !new RegExp(`^    p: ${slot.record}$`, 'm').test(m[1])) problems.push(`${path}: component ${slot.name} takes one prop, p: ${slot.record} (slot API ${SLOT_API})`);
  }
  if (!sources.some(([, text]) => SLOTS.some(slot => new RegExp(`^component ${slot.name}$`, 'm').test(text)) || Object.keys(FUNCTIONS).some(name => new RegExp(`^fn ${name}\\(`, 'm').test(text)))) problems.push('implements no slot');
  if (problems.length) throw new Error(`${skin.id ?? basename(dir)} is not a valid skin package:\n- ${problems.join('\n- ')}`);
  return { skin, list };
}

/** Install the package into a staged client as client/skins/<id>/, then generate that build's registry for it alone. */
async function install(client: string, dir: string, skin: SkinJson, list: string[]) {
  const slot = join(client, 'skins', skin.id);
  await rm(slot, { recursive: true, force: true });
  await mkdir(slot, { recursive: true });
  for (const path of list.filter(p => p.endsWith('.contract'))) {
    // Package assets live at assets/skins/<id>/ in the app.
    const text = (await readFile(join(dir, path), 'utf8')).replace(/"assets\//g, `"assets/skins/${skin.id}/`);
    await writeFile(join(slot, path), text);
  }
  const preview = skin.preview ? `assets/skins/${skin.id}/${skin.preview.replace(/^assets\//, '')}` : '';
  await writeFile(join(slot, 'skin.json'), JSON.stringify({ schema: 1, id: skin.id, name: skin.name, tagline: skin.tagline ?? '', preview, swatches: skin.swatches, offer: 'server' }, null, 2) + '\n');
  for (const path of list.filter(p => p.startsWith('assets/'))) {
    const to = join(client, 'assets/skins', skin.id, path.slice('assets/'.length));
    await mkdir(dirname(to), { recursive: true });
    await cp(join(dir, path), to);
  }
  for (const path of list.filter(p => p.startsWith('strings/'))) {
    const target = join(client, path);
    const base = JSON.parse(await readFile(target, 'utf8').catch(() => '{}'));
    await writeFile(target, JSON.stringify({ ...base, ...JSON.parse(await readFile(join(dir, path), 'utf8')) }, null, 2) + '\n');
  }
  // A single-engine build of the package (and the default skin's slots it falls back to),
  // installed by the same generator as every official skin.
  await prepareEngine(client, skin.id);
}

async function build(dir: string, keyId: string) {
  const { skin, list } = await check(dir);
  const pem = join(keys, `${keyId}.pem`);
  const privateKey = createPrivateKey(await readFile(pem, 'utf8').catch(() => { throw new Error(`No signing key ${pem}: bun tools/skin.ts keygen ${keyId}`); }));
  const exactRevision = (await readFile(join(root, 'EXACT_REVISION'), 'utf8')).trim();
  if ((await run(['git', '-C', join(root, 'vendor/exact'), 'rev-parse', 'HEAD'], root)).trim() !== exactRevision) throw new Error('vendor/exact is not at EXACT_REVISION');
  const velaRevision = (await run(['git', 'rev-parse', 'HEAD'], root)).trim();
  const velaVersion = String((await Bun.file(join(root, 'client/package.json')).json()).version ?? (await readFile(join(root, 'tools/release/VERSION'), 'utf8')).trim());
  const target = join(out, `${skin.id}-${skin.version}`);
  if (await Bun.file(join(target, 'skin-build.json')).exists()) throw new Error(`${target} exists; versions are immutable`);
  await mkdir(out, { recursive: true });
  const work = await mkdtemp(join(out, '.build-'));
  try {
    // The committed client only: other people's edits in the working tree never ship.
    const tar = join(work, 'source.tar');
    if (await Bun.spawn(['git', 'archive', '--format=tar', velaRevision, 'client', 'protocol'], { cwd: root, stdout: Bun.file(tar) }).exited) throw new Error('git archive failed');
    await run(['tar', '-xf', tar, '-C', work], root);
    await rm(tar);
    const client = join(work, 'client');
    await install(client, dir, skin, list);
    await mountRoutes(client);
    await generateLocales(client);
    const env = { ...process.env, EXACT: join(root, 'vendor/exact'), EXACT2: join(root, 'vendor/exact'), API_BASE_URL: '', VELA_MOCK: '0', VELA_BUILD_VERSION: velaVersion, EXACT_VERSION: velaVersion };
    await run([process.execPath, 'player/build.ts'], client, env);
    const dist = join(client, 'dist');
    await run([process.execPath, 'exact.mjs', 'web-build', '--out', dist, '--render', 'none'], client, env);
    await rm(join(dist, '.exact-build.json'), { force: true });
    // Served beside the official engines, under its own versioned base.
    const base = await finalizeEngineRoot(dist, skin.id, skin.version);
    const cards: { path: string; bytes: number; sha256: string }[] = [];
    for (const path of await files(dist)) { const bytes = await readFile(join(dist, path)); cards.push({ path, bytes: bytes.length, sha256: digest(bytes) }); }
    await mkdir(target, { recursive: true });
    const archive = join(target, 'webroot.tar.gz');
    await run(['tar', '--format=ustar', '-czf', archive, '-C', dist, '.'], root, { ...process.env, COPYFILE_DISABLE: '1' });
    const sources: Record<string, string> = {};
    for (const path of list) sources[path] = digest(await readFile(join(dir, path)));
    const manifest = {
      schema: 1, kind: 'vela-skin-build', id: skin.id, name: skin.name, version: skin.version, tagline: skin.tagline ?? '', swatches: skin.swatches,
      engine: skin.id, base, slotApi: SLOT_API, protocolVersions: [0], velaVersion, velaRevision, exactRevision, builtAt: new Date().toISOString(),
      source: { sha256: digest(canonical(sources)), files: sources },
      archive: { file: 'webroot.tar.gz', sha256: digest(await readFile(archive)), bytes: (await readFile(archive)).length }, files: cards,
    };
    const signature = { keyId, ed25519: sign(null, Buffer.from(canonical(manifest)), privateKey).toString('base64') };
    await writeFile(join(target, 'skin-build.json'), JSON.stringify({ ...manifest, signature }, null, 2) + '\n');
    const gz = (await readFile(archive)).length, js = cards.find(c => c.path === 'app.js');
    console.log(JSON.stringify({ build: target, id: skin.id, version: skin.version, archiveBytes: gz, appJsBytes: js?.bytes, files: cards.length, keyId }, null, 2));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function init(dir: string, id: string) {
  if (await Bun.file(join(dir, 'skin.json')).exists()) throw new Error(`${dir} already holds a package`);
  await mkdir(join(dir, 'assets'), { recursive: true });
  const slots = await readFile(join(root, 'client/skins/example/slots.contract'), 'utf8');
  // The reference skin borrows index's player, guide and live controls: keep those imports.
  await writeFile(join(dir, 'slots.contract'), slots);
  await cp(join(root, 'client/assets/skins/example.jpg'), join(dir, 'assets/preview.jpg'));
  const skin: SkinJson = { schema: 1, id, name: id[0].toUpperCase() + id.slice(1), version: '1.0.0', tagline: 'A Vela skin.', slotApi: SLOT_API, vela: '>=0.1.0 <0.2.0', preview: 'assets/preview.jpg', swatches: ['#090b0e', '#f5f1e9', '#858d98'] };
  await writeFile(join(dir, 'skin.json'), JSON.stringify(skin, null, 2) + '\n');
  console.log(`Package ${id} at ${dir}. Edit slots.contract, then: bun tools/skin.ts build ${dir}`);
}

async function keygen(id: string) {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('key id: lowercase letters, digits and dashes');
  const pem = join(keys, `${id}.pem`);
  if (await Bun.file(pem).exists()) throw new Error(`${pem} exists`);
  const { privateKey } = generateKeyPairSync('ed25519');
  await mkdir(keys, { recursive: true, mode: 0o700 });
  await writeFile(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const raw = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
  console.log(JSON.stringify({ keyId: id, ed25519: Buffer.from(raw).toString('base64'), privateKey: pem }));
}

const [command, target] = process.argv.slice(2);
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
try {
  if (command === 'generate') {
    const client = target && !target.startsWith('--') ? resolve(target) : join(root, 'client');
    const only = flag('--only', '') || undefined;
    await generateRegistry(client, only);
    console.log(`${relative(root, join(client, 'foundation/skins.generated.contract'))}: ${(await installed(client)).map(f => f.skin.id).join(', ')}${only ? ` (dispatching ${only})` : ''}`);
  }
  else if (command === 'init' && target) await init(resolve(target), flag('--id', basename(resolve(target))));
  else if (command === 'check' && target) { const { skin, list } = await check(resolve(target)); console.log(`${skin.id} ${skin.version}: valid (${list.length} files)`); }
  else if (command === 'build' && target) await build(resolve(target), flag('--key', 'local'));
  else if (command === 'keygen' && target) await keygen(target);
  else throw new Error('Usage: bun tools/skin.ts generate [<client>] [--only <id>] · init|check|build <dir> [--id <id>] [--key <key-id>] · keygen <key-id>');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

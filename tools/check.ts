/**
 * Check one engine's single-engine profile instead of the all-skins app (whose lowering
 * takes many minutes while compiled skins exist):
 *
 *   bun tools/check.ts <engine>                       contract build, errors only (under the build lock)
 *   bun tools/check.ts <engine> --agent "<op>" …      then drive it: bun exact.mjs agent web <ops>
 *
 * The client (tracked and untracked files of this checkout) is staged under
 * .artifacts/check/<engine>/ and profiled with prepareEngine; the checkout is never touched.
 */
import { cp, lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { engines, prepareEngine } from './engine';
import { generateLocales } from './locales';

const root = resolve(import.meta.dir, '..');
const ENGINES = await engines(join(root, 'client'));
const lock = '/Users/braedonsaunders/.bb/thread-storage/vela-orch/locked.sh';
const [engine, ...rest] = process.argv.slice(2);
const installed = await engines(join(root, 'client'));
if (!engine || !installed.includes(engine)) throw new Error(`Usage: bun tools/check.ts <${installed.join('|')}> [--agent <ops…>]`);
const stage = join(root, '.artifacts/check', engine);

const git = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard', '-z', '--', 'client', 'protocol'], { cwd: root });
await rm(stage, { recursive: true, force: true });
for (const path of git.stdout.toString().split('\0').filter(p => p && !p.includes('node_modules') && !p.startsWith('client/target'))) {
  const from = join(root, path), to = join(stage, path);
  await mkdir(dirname(to), { recursive: true });
  if ((await lstat(from).catch(() => null))?.isSymbolicLink()) await symlink(await readlink(from), to);
  else await cp(from, to).catch(() => {});
}
await mkdir(join(stage, 'vendor'), { recursive: true });
await symlink(join(root, 'vendor/exact'), join(stage, 'vendor/exact'));
await symlink(join(root, 'client/node_modules'), join(stage, 'client/node_modules')).catch(() => {});
await prepareEngine(join(stage, 'client'), engine);
await generateLocales(join(stage, 'client'));
const client = join(stage, 'client');
const run = (cmd: string[], env: Record<string, string> = {}) => Bun.spawnSync(cmd, { cwd: client, env: { ...process.env, ...env }, stdout: 'inherit', stderr: 'inherit' }).exitCode;
if (run([process.execPath, 'player/build.ts'])) process.exit(1);
// Builds lower the contract with Exact's debug compiler unless EXACT_WEB_COMPILER names the
// optimised one (host/web-js/module.mjs webCompiler): about ten times slower on the doc engine,
// past the contract build's 10-minute bound for its nested type check.
const compiler = join(root, 'vendor/exact/target/host-dev/exact-web-js');
const fast: Record<string, string> = existsSync(compiler) ? { EXACT_WEB_COMPILER: compiler } : {};
const agent = rest.indexOf('--agent');
if (agent < 0) {
  // Compile only, one at a time across the machine.
  process.exit(run([lock, process.execPath, 'exact.mjs', 'contract', 'build', 'app.contract', '--json', '--errors-only'], fast) ?? 1);
}
// A drive builds and serves the profile; it is not wrapped in the lock (it would hold it for the whole session).
process.exit(run([process.execPath, 'exact.mjs', 'agent', 'web', ...rest.slice(agent + 1)], fast) ?? 1);

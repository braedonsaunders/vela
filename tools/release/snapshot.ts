/** A captured commit and isolated, credential-free build environment. */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { inventory } from './inventory';

export async function run(command: string[], cwd: string, env: Record<string, string>): Promise<string> {
  const child = Bun.spawn(command, { cwd, env, stdout: 'pipe', stderr: 'inherit' });
  const pending = new Response(child.stdout).text();
  const status = await child.exited;
  const output = await pending;
  if (status) throw new Error(`${command[0]} ${command[1] ?? ''} exited ${status}`);
  return output;
}

export async function capture(root: string, work: string, committed: boolean) {
  const node = Bun.which('node');
  if (!node) throw new Error('Expo release export requires a host Node executable on PATH');
  // No inherited Expo values, package registry tokens, signing keys or viewer credentials.
  const env: Record<string, string> = {
    PATH: `${dirname(process.execPath)}:${dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: join(work, 'home'),
    TMPDIR: join(work, 'tmp'),
    BUN_INSTALL_CACHE_DIR: join(work, 'bun-cache'),
    COPYFILE_DISABLE: '1',
    EXPO_NO_DOTENV: '1',
    EXPO_NO_TELEMETRY: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  await mkdir(env.HOME);
  await mkdir(env.TMPDIR);
  const revision = (await run(['git', 'rev-parse', 'HEAD'], root, env)).trim();
  const roots = ['apps', 'packages', 'modules', 'tools', 'brand', 'patches', 'package.json', 'bun.lock',
    'bunfig.toml', 'THIRD_PARTY_NOTICES'];
  const dirty = (await run(['git', 'status', '--porcelain', '--', ...roots], root, env)).trim();
  const toolDirty = (await run(['git', 'status', '--porcelain', '--', 'tools/release'], root, env)).trim();
  if (toolDirty || dirty && !committed) {
    throw new Error('Commit release inputs first, or use --committed for HEAD (release tooling must always be committed)');
  }
  const source = join(work, 'source');
  await mkdir(source);
  const archive = join(work, 'source.tar');
  await run(['git', 'archive', '--format=tar', `--output=${archive}`, revision, ...roots], root, env);
  await run(['tar', '-xf', archive, '-C', source], root, env);
  await rm(archive);
  // Refuse tracked dotenv/auth config too; disabling Expo dotenv alone is insufficient.
  for (const file of await inventory(source)) {
    if (file.path.split('/').some(part => /^\.env(?:\.|$)/.test(part) || part === '.npmrc'
      || part === '.netrc' || part === '.git-credentials')) {
      throw new Error(`Credential-bearing configuration is not a release input: ${file.path}`);
    }
  }
  const pkg = JSON.parse(await readFile(join(source, 'apps/vela/package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Expected a stable semantic app version');
  return { source, revision, version: pkg.version as string, env, node };
}

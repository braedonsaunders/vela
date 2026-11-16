// Licences and corresponding sources shipped beside the workers. The workers contain the MPL
// Mediabunny fork, so its exact source goes with them; Vela's adaptations and every Vela file
// compiled into a worker go too, so the adapted build can be reproduced and replaced.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { transformSources } from '../source-transform';

export const UPSTREAM_REVISION = 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2';
export const MEDIABUNNY_REVISION = 'e9303e8dbf1e77140328a417ac07306defc42cf6';

async function git(cwd: string, args: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'inherit' });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`git ${args[0]} failed in ${cwd}`);
  return output.trim();
}

/** The pinned checkouts must be exactly at their reviewed revisions and unmodified. */
export async function assertPinnedCheckouts(root: string) {
  const upstream = join(root, 'vendor/webgpu-player');
  const mediabunny = join(upstream, 'vendor/mediabunny');
  for (const [path, revision] of [
    [upstream, UPSTREAM_REVISION],
    [mediabunny, MEDIABUNNY_REVISION],
  ]) {
    if ((await git(path, ['rev-parse', 'HEAD'])) !== revision) throw new Error(`${path} is not at ${revision}`);
    if ((await git(path, ['status', '--porcelain', '--untracked-files=no'])) !== '') {
      throw new Error(`${path} has local changes`);
    }
  }
}

/** The Vela revision and whether the working tree differs from it. */
export async function sourceRevision(root: string): Promise<{ revision: string; dirty: boolean }> {
  const revision = await git(root, ['rev-parse', 'HEAD']);
  const dirty = (await git(root, ['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=none'])) !== '';
  return { revision, dirty };
}

async function copyInto(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

export async function writeSources(root: string, payload: string, velaSources: string[]) {
  const sources = join(payload, 'sources');
  const upstream = join(root, 'vendor/webgpu-player');
  const mediabunny = join(upstream, 'vendor/mediabunny');
  await mkdir(sources, { recursive: true });
  await git(mediabunny, [
    'archive',
    '--format=tar.gz',
    '--prefix=mediabunny/',
    `--output=${join(sources, 'mediabunny.tar.gz')}`,
    MEDIABUNNY_REVISION,
  ]);
  await copyInto(join(mediabunny, 'LICENSE'), join(sources, 'Mediabunny-LICENSE'));
  await copyInto(join(upstream, 'LICENSE'), join(sources, 'WebGPU-Player-LICENSE'));
  const vela = new Set([...velaSources, ...transformSources, 'modules/vela-player/web/source-transform.ts']);
  for (const path of vela) await copyInto(join(root, path), join(sources, 'vela', path));
  await copyInto(join(root, 'THIRD_PARTY_NOTICES'), join(payload, 'THIRD_PARTY_NOTICES'));
}

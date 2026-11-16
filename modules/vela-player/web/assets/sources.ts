// Licences and corresponding sources shipped beside the workers. The workers contain the MPL
// Mediabunny fork, so its source goes with them; Vela's adaptations and every Vela file compiled
// into a worker go too, so the adapted build can be reproduced and replaced.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { transformSources } from '../source-transform';
import { listFiles } from './inventory';
import { reproducibleTarGz } from './tar';

/** The pinned upstream packages, as bun.lock resolves them (modules/vela-player/package.json). */
export const UPSTREAM = { name: 'webgpu-player', repository: 'alchemyyy/WebGPU-Player', revision: 'a7a95ef' };
export const MEDIABUNNY = { name: 'mediabunny', repository: 'alchemyyy/mediabunny', revision: 'e9303e8' };

async function git(cwd: string, args: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'inherit' });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`git ${args[0]} failed in ${cwd}`);
  return output.trim();
}

/** bun.lock must resolve both packages to their reviewed commits; install with --frozen-lockfile. */
export async function assertPinnedPackages(root: string) {
  const lock = await readFile(join(root, 'bun.lock'), 'utf8');
  for (const pin of [UPSTREAM, MEDIABUNNY]) {
    const resolved = `"${pin.name}@github:${pin.repository}#${pin.revision}"`;
    if (!lock.includes(resolved)) throw new Error(`bun.lock does not pin ${pin.name} at ${pin.revision}`);
  }
}

/** The Vela revision and whether the working tree differs from it. */
export async function sourceRevision(root: string): Promise<{ revision: string; dirty: boolean }> {
  const revision = await git(root, ['rev-parse', 'HEAD']);
  const dirty = (await git(root, ['status', '--porcelain', '--untracked-files=no'])) !== '';
  return { revision, dirty };
}

async function copyInto(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

export async function writeSources(root: string, payload: string, velaSources: string[]) {
  const sources = join(payload, 'sources');
  const upstream = join(root, 'node_modules', UPSTREAM.name);
  const mediabunny = join(root, 'node_modules', MEDIABUNNY.name);
  await mkdir(sources, { recursive: true });
  // Mediabunny's compiled sources (src/, shared/) and its package and licence files.
  const compiled = [
    ...(await listFiles(mediabunny, 'src')),
    ...(await listFiles(mediabunny, 'shared')),
    'LICENSE',
    'package.json',
  ];
  const archive = await reproducibleTarGz(mediabunny, compiled, `mediabunny-${MEDIABUNNY.revision}`);
  await writeFile(join(sources, 'mediabunny.tar.gz'), archive);
  await copyInto(join(mediabunny, 'LICENSE'), join(sources, 'Mediabunny-LICENSE'));
  await copyInto(join(upstream, 'LICENSE'), join(sources, 'WebGPU-Player-LICENSE'));
  const vela = new Set([...velaSources, ...transformSources, 'modules/vela-player/web/source-transform.ts']);
  for (const path of vela) await copyInto(join(root, path), join(sources, 'vela', path));
  await copyInto(join(root, 'THIRD_PARTY_NOTICES'), join(payload, 'THIRD_PARTY_NOTICES'));
}

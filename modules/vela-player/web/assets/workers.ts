// The decoder workers, built from the pinned upstream player with Vela's adaptations. They are
// classic workers loaded by URL from libraries/webgpu-player/, so they are bundled here rather
// than by Metro. The adaptations are the same ones Metro applies to the page (source-transform.ts):
// host and workers must come from one build.
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { transformPlayerSource } from '../source-transform';

export const WORKER_DIRECTORY = 'webgpu-player';

interface BuiltWorkers {
  /** Repository-relative paths of every Vela source file compiled into a worker. */
  velaSources: string[];
}

export async function buildWorkers(root: string, libraries: string): Promise<BuiltWorkers> {
  const upstream = join(root, 'vendor/webgpu-player');
  const mediabunny = join(upstream, 'vendor/mediabunny/src/index.ts');
  const { getWorkerEntryPoints } = (await import(join(upstream, 'scripts/library-assets.mjs'))) as {
    getWorkerEntryPoints(): [string, string][];
  };
  const inputs = new Set<string>();
  const adapt: Bun.BunPlugin = {
    name: 'vela-player-source',
    setup(build) {
      build.onResolve({ filter: /^mediabunny$/ }, () => ({ path: mediabunny }));
      build.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
        inputs.add(path);
        const source = await readFile(path, 'utf8');
        return { contents: transformPlayerSource(path, source) ?? source, loader: 'ts' };
      });
    },
  };
  for (const [target, entry] of getWorkerEntryPoints()) {
    if (!target.startsWith(`${WORKER_DIRECTORY}/`)) throw new Error(`Unexpected worker target ${target}`);
    const result = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'iife',
      plugins: [adapt],
      throw: false,
    });
    if (!result.success || result.outputs.length !== 1) {
      throw new AggregateError(result.logs, `Worker build failed: ${target}`);
    }
    await Bun.write(join(libraries, target), result.outputs[0]);
  }
  const velaSources = [...inputs]
    .filter((path) => !path.startsWith(upstream))
    .map((path) => relative(root, path))
    .sort();
  return { velaSources };
}

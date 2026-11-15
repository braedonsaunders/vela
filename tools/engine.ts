/**
 * Single-engine source profiles. Exact compiles a component at every call site and has
 * no lazy plan loading, so a release ships one build per layout engine. prepareEngine
 * regenerates a STAGED client's skin registry (never a working tree) so its dispatch
 * holds only that engine, plus the default skin's slots it falls back to, and bakes the
 * engine id into foundation/engine.contract. Release packaging (tools/release) and skin
 * packages (tools/skin.ts) both call it; the registry generator is the same one dev
 * builds run. See docs/skin-authoring.md.
 *
 *   bun tools/engine.ts <staged-client-dir> <engine>     (for inspection)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateRegistry, installed } from './skin-registry';

/** Every installed skin package is an engine a release builds. */
export async function engines(client: string): Promise<string[]> {
  return (await installed(client)).map(f => f.skin.id);
}

export async function prepareEngine(client: string, engine: string): Promise<void> {
  await generateRegistry(client, engine);
  const marker = join(client, 'foundation/engine.contract');
  const engineSource = await readFile(marker, 'utf8');
  if (!engineSource.includes('fn buildEngine(): string = ""')) throw new Error('foundation/engine.contract has no empty buildEngine() to bake');
  await writeFile(marker, engineSource.replace('fn buildEngine(): string = ""', `fn buildEngine(): string = ${JSON.stringify(engine)}`));
}

/** Mount a staged client's routes under /vela, as Ether serves it. */
export async function mountRoutes(client: string): Promise<void> {
  const path = join(client, 'app.contract');
  let count = 0;
  const routed = (await readFile(path, 'utf8')).replace(/^(\s+\w+ )"(\/[^"\n]*)"\s*$/gm, (_line, prefix, route) => {
    // Route declarations are the only bare indented identifier + quoted path lines.
    count++; return `${prefix}"${route === '/' ? '/vela' : '/vela' + route}"`;
  });
  if (!count) throw new Error('No route declarations found to mount under /vela/');
  // Exact permits a non-root first route only with an explicit unmatched-location fallback.
  await writeFile(path, routed.replace(/^(routes \w+\n)([\s\S]*?)(?=^\S)/m, (block, header, declarations) =>
    /^  notfound(?:\s|$)/m.test(declarations) ? block : `${header}${declarations.trimEnd()}\n  notfound\n\n`));
}

if (import.meta.main) {
  const [client, engine] = process.argv.slice(2);
  if (!client || !engine) throw new Error('Usage: bun tools/engine.ts <staged-client-dir> <engine>');
  await prepareEngine(client, engine);
}

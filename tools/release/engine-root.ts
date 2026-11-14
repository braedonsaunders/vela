import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { externalizeAssets } from './assets';

/** Finalize a staged Exact web build; its routes remain /vela/... . */
export async function finalizeEngineRoot(dist: string, engineId: string, version: string): Promise<string> {
  if (!/^[a-z][a-z0-9-]*$/.test(engineId) || !/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error('Invalid engine address');
  const base = `/vela/engines/${engineId}/${version}/`;
  await externalizeAssets(dist, base);
  for (const name of ['index.html', 'shell.html']) {
    let html: string;
    try { html = await readFile(join(dist, name), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    html = html.replace(/<base href="[^"]*">/, `<base href="${base}">`);
    html = html.replace(/<link rel="manifest"[^>]*>/, '<link rel="manifest" href="/vela/manifest.json">');
    await writeFile(join(dist, name), html);
  }
  async function relocate(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await relocate(path);
      else if (/\.(js|css|html|json)$/.test(entry.name)) {
        const text = await readFile(path, 'utf8');
        const relocated = text.replaceAll('/vela/assets/', `${base}assets/`);
        if (text !== relocated) await writeFile(path, relocated);
      }
    }
  }
  await relocate(dist);
  return base;
}

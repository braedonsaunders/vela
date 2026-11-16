// Prints routes.json: the app's client routes under the web base, from expo-router's app/
// directory, so Ether serves index.html for these and 404 for anything else that is not a file.
// `index` is the directory's own path, `[name]` a parameter (`:name`), `(group)` adds nothing,
// and `_layout`/`+` files are not routes. Run: bun apps/vela/scripts/routes.ts [base]
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const base = process.argv[2] ?? '/vela';
const app = join(import.meta.dir, '../app');

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const routes = (await files(app))
  .map(file => relative(app, file).replace(/\.tsx?$/, '').split('/'))
  .filter(parts => !parts.some(p => p.startsWith('_') || p.startsWith('+')))
  .map(parts => parts.filter(p => p !== 'index' && !/^\(.*\)$/.test(p)).map(p => p.replace(/^\[(\w+)\]$/, ':$1')))
  .map(parts => [base, ...parts].join('/').replace(/\/+$/, '') || '/')
  .sort();

console.log(JSON.stringify({ schema: 1, base, routes: [...new Set(routes)] }, null, 2));

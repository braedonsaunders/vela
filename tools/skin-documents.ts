/**
 * The built-in skin documents a release ships (docs/distribution.md, "Built-in skin documents"):
 * every protocol/v0/fixtures/skins/<id>/document.ts (default export) and the legacy cinematic
 * fixture, written as static files the client loads from its own origin:
 *
 *   <out>/catalog.json                          { schema: 1, documents: [ref…] }
 *   <out>/<id>/<version>/document.json          the document, asset URLs rebased to /vela/skins/
 *   <out>/<id>/<version>/<file>                 its assets (fixtures/skins/<id>/assets/*)
 *
 * The release serves <out> at /vela/skins/. Run: bun tools/skin.ts documents <out>
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { SkinDocument } from '../protocol/v0/skin';

const root = resolve(import.meta.dir, '..');
const fixtures = join(root, 'protocol/v0/fixtures/skins');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export async function writeDocuments(out: string): Promise<{ id: string; version: string; renderer: number }[]> {
  const found: { doc: SkinDocument; assets?: string }[] = [];
  if (existsSync(join(fixtures, 'cinematic.ts'))) found.push({ doc: (await import(join(fixtures, 'cinematic.ts'))).cinematicDoc as SkinDocument });
  for (const entry of (await readdir(fixtures, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(fixtures, entry.name, 'document.ts');
    if (existsSync(file)) found.push({ doc: (await import(file)).default as SkinDocument, assets: join(fixtures, entry.name, 'assets') });
  }
  const refs = [];
  const sharedAssets = new Map<string, string>();
  await mkdir(out, { recursive: true });
  for (const { doc: source, assets } of found) {
    // A conversion of a compiled skin ships beside it as its "(data)" variant until the compiled one is deleted.
    const collides = existsSync(join(root, 'client/skins', source.id));
    const doc = collides ? { ...source, id: `${source.id}-data`, name: `${source.name} (data)` } : source;
    const from = `/vela/v0/appearance/skins/${source.id}/${source.version}/`;
    if (doc.schema !== 1 || !/^[a-z][a-z0-9-]{0,31}$/.test(doc.id) || !/^[0-9A-Za-z.+-]+$/.test(doc.version)) throw new Error(`Skin document ${doc.id}: bad id, version or schema`);
    const dir = join(out, doc.id, doc.version);
    await mkdir(dir, { recursive: true });
    if (assets && existsSync(assets)) await cp(assets, dir, { recursive: true });
    // The legacy cinematic fixture has no assets folder: its preview is the client's.
    else if (source.id === 'cinematic-doc') await cp(join(root, 'client/assets/skins/cinematic.jpg'), join(dir, 'preview.jpg'));
    if (assets) {
      const licences = join(assets, '..', 'licences');
      if (existsSync(licences)) await cp(licences, join(dir, 'licences'), { recursive: true });
    }
    // Assets the mock serves under the appearance tree are static files beside the document here.
    let text = JSON.stringify(doc).replaceAll(from, `/vela/skins/${doc.id}/${doc.version}/`);
    // App assets are renamed independently in each compiled engine. Documents
    // use their own shared immutable copies, so they work in every engine base.
    for (const [literal] of [...text.matchAll(/"assets\/[a-z0-9/._-]+"/g)]) {
      const source = JSON.parse(literal) as string;
      let url = sharedAssets.get(source);
      if (!url) {
        const file = resolve(root, 'client', source);
        if (!file.startsWith(join(root, 'client/assets') + '/')) throw new Error(`App asset escapes assets: ${source}`);
        const bytes = await readFile(file);
        const name = createHash('sha256').update(bytes).digest('hex') + extname(file);
        await mkdir(join(out, 'assets'), { recursive: true });
        await writeFile(join(out, 'assets', name), bytes);
        url = `/vela/skins/assets/${name}`;
        sharedAssets.set(source, url);
      }
      text = text.replaceAll(literal, JSON.stringify(url));
    }
    const packaged = JSON.parse(text) as SkinDocument;
    if (packaged.preview?.startsWith('/vela/skins/') && !existsSync(join(out, packaged.preview.slice('/vela/skins/'.length)))) {
      console.warn(`Omitting missing built-in preview for ${doc.id}`);
      delete packaged.preview;
      text = JSON.stringify(packaged);
    }
    await writeFile(join(dir, 'document.json'), text);
    refs.push({ id: doc.id, name: doc.name, version: doc.version, tagline: doc.tagline, renderer: doc.renderer, url: `/vela/skins/${doc.id}/${doc.version}/document.json`,
      preview: packaged.preview, swatches: doc.swatches, sha256: sha(text) });
  }
  await writeFile(join(out, 'catalog.json'), JSON.stringify({ schema: 1, documents: refs }, null, 2) + '\n');
  return refs.map(r => ({ id: r.id, version: r.version, renderer: r.renderer }));
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: bun tools/skin-documents.ts <out>');
  console.log(JSON.stringify(await writeDocuments(resolve(out)), null, 2));
}

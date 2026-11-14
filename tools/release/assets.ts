import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const extensions: Record<string, string> = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff': 'woff', 'font/woff2': 'woff2' };
const assetExtension = /\.(?:svg|png|jpe?g|webp|avif|gif|ttf|otf|woff2?)$/i;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function files(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) result.push(...await files(path));
    else if (e.isFile()) result.push(path);
  }
  return result;
}

/** Keep ESM module URLs canonical; only asset values receive content addresses. */
export async function externalizeAssets(dist: string, base = '/vela/') {
  const replacements = new Map<string, string>();
  const assets: { source: string; path: string; bytes: number }[] = [];
  const assetRoot = join(dist, 'assets');
  await mkdir(assetRoot, { recursive: true });
  for (const path of await files(assetRoot)) {
    if (!assetExtension.test(path)) continue;
    const bytes = await readFile(path), original = relative(dist, path).split('\\').join('/');
    const ext = path.slice(path.lastIndexOf('.'));
    const target = `${path.slice(0, -ext.length)}-${hash(bytes).slice(0, 20)}${ext}`;
    await rename(path, target);
    const url = relative(dist, target).split('\\').join('/');
    replacements.set(original, url);
    assets.push({ source: original, path: url, bytes: bytes.length });
  }
  let inlineOccurrences = 0, inlineSourceBytes = 0;
  const extracted = new Map<string, Uint8Array>();
  for (const path of await files(dist)) {
    if (path.startsWith(assetRoot + '/') || !/\.(?:js|css|html|json)$/.test(path)) continue;
    const before = await readFile(path, 'utf8');
    let text = before;
    for (const [from, to] of replacements) text = text.split(from).join(to);
    // Only complete static literals: never evaluate JS/template expressions or
    // change dynamically constructed symbols and masks owned by Exact.
    text = text.replace(/([`"'])data:((?:image|font)\/[a-zA-Z0-9.+-]+)(;base64)?,((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g,
      (literal, quote: string, mime: string, base64: string | undefined, payload: string) => {
        const ext = extensions[mime];
        if (!ext || payload.includes('${') || payload.includes('\\')) return literal;
        let bytes: Uint8Array;
        try {
          if (base64) {
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) return literal;
            bytes = Buffer.from(payload, 'base64');
          } else bytes = new TextEncoder().encode(decodeURIComponent(payload));
        } catch { return literal; }
        const name = `inline-${hash(bytes).slice(0, 20)}.${ext}`;
        extracted.set(name, bytes); inlineOccurrences++; inlineSourceBytes += Buffer.byteLength(literal);
        return `${quote}${base}assets/${name}${quote}`;
      });
    if (text !== before) await writeFile(path, text);
  }
  for (const [name, bytes] of extracted) await writeFile(join(assetRoot, name), bytes);
  return { assets, inlineOccurrences, inlineSourceBytes, extractedAssets: extracted.size };
}

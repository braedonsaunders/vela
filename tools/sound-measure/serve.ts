// Serve the web harness (page.ts, bundled here) and the signals, and keep each case's capture.
// Usage: bun tools/sound-measure/serve.ts <signals dir> <captures dir> [port]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [signals, captures, portArg] = process.argv.slice(2);
if (!signals || !captures) { console.error('usage: bun tools/sound-measure/serve.ts <signals dir> <captures dir> [port]'); process.exit(2); }
mkdirSync(captures, { recursive: true });
// mediabunny is bundled from its TypeScript source, which declares fields with `!` (`override track!:
// InputAudioTrack`). Bun emits those as fields that reset what the base class set; Metro does not. They
// carry types only, so they are dropped as the source loads.
const definite: import('bun').BunPlugin = {
  name: 'drop-definite-fields',
  setup(build) {
    build.onLoad({ filter: /mediabunny[\\/].*\.ts$/ }, async ({ path }) => ({
      loader: 'ts',
      contents: (await Bun.file(path).text()).replace(/^[ \t]*(?:(?:public|private|protected|readonly|override|declare)[ \t]+)*[\w$]+![ \t]*:[^=;\n]+;[ \t]*$/gm, ''),
    }));
  },
};
const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'page.ts')], target: 'browser', format: 'esm', minify: false, plugins: [definite] });
if (!built.success) { console.error(built.logs); process.exit(1); }
const script = await built.outputs[0]!.text();
const page = `<!doctype html><meta charset="utf-8"><title>Vela sound measurement</title><button id="go">Run</button><pre id="log"></pre><script type="module">${script.replace(/<\/script/g, '<\\/script')}</script>`;
const server = Bun.serve({
  port: Number(portArg ?? 0),
  idleTimeout: 120,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response(page, { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname.startsWith('/signals/')) {
      const file = Bun.file(join(signals, url.pathname.slice('/signals/'.length)));
      if (!await file.exists()) return new Response('missing', { status: 404 });
      // Ranges, as the player reads them.
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers.get('range') ?? '');
      if (range) {
        const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
        return new Response(file.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/flac' } });
      }
      return new Response(file, { headers: { 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/flac' } });
    }
    if (request.method === 'POST' && url.pathname.startsWith('/capture/')) {
      writeFileSync(join(captures, `${url.pathname.slice(9)}.f32`), Buffer.from(await request.arrayBuffer()));
      return new Response('ok');
    }
    if (request.method === 'POST' && url.pathname.startsWith('/meta/')) {
      writeFileSync(join(captures, `${url.pathname.slice(6)}.json`), await request.text());
      return new Response('ok');
    }
    if (request.method === 'POST' && url.pathname === '/log') { console.log(await request.text()); return new Response('ok'); }
    if (request.method === 'POST' && url.pathname === '/done') { writeFileSync(join(captures, 'DONE'), new Date().toISOString()); return new Response('ok'); }
    return new Response('not found', { status: 404 });
  },
});
console.log(`sound harness on http://localhost:${server.port}/`);

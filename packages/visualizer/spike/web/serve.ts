// bun packages/visualizer/tools/build.ts --scenes ink,tunnel --out <scratch-dir>
// bun packages/visualizer/spike/web/serve.ts <scratch-dir>/viz-native.js <local-music-file.mp3> [port]
// Open the printed loopback URL in muted Chrome with --autoplay-policy=no-user-gesture-required.
// Append ?scene=tunnel or ?scene=ink. Each measurement stops playback after 20 seconds.
import path from 'node:path';

const [bundlePath, musicPath] = Bun.argv.slice(2);
if (!bundlePath || !musicPath || !await Bun.file(bundlePath).exists() || !await Bun.file(musicPath).exists()) {
  throw new Error('Expected paths to the built visualizer bundle and a local music file');
}
const build = await Bun.build({
  entrypoints: [path.join(import.meta.dir, 'music.ts')],
  target: 'browser',
  plugins: [{
    name: 'workspace-mediabunny-source',
    setup(builder) {
      // Match Metro field semantics for Mediabunny, as in tools/sound-measure/serve.ts.
      builder.onLoad({ filter: /mediabunny[\\/].*\.ts$/ }, async ({ path }) => ({
        loader: 'ts',
        contents: (await Bun.file(path).text()).replace(/^[ \t]*(?:(?:public|private|protected|readonly|override|declare)[ \t]+)*[\w$]+![ \t]*:[^=;\n]+;[ \t]*$/gm, ''),
      }));
      builder.onResolve({ filter: /^mediabunny$/ }, () => ({
        path: path.resolve(import.meta.dir, '../../../../node_modules/mediabunny/src/index.ts'),
      }));
    },
  }],
});
if (!build.success) throw new AggregateError(build.logs, 'Web measurement bundle failed');
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(Bun.argv[4] ?? 0),
  routes: {
    '/': () => new Response(Bun.file(path.join(import.meta.dir, 'music.html'))),
    '/dist/music.js': () => new Response(build.outputs[0], { headers: { 'Content-Type': 'application/javascript' } }),
    '/dist/viz-native.js': () => new Response(Bun.file(bundlePath)),
    '/dist/track.mp3': () => new Response(Bun.file(musicPath)),
  },
  fetch: () => new Response('Not found', { status: 404 }),
});
console.log(server.url.href);

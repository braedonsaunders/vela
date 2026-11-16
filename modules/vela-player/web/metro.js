// Metro settings the web player needs, applied by apps/vela/metro.config.js.
//
// Metro bundles the player core (client/player) and the modules of the pinned upstream player
// (`webgpu-player`) and its Mediabunny fork that the core imports, from their TypeScript sources.
// The decoder workers, WASM and subtitle assets are not Metro's: they are the payload that
// assets/export-assets.ts writes to player/<digest>/, which the dev server serves from
// VELA_PLAYER_ASSETS_DIR so `expo start --web` plays like the export.
const { createReadStream, statSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
/** Mediabunny's package entry is its unbuilt dist; Vela compiles the pinned sources. */
const mediabunny = path.join(root, 'node_modules/mediabunny/src/index.ts');

const contentTypes = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serves player/<digest>/… from the asset builder's output, the way the export tree does. */
function assetMiddleware(directory) {
  const base = path.resolve(directory);
  return (request, response, next) => {
    const pathname = decodeURIComponent((request.url ?? '').split('?')[0]);
    const match = /^(?:\/vela)?(\/player\/[a-f0-9]{64}\/[^\0]+)$/.exec(pathname);
    if (!match) return next();
    const file = path.join(base, match[1]);
    if (!file.startsWith(base + path.sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      response.statusCode = 404;
      return response.end();
    }
    response.setHeader('Content-Type', contentTypes[path.extname(file)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    createReadStream(file).pipe(response);
  };
}

/** Adds the player's resolution, source adaptations and dev asset serving to an Expo Metro config. */
function withVelaPlayer(config) {
  const resolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'mediabunny') return { type: 'sourceFile', filePath: mediabunny };
    return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
  };

  // The transformer runs in worker processes, which inherit the environment.
  process.env.VELA_PLAYER_NEXT_TRANSFORMER = config.transformer.babelTransformerPath;
  config.transformer.babelTransformerPath = require.resolve('./metro-transformer.js');

  const assets = process.env.VELA_PLAYER_ASSETS_DIR;
  if (assets) {
    const enhance = config.server.enhanceMiddleware;
    config.server.enhanceMiddleware = (middleware, server) => {
      const inner = enhance ? enhance(middleware, server) : middleware;
      const serve = assetMiddleware(assets);
      return (request, response, next) => serve(request, response, () => inner(request, response, next));
    };
  }
  return config;
}

module.exports = { withVelaPlayer };

// Metro's Babel transformer for the web player. Files of the pinned upstream player and its
// Mediabunny fork get Vela's adaptations (source-transform.ts), then lose their TypeScript here:
// they use `declare` class fields, which the app's Babel preset refuses. Every other file passes
// through untouched. Metro runs this in Node workers, which load the TypeScript transform modules
// directly (Node 23.6+ strips types).
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../../..');
const upstream = path.join(root, 'vendor/webgpu-player') + path.sep;
const next = require(process.env.VELA_PLAYER_NEXT_TRANSFORMER);
const { transformPlayerSource, transformSources } = require('./source-transform.ts');

const typescript = [require.resolve('@babel/plugin-transform-typescript'), { allowDeclareFields: true }];

/** The upstream file's JavaScript: Vela's adaptations applied, types removed, lines kept. */
function upstreamSource(filename, src) {
  const adapted = transformPlayerSource(filename, src) ?? src;
  if (!filename.endsWith('.ts')) return adapted;
  const result = babel.transformSync(adapted, {
    filename,
    babelrc: false,
    configFile: false,
    retainLines: true,
    plugins: [typescript],
  });
  return result.code;
}

module.exports.transform = function transform(args) {
  const filename = path.resolve(args.options.projectRoot, args.filename);
  if (!filename.startsWith(upstream)) return next.transform(args);
  return next.transform({ ...args, src: upstreamSource(filename, args.src) });
};

/** A change to any adaptation, or to the next transformer's key, invalidates Metro's cache. */
module.exports.getCacheKey = function getCacheKey(options) {
  const hash = createHash('sha256');
  for (const file of [__filename, ...transformSources.map((name) => path.join(root, name))]) {
    hash.update(readFileSync(file));
  }
  hash.update(next.getCacheKey ? String(next.getCacheKey(options)) : '');
  return hash.digest('hex');
};

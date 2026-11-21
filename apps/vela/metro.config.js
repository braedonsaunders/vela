// Metro sees the whole workspace: apps/vela imports packages/* and modules/*. Build output,
// vendor checkouts and legacy paths are blocked from the graph.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withVelaPlayer } = require('../../modules/vela-player/web/metro');

const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
const ignored = ['client/target', 'client/.exact', 'client/modules', 'client/node_modules', '.artifacts', 'vendor', 'mock-server/node_modules', '.worktrees']
  .map(dir => new RegExp(`^${path.join(root, dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/.*)?$`));

config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')];
config.resolver.blockList = ignored;
config.resolver.assetExts = config.resolver.assetExts.filter(ext => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];
config.transformer.babelTransformerPath = require.resolve('./svg-transformer.js');
// foliate-js's own PDF module is replaced by Vela's adapter (see src/media/foliate-pdf-stub.js).
const foliate = path.join(root, 'node_modules', 'foliate-js') + path.sep;
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === './pdf.js' && context.originModulePath.startsWith(foliate))
    return { type: 'sourceFile', filePath: path.join(__dirname, 'src', 'media', 'foliate-pdf-stub.js') };
  return resolveRequest ? resolveRequest(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};
module.exports = withVelaPlayer(config);

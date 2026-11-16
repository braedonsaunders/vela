// Metro sees the whole workspace: apps/vela imports packages/* and, until the conversion
// moves them, client/src and protocol/ by path. Exact's build output and the old app's
// bundles are not part of this graph.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
const ignored = ['client/target', 'client/.exact', 'client/modules', 'client/node_modules', '.artifacts', 'vendor', 'mock-server/node_modules', '.worktrees']
  .map(dir => new RegExp(`^${path.join(root, dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/.*)?$`));

config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules'), path.join(root, 'node_modules')];
config.resolver.blockList = ignored;
module.exports = config;

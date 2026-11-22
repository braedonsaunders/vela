// Build one architecture at a time; all generated files live in the requested scratch output.
import { cpSync, mkdirSync, readdirSync, existsSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const arch = arg('arch') || process.arch;
const out = arg('out');
if (!out || arch !== 'arm64') throw new Error('Usage: node mac/build.mjs --arch=arm64 --out=<scratch>/native-mac');
const output = resolve(out), stage = output + '-build';
const run = (cmd, args, cwd = stage) => {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' } });
  if (result.status !== 0) throw new Error(`${cmd} failed (${result.status})`);
};
mkdirSync(join(stage, 'Sources/VelaNative'), { recursive: true });
mkdirSync(output, { recursive: true });
const ios = resolve(here, '../../../modules/vela-player/ios');
for (const name of ['PlaybackClient', 'PlaybackSession', 'PlaybackHost', 'PlaybackRendering', 'PreviewPlayback', 'PlayerState', 'PlayerReport', 'PlayerCapabilities', 'PlaybackPreferences', 'PlaybackFormat', 'PlaybackPlan', 'PathRecovery', 'MediaAccess', 'MediaRedirects', 'ScopedMediaHTTP', 'ScopedAetherReader'])
  cpSync(join(ios, name + '.swift'), join(stage, 'Sources/VelaNative', name + '.swift'));
for (const name of ['AppKitPlaybackRendering.swift', 'NativeHost.swift']) cpSync(join(here, name), join(stage, 'Sources/VelaNative', name));
// AetherEngine's optional components, the same traits as the tvOS and iOS apps (apps/vela/plugins/apple-player.js).
const traits = require('../../vela/plugins/apple-player.js').AETHER_TRAITS.map(trait => `"${trait}"`).join(', ');
writeFileSync(join(stage, 'Package.swift'), `// swift-tools-version: 6.1
import PackageDescription
let package = Package(name: "VelaNative", platforms: [.macOS("15.0")], products: [.library(name: "VelaNative", type: .dynamic, targets: ["VelaNative"])], dependencies: [.package(url: "https://github.com/superuser404notfound/AetherEngine", exact: "7.70.0", traits: [${traits}]), .package(url: "https://github.com/superuser404notfound/LibTrueHD", exact: "3.2.0")], targets: [.target(name: "VelaNative", dependencies: [.product(name: "AetherEngine", package: "AetherEngine")], linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("IOKit")])], swiftLanguageModes: [.v5])
`);
if (process.argv.includes('--prepare-only')) process.exit(0);
cpSync(join(here, 'Package.resolved'), join(stage, 'Package.resolved'));
const swiftArch = 'arm64';
run('swift', ['build', '-c', 'release', '--arch', swiftArch, '-j', '1']);
const location = spawnSync('swift', ['build', '-c', 'release', '--arch', swiftArch, '--show-bin-path'], { cwd: stage, encoding: 'utf8', env: { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' } });
if (location.status !== 0) throw new Error('Cannot locate SwiftPM products');
const bin = location.stdout.trim();
const symbols = spawnSync('nm', ['-gU', join(bin, 'libVelaNative.dylib')], { encoding: 'utf8' });
for (const symbol of ['vela_create', 'vela_call', 'vela_destroy', 'vela_capabilities'])
  if (!symbols.stdout.includes('_' + symbol)) throw new Error(`Missing exported Swift C ABI: ${symbol}`);
cpSync(join(bin, 'libVelaNative.dylib'), join(output, 'libVelaNative.dylib'));
// Release must resolve Swift from the OS, never from this Mac's Xcode install.
const nativeLibrary = join(output, 'libVelaNative.dylib');
const loadCommands = spawnSync('otool', ['-l', nativeLibrary], { encoding: 'utf8' });
if (loadCommands.status !== 0) throw new Error('Cannot inspect native runtime paths');
for (const match of loadCommands.stdout.matchAll(/cmd LC_RPATH\n\s*cmdsize \d+\n\s*path (.*?) \(offset/g)) {
  const runtimePath = match[1];
  if (runtimePath.startsWith('/') && runtimePath.includes('.xctoolchain/'))
    run('xcrun', ['install_name_tool', '-delete_rpath', runtimePath, nativeLibrary]);
}
run('codesign', ['--force', '--sign', '-', nativeLibrary]);
// Dynamic dependency bundles must stay adjacent and replaceable (LGPL).
for (const name of readdirSync(bin)) if (name.endsWith('.framework') || name.endsWith('.bundle')) {
  rmSync(join(output, name), { recursive: true, force: true });
  cpSync(realpathSync(join(bin, name)), join(output, name), { recursive: true, dereference: false, verbatimSymlinks: true });
}
const headers = arg('node-headers') || join(process.env.HOME, '.electron-gyp/40.8.0/include/node');
if (!existsSync(join(headers, 'node_api.h'))) throw new Error('Pass --node-headers=<Electron include/node directory>');
run('xcrun', ['clang++', '-arch', swiftArch, '-mmacosx-version-min=15.0', '-std=c++17', '-shared', '-undefined', 'dynamic_lookup', '-I', headers, join(here, 'addon.mm'), '-L', output, '-lVelaNative', '-Wl,-rpath,@loader_path', '-o', join(output, 'vela-native.node')]);
cpSync(join(ios, 'Licenses'), join(output, 'Licenses'), { recursive: true });

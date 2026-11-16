// Builds the web player's static payload into <out>/player/<digest>/ with PLAYER-ASSETS-MANIFEST.json
// (docs/distribution.md, "Player assets and skins"). Metro bundles the player's JavaScript; this
// payload is everything the page loads by URL: decoder workers, WASM packages, subtitle renderer,
// licences and corresponding sources.
//
//   bun modules/vela-player/web/assets/export-assets.ts --libraries=<prepared libraries> --out=<dir>
//
// --libraries is a prepared static libraries tree (see libraries.ts). The digest is printed on the
// last line; export the app with EXPO_PUBLIC_VELA_PLAYER_ASSETS=<digest> and place <dir>/player/ at
// the export root. A dirty Vela tree is refused unless --allow-dirty (recorded as sourceDirty:true).
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inventory, MANIFEST_NAME, payloadDigest } from './inventory';
import { copyLibraries, payloadCapabilities } from './libraries';
import { assertPinnedCheckouts, MEDIABUNNY_REVISION, sourceRevision, UPSTREAM_REVISION, writeSources } from './sources';
import { buildWorkers } from './workers';
import { audioPackageRelease } from '../../../../client/player/universal/audio/packages';
import decoderPins from '../../../../vendor/webgpu-player/tools/pinned-releases.json';
import subtitleManifest from '../../../../client/player/universal/subtitles/assets.json';

const root = resolve(import.meta.dir, '../../../..');

function option(name: string): string | undefined {
  return Bun.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const librariesInput = option('libraries');
const out = option('out');
if (!librariesInput || !out) {
  throw new Error('Usage: export-assets.ts --libraries=<prepared libraries> --out=<dir> [--allow-dirty]');
}

const source = await sourceRevision(root);
if (source.dirty && !Bun.argv.includes('--allow-dirty')) {
  throw new Error('The Vela tree has uncommitted changes; commit them or pass --allow-dirty');
}
await assertPinnedCheckouts(root);

const players = join(resolve(out), 'player');
const staging = join(players, `.staging-${process.pid}`);
await rm(staging, { recursive: true, force: true });
const libraries = join(staging, 'libraries');
await mkdir(libraries, { recursive: true });

const copied = await copyLibraries(resolve(librariesInput), libraries);
const workers = await buildWorkers(root, libraries);
await writeSources(root, staging, workers.velaSources);
await writeFile(join(staging, 'capabilities.json'), `${JSON.stringify(payloadCapabilities(copied), null, 2)}\n`);

const files = await inventory(staging);
const digest = payloadDigest(files);
const prebuilt = new Set(copied.prebuilt.map((path) => `libraries/${path}`));
const manifest = {
  schemaVersion: 1,
  digest,
  sourceRevision: source.revision,
  sourceDirty: source.dirty,
  dependencies: [
    { name: 'webgpu-player', revision: UPSTREAM_REVISION, licence: 'MIT', use: 'decoder workers, adapted' },
    { name: 'mediabunny', revision: MEDIABUNNY_REVISION, licence: 'MPL-2.0', source: 'sources/mediabunny.tar.gz' },
    {
      name: 'webgpu-player-decoders',
      release: decoderPins.decoders.tag,
      url: audioPackageRelease,
      licence: 'LGPL-2.1',
    },
    {
      name: 'jassub',
      version: subtitleManifest.jassub.version,
      revision: subtitleManifest.jassub.revision,
      licence: 'MIT',
      source: 'libraries/subtitles/',
    },
    {
      name: 'prebuilt',
      use: 'static libraries without a Vela pin, accepted by hash from the prepared input',
      files: files.filter((file) => prebuilt.has(file.path)).map((file) => file.path),
    },
  ],
  files,
};

const target = join(players, digest);
if (await stat(target).catch(() => null)) {
  // Same digest, same bytes: the existing tree is this payload. Keep it untouched.
  await rm(staging, { recursive: true, force: true });
} else {
  await writeFile(join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(staging, target);
}
console.log(`Player assets: ${files.length} files in ${target}`);
console.log(digest);

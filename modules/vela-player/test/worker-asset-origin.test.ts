import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { transformUpstreamTransport } from '../web/engine/universal/transport-transform';

test('worker accepts desktop assets only from the Vela app origin', () => {
  const path = require.resolve('webgpu-player/src/pipeline/DecodeWorkerProtocol.ts');
  const source = transformUpstreamTransport(path, readFileSync(path, 'utf8'))!;
  const start = source.indexOf('function isCodecAssetURL(');
  const end = source.indexOf('\ntype RawVideoFormatValidation', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end));
  const accepts = new Function(`const MAXIMUM_CODEC_ASSET_URL_LENGTH = 8192; ${js}; return isCodecAssetURL;`)() as (url: string) => boolean;
  expect(accepts('vela-app://app/vela/player/libraries/asset.wasm')).toBe(true);
  expect(accepts('vela-app://other/vela/asset.wasm')).toBe(false);
  expect(accepts('vela-app://app/other/asset.wasm')).toBe(false);
  expect(accepts('https://example.com/asset.wasm')).toBe(true);
  expect(accepts('file:///tmp/asset.wasm')).toBe(false);
});

// Run the authoring texture factories at build time. Capture both the texels and
// the upload/sampler calls, so native hosts need neither a GIS rasterizer nor
// per-candidate assumptions about filtering, wrapping or the number of channels.
import { packTexture, unpackTexture } from './texture-bytes';

const { GLC } = require('../runtime/glrec.js');

export function bakeCountryMap(sceneSource: string): string {
  const names = ['worldMapTexture', 'hydroTexture'].filter(name => sceneSource.includes('function ' + name + '('));
  if (!names.length) return sceneSource;

  // Scene parts are standalone blocks. Take references to their local factories
  // without initializing the scene, compiling a shader, or changing its source.
  const blockEnd = sceneSource.lastIndexOf('}');
  const capture = sceneSource.slice(0, blockEnd) + 'return [' + names.join(',') + '];}';
  const statements: string[] = [];
  let uploaded = false;
  const gl = {
    ...GLC,
    createTexture() { return 't'; },
    bindTexture(target: number, texture: string) {
      if (texture !== 't') throw new Error('Unexpected cartography texture binding');
      statements.push('gl.bindTexture(' + target + ', t);');
    },
    texImage2D(target: number, level: number, format: number, width: number, height: number,
      border: number, channels: number, type: number, data: Uint8Array) {
      const n = channels === GLC.RED ? 1 : channels === GLC.RG ? 2 : channels === GLC.RGBA ? 4 : 0;
      if (uploaded || !n || type !== GLC.UNSIGNED_BYTE || data.length !== width * height * n) {
        throw new Error('Expected a single byte-per-channel cartography texture');
      }
      uploaded = true;
      const args = [target, level, format, width, height, border, channels, type].join(', ');
      statements.push('const bytes = (' + unpackTexture.toString() + ')(' +
        JSON.stringify(packTexture(data)) + ', ' + data.length + ');');
      statements.push('gl.texImage2D(' + args + ', bytes);');
    },
    texParameteri(target: number, param: number, value: number) {
      statements.push('gl.texParameteri(' + [target, param, value].join(', ') + ');');
    },
  };
  const factories: Function[] = new Function('gl', 'VS', 'FSH', 'scene', capture)(gl, '', '', () => {});
  let nativeSource = sceneSource;
  for (const factory of factories) {
    statements.length = 0;
    uploaded = false;
    factory();
    const original = factory.toString();
    if (!uploaded || !nativeSource.includes(original)) throw new Error('Unable to bake ' + factory.name);
    const replacement = 'function ' + factory.name + '() {\n  const t = gl.createTexture();\n  ' +
      statements.join('\n  ') + '\n  return t;\n}';
    nativeSource = nativeSource.replace(original, () => replacement);
  }
  // The baked factories no longer read the authoring base64 blobs. Keep any
  // blob still used by other scene code (and keep the ordinary city table).
  return nativeSource.replace(/const (\w+)\s*=\s*"[A-Za-z0-9+/=]{100,}";/g, (declaration, name: string) => {
    const rest = nativeSource.replace(declaration, '');
    return new RegExp('\\b' + name + '\\b').test(rest) ? declaration : '';
  });
}

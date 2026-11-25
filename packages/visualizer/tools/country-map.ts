// Run the authoring texture factories at build time. Capture both the texels and
// the upload/sampler calls, so native hosts need neither a GIS rasterizer nor
// per-candidate assumptions about filtering, wrapping or the number of channels.
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
      const n = channels === GLC.RED ? 1 : channels === GLC.RG ? 2 : 0;
      if (uploaded || !n || type !== GLC.UNSIGNED_BYTE || data.length !== width * height * n) {
        throw new Error('Expected a single R8 or RG8 cartography texture');
      }
      uploaded = true;
      const args = [target, level, format, width, height, border, channels, type].join(', ');
      statements.push('const bytes = (' + decodeCountryRuns.toString() + ')(' +
        JSON.stringify(encodeCountryRuns(data)) + ', ' + data.length + ');');
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
  return nativeSource;
}

export function encodeCountryRuns(pixels: Uint8Array): string {
  const records = [];
  for (let i = 0; i < pixels.length;) {
    const first = i++;
    while (i < pixels.length && pixels[i] === pixels[first] && i - first < 65535) i++;
    records.push((i - first).toString(16).padStart(4, '0'), pixels[first].toString(16).padStart(2, '0'));
  }
  return records.join('');
}

export function decodeCountryRuns(runs: string, size: number) {
  const pixels = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < runs.length; i += 6) {
    const count = parseInt(runs.slice(i, i + 4), 16);
    const id = parseInt(runs.slice(i + 4, i + 6), 16);
    pixels.fill(id, offset, offset + count);
    offset += count;
  }
  if (offset !== size) throw new Error('Invalid country map size');
  return pixels;
}

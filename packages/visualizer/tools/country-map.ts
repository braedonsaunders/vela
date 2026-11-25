// Precompute the candidate's integer raster using the very same scan converter as the
// browser. Keep its GL upload and its sampling parameters verbatim in the native bundle.
export function bakeCountryMap(sceneSource: string): string {
  const factory = sceneSource.indexOf('function worldMapTexture()');
  if (factory < 0) return sceneSource;
  const raster = sceneSource.indexOf('const alphabet =', factory);
  const upload = sceneSource.indexOf('const t=gl.createTexture()', factory);
  if (raster < 0 || upload <= raster) throw new Error('Unexpected worldMapTexture layout');

  let pixels: Uint8Array | undefined;
  const gl = {
    createTexture() { return {}; }, bindTexture() {}, texParameteri() {},
    texImage2D(_target: number, _level: number, _format: number, width: number, height: number,
      _border: number, _channels: number, _type: number, data: Uint8Array) {
      if (pixels || data.length !== width * height) throw new Error('Expected a single R8 country map');
      pixels = data;
    },
  };
  new Function('gl', 'VS', 'FSH', 'program', 'scene', 'textAtlas', sceneSource)(
    gl, '', '', () => ({}), (scene: {init(): void}) => scene.init(), () => ({}));
  if (!pixels) throw new Error('Cartography did not upload its country map');

  // A country extends across consecutive pixels of a scanline. Each six-digit
  // hexadecimal record stores a 16-bit run length and one unsigned country ID.
  const runs = encodeCountryRuns(pixels);
  return sceneSource.slice(0, raster) +
    'const ids = (' + decodeCountryRuns.toString() + ')(' + JSON.stringify(runs) + ', width * height);\n  ' +
    sceneSource.slice(upload);
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

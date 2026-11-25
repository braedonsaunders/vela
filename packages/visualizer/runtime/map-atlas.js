// Generated bundle supplies the fixed map legend. Rows are already in GL texture order.
textAtlas = function (labels, cols, cw, ch, font) {
  const atlas = __mapAtlas;
  if (cols !== atlas.columns || cw !== atlas.cellWidth || ch !== atlas.cellHeight ||
      font !== atlas.font || JSON.stringify(labels) !== JSON.stringify(atlas.labels)) {
    throw new Error('Map label layout changed. Regenerate contour-labels.r8.');
  }
  const pixels = new Uint8Array(atlas.width * atlas.height);
  for (const [offset, hex] of atlas.spans) {
    for (let i = 0; i < hex.length; i += 2) {
      pixels[offset + i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
  }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, atlas.width, atlas.height, 0, gl.RED, gl.UNSIGNED_BYTE, pixels);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { t, cols, rows: Math.ceil(labels.length / cols), n: labels.length };
};

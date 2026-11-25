// PackBits-style literal/repeat packets for static maps. The native script carries
// the base64 string and unpackTexture only; Hermes and JSC need no codec or DOM.
export function packTexture(bytes: Uint8Array): string {
  const packed: number[] = [];
  let literal = 0;
  function flush(end: number) {
    while (literal < end) {
      const size = Math.min(128, end - literal);
      packed.push(size - 1, ...bytes.subarray(literal, literal + size));
      literal += size;
    }
  }
  for (let i = 0; i < bytes.length;) {
    let end = i + 1;
    while (end < bytes.length && end - i < 130 && bytes[i] === bytes[end]) end++;
    if (end - i >= 3) {
      flush(i);
      packed.push(128 + end - i - 3, bytes[i]);
      literal = end;
    }
    i = end;
  }
  flush(bytes.length);
  return Buffer.from(packed).toString('base64');
}

export function unpackTexture(encoded: string, size: number): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table = new Uint8Array(128);
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  let at = 0, bits = 0, accumulator = 0;
  function byte() {
    while (bits < 8) {
      if (at >= encoded.length || encoded.charCodeAt(at) === 61) throw new Error('Incomplete texture packet');
      accumulator = (accumulator << 6) | table[encoded.charCodeAt(at++)];
      bits += 6;
    }
    bits -= 8;
    return (accumulator >>> bits) & 255;
  }
  const pixels = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const header = byte();
    const count = header < 128 ? header + 1 : header - 128 + 3;
    if (count > size - offset) throw new Error('Texture packet exceeds its image');
    if (header < 128) {
      for (let j = 0; j < count; j++) pixels[offset + j] = byte();
    } else {
      pixels.fill(byte(), offset, offset + count);
    }
    offset += count;
  }
  return pixels;
}

// A book's bytes crossing from the app into the reader's web view on phones and tablets
// (apps/vela/src/media/reader-engine.ts): the app downloads the document and the web view asks for
// it a slice at a time, each slice as base64, the only form the bridge carries.

/** The bytes in one slice: large enough that a book takes few trips, small enough to pass as a message. */
export const READER_CHUNK_BYTES = 2 * 1024 * 1024;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CODES = Array.from(ALPHABET, letter => letter.charCodeAt(0));
const PAD = '='.charCodeAt(0);

/** Standard base64 (RFC 4648, padded) of `bytes`. */
export function toBase64(bytes: Uint8Array): string {
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let o = 0, i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out[o++] = CODES[n >> 18]!; out[o++] = CODES[(n >> 12) & 63]!; out[o++] = CODES[(n >> 6) & 63]!; out[o++] = CODES[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest > 0) {
    const n = (bytes[i]! << 16) | (rest === 2 ? bytes[i + 1]! << 8 : 0);
    out[o++] = CODES[n >> 18]!; out[o++] = CODES[(n >> 12) & 63]!;
    out[o++] = rest === 2 ? CODES[(n >> 6) & 63]! : PAD;
    out[o++] = PAD;
  }
  // String.fromCharCode takes its arguments on the stack: a slice at a time.
  let text = '';
  for (let start = 0; start < out.length; start += 0x8000) text += String.fromCharCode(...out.subarray(start, start + 0x8000));
  return text;
}

/** The slice of `bytes` starting at `offset` as base64: '' at or past the end, or for an offset that is not a whole number. */
export function readerChunk(bytes: Uint8Array, offset: number, size = READER_CHUNK_BYTES): string {
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) return '';
  return toBase64(bytes.subarray(offset, Math.min(bytes.length, offset + Math.max(1, size))));
}

/**
 * An RFC 4122 v4 ID. `crypto.randomUUID` exists only in a secure context, and a page opened by
 * LAN address over plain http is not one; `crypto.getRandomValues` exists everywhere.
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  return Array.from(bytes, (b, i) => `${i === 4 || i === 6 || i === 8 || i === 10 ? '-' : ''}${b.toString(16).padStart(2, '0')}`).join('');
}

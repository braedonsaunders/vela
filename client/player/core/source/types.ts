/** Borrowed source-scoped bytes; operations cancel independently of source life. */
export interface ByteReader {
  size(signal: AbortSignal): Promise<number>;
  read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
  dispose(): void;
}

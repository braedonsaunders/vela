/** Borrowed source-scoped bytes; operations cancel independently of source life. */
export interface ByteReader {
  size(signal: AbortSignal): Promise<number>;
  read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
  /** Actual container duration sizes bounded forward acquisition; unknown is valid. */
  configureBuffer?(durationSeconds:number|null):void;
  /** A demuxed media run, distinct from random metadata/index reads. */
  prefetch?(offset:number,signal:AbortSignal):void;
  dispose(): void;
}

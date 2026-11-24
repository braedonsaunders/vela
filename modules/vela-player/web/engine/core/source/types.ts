/** Borrowed source-scoped bytes; operations cancel independently of source life. */
export interface ByteReader {
  size(signal: AbortSignal): Promise<number>;
  read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
  /** Actual container duration sizes bounded forward acquisition; unknown is valid. */
  configureBuffer?(durationSeconds: number | null): void;
  /** A demuxed media run, distinct from random metadata/index reads. */
  prefetch?(offset: number, signal: AbortSignal): void;
  /** Bounded untrusted byte warming; never establishes a playback cursor. */
  speculateMedia?(
    offset: number,
    length: number,
    signal: AbortSignal,
    metadata?: boolean,
  ): {
    start: number;
    end: number;
    bytes: Promise<Uint8Array>;
    settle(actualCluster: number): void;
    cancel(): void;
  };
  /** Bytes the reader already holds, or null. Never a network read, a demand or a cursor. */
  peek?(offset: number, length: number): Uint8Array | null;
  /** Protect a parser's still-needed source span; release after copying it. */
  retain?(offset: number, length: number): () => void;
  dispose(): void;
}

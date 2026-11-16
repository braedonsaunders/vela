import { cancelled } from './session';
export class PlaybackFault extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'source' | 'decoder',
    readonly retryable = false,
  ) {
    super(message);
  }
}
export function mutation(buffer: SourceBuffer, signal: AbortSignal, operation: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    cancelled(signal);
    const clean = () => {
      buffer.removeEventListener('updateend', done);
      buffer.removeEventListener('error', error);
      signal.removeEventListener('abort', abort);
    };
    const done = () => {
      clean();
      resolve();
    };
    const error = () => {
      clean();
      reject(new PlaybackFault('SourceBuffer rejected media', 'decoder'));
    };
    const abort = () => {
      clean();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    buffer.addEventListener('updateend', done, { once: true });
    buffer.addEventListener('error', error, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    try {
      operation();
    } catch (e) {
      clean();
      reject(e);
    }
  });
}
export async function appendBuffer(
  buffer: SourceBuffer,
  bytes: ArrayBuffer,
  video: HTMLVideoElement,
  signal: AbortSignal,
) {
  try {
    await mutation(buffer, signal, () => buffer.appendBuffer(bytes));
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
    const end = video.currentTime - 10;
    if (end <= 0) throw new PlaybackFault('Insufficient media buffer quota', 'source');
    await mutation(buffer, signal, () => buffer.remove(0, end));
    await mutation(buffer, signal, () => buffer.appendBuffer(bytes));
  }
}

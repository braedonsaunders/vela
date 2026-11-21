// Native hosts read through an Expo DOM component running the same engine (device work; see
// docs/media-kinds.md). Until it lands, devices show the reader's unsupported state.
import type { ReaderEngine } from '@vela/skin/src/widgets/media/reader-engine';

export function createReaderEngine(): ReaderEngine | null {
  return null;
}

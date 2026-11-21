// Native audio is device work (docs/media-kinds.md): Apple needs AVAudioSession playback and
// MPNowPlayingInfoCenter/MPRemoteCommandCenter in the player module, Android a Media3
// MediaSessionService. Until then the queue reports audio as unsupported on native hosts.
import type { AudioEngine, AudioState } from '@vela/core';

export function createAudioEngine(): AudioEngine | null {
  return null;
}

export interface MediaSessionControls {
  play(): void; pause(): void; next(): void; previous(): void; seek(seconds: number): void; skip(delta: number): void;
}

export function syncMediaSession(_state: AudioState, _controls: MediaSessionControls): void {}

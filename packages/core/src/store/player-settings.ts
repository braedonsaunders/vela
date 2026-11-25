// The player's settings that belong to this device rather than to a viewer or a server: the
// streaming quality cap on each kind of network, and the network in use. The app reads them once
// and writes them back as they change (its preferences); the cap for the network in use is
// declared with every playback start.
import { DEFAULT_STREAMING, streamingLimit, streamingSettings, type StreamingSettings } from '../streaming';
import type { Session } from './session';
import type { StateBox } from './state';
import type { VelaState } from './index';

export interface PlayerSettingsState {
  streaming: StreamingSettings;
  /** On a metered network (mobile data, a personal hotspot, Low Data Mode), as the device says. */
  metered: boolean;
}

export const initialPlayerSettings: PlayerSettingsState = { streaming: DEFAULT_STREAMING, metered: false };

/** What is kept on the device: the choices, never the network. */
export type StoredPlayerSettings = Pick<PlayerSettingsState, 'streaming'>;

/** Stored settings, read defensively: anything unknown is the default. */
export function storedPlayerSettings(value: unknown): StoredPlayerSettings {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { streaming: streamingSettings(stored.streaming) };
}

export class PlayerSettings {
  constructor(private readonly box: StateBox<VelaState>, private readonly session: Session) {}

  private get state(): PlayerSettingsState { return this.box.get().playerSettings; }

  /** The device's stored choices, read once at launch. */
  load(stored: unknown): void {
    this.patch(storedPlayerSettings(stored));
  }

  setStreaming(next: Partial<StreamingSettings>): void {
    this.patch({ streaming: streamingSettings({ ...this.state.streaming, ...next }) });
  }

  /** The device moved between networks: the next start declares the cap for this one. */
  setMetered(metered: boolean): void {
    if (metered !== this.state.metered) this.patch({ metered });
  }

  private patch(change: Partial<PlayerSettingsState>): void {
    this.box.update('playerSettings', settings => ({ ...settings, ...change }));
    const { streaming, metered } = this.state;
    this.session.setStreamingLimit(streamingLimit(streaming, metered));
  }
}

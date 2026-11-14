import type CustomPlaybackController from '../../../../vendor/webgpu-player/src/pipeline/CustomPlaybackController';
import { downmixPolicy, outputLayout } from './policy';
type Controller = Pick<CustomPlaybackController, 'setVolume' | 'setMuted' | 'reconfigureAudioOutput' | 'getAudioOutputMaximumChannelCount'>;

/** Same gain preference keys as the existing native engine. Ambient instances are
 * always muted initially and never touch preferences. Storage refusal is harmless. */
export class VelaAudioControls {
  volume = 1;
  muted: boolean;
  nightMode = false;
  constructor(private controller: Controller, private ambient = false) {
    this.muted = ambient;
    if (!ambient) try {
      const volume = localStorage.getItem('vela.player.volume');
      if (volume !== null && Number.isFinite(Number(volume))) this.volume = Math.max(0, Math.min(1, Number(volume)));
      this.muted = localStorage.getItem('vela.player.muted') === 'true';
      this.nightMode = localStorage.getItem('vela.player.nightMode') === 'true';
    } catch {}
    controller.setVolume(this.volume); controller.setMuted(this.muted);
  }
  setVolume(value: number) {
    if (!Number.isFinite(value)) throw new RangeError('Audio volume must be finite');
    this.volume = Math.max(0, Math.min(1, value));
    this.controller.setVolume(this.volume); this.save();
  }
  setMuted(value: boolean) { this.muted = value; this.controller.setMuted(value); this.save(); }
  async setNightMode(value: boolean, sourceChannels: number) {
    const applied = await this.controller.reconfigureAudioOutput({
      decodedAudioOutputLayout: outputLayout(this.controller.getAudioOutputMaximumChannelCount(), sourceChannels),
      ...downmixPolicy(value),
    });
    if (!applied) throw new Error('Audio output cannot apply dialogue mode on this route');
    this.nightMode = value; this.save();
  }
  private save() {
    if (this.ambient) return;
    try {
      localStorage.setItem('vela.player.volume', String(this.volume));
      localStorage.setItem('vela.player.muted', String(this.muted));
      localStorage.setItem('vela.player.nightMode', String(this.nightMode));
    } catch {}
  }
}

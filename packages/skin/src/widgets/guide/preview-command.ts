import type { Command } from '@vela/player-api';

/** Keep an old preview silent during a debounced channel change, preserving the viewer's mute choice. */
export class PreviewMuteCommands {
  private key = '';
  private id = 0;
  private command: Command | undefined;
  next(sourceId: number | undefined, muted: boolean, suppressed: boolean): Command {
    const desired = muted || suppressed;
    const key = `${sourceId ?? 'default'}|${desired}`;
    if (key !== this.key) {
      this.key = key;
      this.command = { id: ++this.id, type: 'mute', muted: desired };
    }
    return this.command!;
  }
}

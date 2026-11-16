import type { AudioTrack } from '../types';

export function sameAudioConfiguration(a: AudioTrack, b: AudioTrack): boolean {
  if (
    a.id !== b.id ||
    a.codec !== b.codec ||
    a.sampleRate !== b.sampleRate ||
    a.channels !== b.channels ||
    a.channelMask !== b.channelMask ||
    a.config?.codec !== b.config?.codec
  )
    return false;
  const bytes = (value: AudioTrack) =>
    value.codecPrivate ??
    (value.config?.description
      ? ArrayBuffer.isView(value.config.description)
        ? new Uint8Array(
            value.config.description.buffer,
            value.config.description.byteOffset,
            value.config.description.byteLength,
          )
        : new Uint8Array(value.config.description)
      : null);
  const x = bytes(a),
    y = bytes(b);
  return x === y || (!!x && !!y && x.length === y.length && x.every((value, i) => value === y[i]));
}

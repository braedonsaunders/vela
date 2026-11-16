/** VLA1 envelope consumed by vela_audio.c before FFmpeg receives codec private
 * bytes. Use real demux metadata. A count without a mask remains unspecified. */
export interface AudioConfiguration {
  sampleRate: number;
  channels: number;
  channelMask?: number;
  bitsPerSample?: number;
  blockAlign?: number;
  bitRate?: number;
  description?: Uint8Array | null;
}
export function encodeAudioConfiguration(format: AudioConfiguration): Uint8Array {
  const description = format.description ?? new Uint8Array();
  if (
    !Number.isSafeInteger(format.sampleRate) ||
    format.sampleRate < 1 ||
    format.sampleRate > 768000 ||
    !Number.isSafeInteger(format.channels) ||
    format.channels < 1 ||
    format.channels > 32 ||
    description.byteLength > 1024 * 1024 - 32
  )
    throw new RangeError('Invalid audio decoder stream configuration');
  const fields = [
    0x31414c56,
    format.sampleRate,
    format.channels,
    format.channelMask ?? 0,
    format.bitsPerSample ?? 0,
    format.blockAlign ?? 0,
    format.bitRate ?? 0,
    description.byteLength,
  ];
  if (fields.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 0xffffffff))
    throw new RangeError('Invalid audio decoder metadata');
  const bytes = new Uint8Array(32 + description.byteLength);
  const view = new DataView(bytes.buffer);
  fields.forEach((n, i) => view.setUint32(i * 4, n, true));
  bytes.set(description, 32);
  return bytes;
}

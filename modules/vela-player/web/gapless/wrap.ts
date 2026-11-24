// Headers that turn demuxed audio packets back into a file a browser's decodeAudioData accepts
// (compat-decoder.ts): FLAC's stream header and AAC's ADTS frame header.

/**
 * FLAC's `fLaC` marker and STREAMINFO (the WebCodecs description), as the header of a file holding only
 * some of the stream's frames: the total sample count and checksum are cleared ("unknown"), so a decoder
 * neither stops early nor checks the whole stream.
 */
export function flacStreamHeader(description: Uint8Array): Uint8Array {
  const header = new Uint8Array(42);
  header.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
  // The description is fLaC + a metadata block header + STREAMINFO, or STREAMINFO alone.
  const info = description.length >= 42 && description[0] === 0x66 ? description.subarray(8, 42) : description.subarray(0, 34);
  header.set(info, 8);
  header[8 + 13] = header[8 + 13]! & 0xf0;
  header.fill(0, 8 + 14, 8 + 34);
  return header;
}

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/**
 * A 7-byte ADTS header for one raw AAC frame of `payload` bytes, from the AudioSpecificConfig (the
 * description) or, without one, from the declared rate and channels as AAC-LC.
 */
export function adtsHeader(config: Uint8Array | null, declared: { sampleRate: number; numberOfChannels: number }, payload: number): Uint8Array {
  let profile = 2, rateIndex = RATES.indexOf(declared.sampleRate), channels = declared.numberOfChannels;
  if (config && config.length >= 2) {
    profile = config[0]! >> 3;
    rateIndex = ((config[0]! & 7) << 1) | (config[1]! >> 7);
    channels = (config[1]! >> 3) & 15;
  }
  if (rateIndex < 0 || rateIndex > 12) rateIndex = 4;
  const length = payload + 7;
  return new Uint8Array([
    0xff, 0xf1,
    ((profile - 1) & 3) << 6 | rateIndex << 2 | (channels >> 2 & 1),
    (channels & 3) << 6 | (length >> 11 & 3),
    length >> 3 & 0xff,
    (length & 7) << 5 | 0x1f,
    0xfc,
  ]);
}

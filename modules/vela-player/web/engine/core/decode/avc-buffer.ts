const AVC_LEVEL_DPB_MACROBLOCKS = new Map<number, number>([
  [10, 396],
  [11, 900],
  [12, 2376],
  [13, 2376],
  [20, 2376],
  [21, 4752],
  [22, 8100],
  [30, 8100],
  [31, 18000],
  [32, 20480],
  [40, 32768],
  [41, 32768],
  [42, 34816],
  [50, 110400],
  [51, 184320],
  [52, 184320],
  [60, 696320],
  [61, 696320],
  [62, 696320],
]);

class Bits {
  private position = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(count = 1): number {
    if (!Number.isSafeInteger(count) || count < 0 || count > 32 || this.position + count > this.bytes.length * 8)
      throw new Error('Truncated AVC SPS');
    let value = 0;
    for (let index = 0; index < count; index++) {
      value = value * 2 + ((this.bytes[this.position >> 3]! >> (7 - (this.position & 7))) & 1);
      this.position++;
    }
    return value;
  }
  ue(): number {
    let zeroes = 0;
    while (this.read() === 0) {
      zeroes++;
      if (zeroes > 31) throw new Error('Invalid AVC Exp-Golomb value');
    }
    return 2 ** zeroes - 1 + (zeroes ? this.read(zeroes) : 0);
  }
  se(): number {
    const value = this.ue();
    return value & 1 ? (value + 1) / 2 : -value / 2;
  }
}
function rbsp(nal: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < nal.length; index++) {
    if (index >= 2 && nal[index] === 3 && nal[index - 1] === 0 && nal[index - 2] === 0) continue;
    bytes.push(nal[index]!);
  }
  return new Uint8Array(bytes);
}

function skipScalingList(bits: Bits, size: number) {
  let last = 8,
    next = 8;
  for (let index = 0; index < size; index++) {
    if (next !== 0) next = (last + bits.se() + 256) % 256;
    if (next !== 0) last = next;
  }
}

function skipHrd(bits: Bits) {
  const count = bits.ue() + 1;
  bits.read(8);
  for (let index = 0; index < count; index++) {
    bits.ue();
    bits.ue();
    bits.read();
  }
  bits.read(20);
}

function firstSps(description: AllowSharedBufferSource): Uint8Array | null {
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  if (bytes.length < 8 || bytes[0] !== 1) return null;
  const count = bytes[5]! & 0x1f;
  let offset = 6;
  for (let index = 0; index < count; index++) {
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    offset += 2;
    if (offset + length > bytes.length) return null;
    const nal = bytes.subarray(offset, offset + length);
    if ((nal[0]! & 0x1f) === 7) return nal;
    offset += length;
  }
  return null;
}

/** H.264 Annex A/VUI decoded-picture-buffer bound. Null means the configuration
 * is not AVC or its SPS is malformed; callers retain a conservative codec cap. */
export function avcDecodedPictureBufferFrames(config: VideoDecoderConfig | null): number | null {
  if (!config?.description || !/^(avc1|avc3)\./i.test(config.codec)) return null;
  const nal = firstSps(config.description);
  if (!nal) return null;
  try {
    const bits = new Bits(rbsp(nal));
    bits.read(8); // NAL header
    const profile = bits.read(8),
      constraints = bits.read(8),
      level = bits.read(8);
    bits.ue(); // seq_parameter_set_id
    if ([44, 83, 86, 100, 110, 118, 122, 128, 134, 135, 138, 139, 144, 244].includes(profile)) {
      const chroma = bits.ue();
      if (chroma === 3) bits.read();
      bits.ue();
      bits.ue();
      bits.read();
      if (bits.read())
        for (let index = 0; index < (chroma === 3 ? 12 : 8); index++)
          if (bits.read()) skipScalingList(bits, index < 6 ? 16 : 64);
    }
    bits.ue(); // log2_max_frame_num_minus4
    const order = bits.ue();
    if (order === 0) bits.ue();
    else if (order === 1) {
      bits.read();
      bits.se();
      bits.se();
      const cycle = bits.ue();
      for (let index = 0; index < cycle; index++) bits.se();
    }
    const referenceFrames = bits.ue();
    bits.read();
    const widthInMbs = bits.ue() + 1,
      heightInMapUnits = bits.ue() + 1,
      frameOnly = bits.read();
    if (!frameOnly) bits.read();
    bits.read();
    if (bits.read()) {
      bits.ue();
      bits.ue();
      bits.ue();
      bits.ue();
    }
    if (bits.read()) {
      if (bits.read() && bits.read(8) === 255) bits.read(32);
      if (bits.read()) bits.read();
      if (bits.read()) {
        bits.read(4);
        if (bits.read()) bits.read(24);
      }
      if (bits.read()) {
        bits.ue();
        bits.ue();
      }
      if (bits.read()) {
        bits.read(32);
        bits.read(32);
        bits.read();
      }
      const nalHrd = bits.read();
      if (nalHrd) skipHrd(bits);
      const vclHrd = bits.read();
      if (vclHrd) skipHrd(bits);
      if (nalHrd || vclHrd) bits.read();
      bits.read();
      if (bits.read()) {
        bits.read();
        bits.ue();
        bits.ue();
        bits.ue();
        bits.ue();
        bits.ue(); // max_num_reorder_frames
        return Math.max(1, Math.min(16, bits.ue()));
      }
    }
    const level1b = level === 11 && (constraints & 0x10) !== 0 && [66, 77, 88].includes(profile);
    const maximumMacroblocks = AVC_LEVEL_DPB_MACROBLOCKS.get(level1b ? 10 : level);
    if (!maximumMacroblocks) return 16;
    const frameMacroblocks = widthInMbs * (2 - frameOnly) * heightInMapUnits;
    return Math.max(
      1,
      Math.min(16, Math.max(referenceFrames, Math.floor(maximumMacroblocks / frameMacroblocks))),
    );
  } catch {
    return null;
  }
}

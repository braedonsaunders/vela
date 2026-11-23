/** DVD VobSub (S_VOBSUB / dvd_subtitle): each packet is one subpicture unit (SPU) holding a 2-bit
 * run-length bitmap and its display control sequences; the track's .idx text (Matroska
 * CodecPrivate) gives the frame size and the 16-colour palette the SPU's four colour indices
 * select from. Packets are independent, so a cue is fully described by its own packet. */
import type { PGSDisplay } from './pgs';

export interface VobSubConfiguration {
  width: number;
  height: number;
  /** 16 RGB colours, 0xRRGGBB. */
  palette: number[];
}
export interface VobSubCue {
  start: number;
  end: number;
  forced: boolean;
  display: PGSDisplay;
}

const MAX_SIZE = 4096;
/** Control sequence delays count 1024 ticks of the 90 kHz clock. */
const DELAY_SECONDS = 1024 / 90000;
const DEFAULT_PALETTE = [
  0x000000, 0xf0f0f0, 0xcccccc, 0x999999, 0x3333fa, 0x1111bb, 0xfa3333, 0xbb1111, 0x33fa33, 0x11bb11, 0xfafa33,
  0xbbbb11, 0xfa33fa, 0xbb11bb, 0x33fafa, 0x11bbbb,
];

/** Reads the .idx text: "size: 720x480" and "palette: rrggbb, …" (16 entries). */
export function parseVobSubIdx(bytes: Uint8Array | null): VobSubConfiguration {
  const text = bytes ? new TextDecoder().decode(bytes) : '';
  const size = /^\s*size:\s*(\d+)\s*x\s*(\d+)/im.exec(text);
  const width = size ? Number(size[1]) : 720,
    height = size ? Number(size[2]) : 480;
  if (!(width > 0 && width <= MAX_SIZE && height > 0 && height <= MAX_SIZE))
    throw new Error('VobSub frame size is invalid');
  const entries = /^\s*palette:\s*(.+)$/im.exec(text)?.[1].split(',').map((entry) => entry.trim());
  const palette =
    entries && entries.length === 16 && entries.every((entry) => /^[0-9a-f]{6}$/i.test(entry))
      ? entries.map((entry) => parseInt(entry, 16))
      : DEFAULT_PALETTE;
  return { width, height, palette };
}

class Nibbles {
  private at: number;
  private half = false;
  constructor(
    private readonly data: Uint8Array,
    start: number,
    private readonly limit: number,
  ) {
    this.at = start;
  }
  next(): number {
    if (this.at >= this.limit) throw new Error('VobSub bitmap runs past its data');
    const byte = this.data[this.at];
    if (this.half) {
      this.half = false;
      this.at++;
      return byte & 15;
    }
    this.half = true;
    return byte >> 4;
  }
  align() {
    if (this.half) {
      this.half = false;
      this.at++;
    }
  }
}

/** Decodes one field's lines (every other line of the bitmap) from its run-length data. */
function decodeField(
  data: Uint8Array,
  start: number,
  limit: number,
  width: number,
  lines: number,
  first: number,
  output: Uint8Array,
) {
  const reader = new Nibbles(data, start, limit);
  for (let line = first; line < lines; line += 2) {
    let x = 0;
    while (x < width) {
      let value = reader.next();
      if (value < 0x4) {
        value = (value << 4) | reader.next();
        if (value < 0x10) {
          value = (value << 4) | reader.next();
          if (value < 0x40) value = (value << 4) | reader.next();
        }
      }
      const colour = value & 3;
      let run = value >> 2;
      // A zero run fills the rest of the line.
      if (run === 0 || x + run > width) run = width - x;
      output.fill(colour, line * width + x, line * width + x + run);
      x += run;
    }
    reader.align();
  }
}

/** Decodes one SPU. Times are relative to the packet; the cue ends at the stop command, or at
 * `fallbackEnd` (the packet's container duration) when the SPU has none. */
export function decodeVobSub(
  packet: Uint8Array,
  time: number,
  configuration: VobSubConfiguration,
  fallbackEnd: number | null,
): VobSubCue | null {
  if (packet.length < 4) throw new Error('Truncated VobSub packet');
  const size = (packet[0] << 8) | packet[1],
    control = (packet[2] << 8) | packet[3];
  if (size > packet.length || control >= size || control < 4) throw new Error('Invalid VobSub packet');
  let start: number | null = null,
    stop: number | null = null,
    forced = false,
    colours = [0, 1, 2, 3],
    alphas = [0, 15, 15, 15],
    area: { x1: number; x2: number; y1: number; y2: number } | null = null,
    offsets: [number, number] | null = null;
  for (let sequence = control, visited = 0; visited < 64; visited++) {
    if (sequence + 4 > size) throw new Error('Truncated VobSub control sequence');
    const delay = ((packet[sequence] << 8) | packet[sequence + 1]) * DELAY_SECONDS,
      next = (packet[sequence + 2] << 8) | packet[sequence + 3];
    let at = sequence + 4;
    commands: while (at < size) {
      const command = packet[at++];
      switch (command) {
        case 0x00:
          forced = true;
          start ??= delay;
          break;
        case 0x01:
          start ??= delay;
          break;
        case 0x02:
          stop ??= delay;
          break;
        case 0x03:
          if (at + 2 > size) throw new Error('Truncated VobSub colours');
          colours = [packet[at + 1] & 15, packet[at + 1] >> 4, packet[at] & 15, packet[at] >> 4];
          at += 2;
          break;
        case 0x04:
          if (at + 2 > size) throw new Error('Truncated VobSub contrast');
          alphas = [packet[at + 1] & 15, packet[at + 1] >> 4, packet[at] & 15, packet[at] >> 4];
          at += 2;
          break;
        case 0x05:
          if (at + 6 > size) throw new Error('Truncated VobSub display area');
          area = {
            x1: (packet[at] << 4) | (packet[at + 1] >> 4),
            x2: ((packet[at + 1] & 15) << 8) | packet[at + 2],
            y1: (packet[at + 3] << 4) | (packet[at + 4] >> 4),
            y2: ((packet[at + 4] & 15) << 8) | packet[at + 5],
          };
          at += 6;
          break;
        case 0x06:
          if (at + 4 > size) throw new Error('Truncated VobSub field offsets');
          offsets = [(packet[at] << 8) | packet[at + 1], (packet[at + 2] << 8) | packet[at + 3]];
          at += 4;
          break;
        case 0x07: {
          // Colour/contrast change within lines (rare): skipped, with its declared length.
          if (at + 2 > size) throw new Error('Truncated VobSub colour change');
          at += (packet[at] << 8) | packet[at + 1];
          break;
        }
        case 0xff:
          break commands;
        default:
          throw new Error(`Unknown VobSub command ${command}`);
      }
    }
    if (next === sequence || next < control || next >= size) break;
    sequence = next;
  }
  if (start === null || !area || !offsets) return null;
  const width = area.x2 - area.x1 + 1,
    height = area.y2 - area.y1 + 1;
  if (width <= 0 || height <= 0 || width > MAX_SIZE || height > MAX_SIZE)
    throw new Error('VobSub display area is invalid');
  const indices = new Uint8Array(width * height);
  decodeField(packet, offsets[0], control, width, height, 0, indices);
  decodeField(packet, offsets[1], control, width, height, 1, indices);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i],
      alpha = alphas[index] * 17;
    if (!alpha) continue;
    const rgb = configuration.palette[colours[index]] ?? 0;
    rgba[i * 4] = rgb >> 16;
    rgba[i * 4 + 1] = (rgb >> 8) & 255;
    rgba[i * 4 + 2] = rgb & 255;
    rgba[i * 4 + 3] = alpha;
  }
  const end = stop !== null ? time + stop : fallbackEnd;
  return {
    start: time + start,
    end: end ?? time + start + 5,
    forced,
    display: {
      time: time + start,
      width: configuration.width,
      height: configuration.height,
      bitmaps: [{ x: area.x1, y: area.y1, width, height, rgba }],
    },
  };
}

/** Joins subpicture units a muxer split across packets: an SPU declares its size in its first two
 * bytes, and the packets that follow complete it (FFmpeg's decoder buffers the same way). */
export function joinVobSubPackets<P extends { time: number; duration: number | null; data: Uint8Array }>(
  packets: readonly P[],
): P[] {
  const joined: P[] = [];
  let pending: { packet: P; parts: Uint8Array[]; length: number; size: number } | null = null;
  for (const packet of packets) {
    if (pending) {
      pending.parts.push(packet.data);
      pending.length += packet.data.length;
      if (pending.length >= pending.size) {
        const data = new Uint8Array(pending.length);
        let at = 0;
        for (const part of pending.parts) {
          data.set(part, at);
          at += part.length;
        }
        joined.push({ ...pending.packet, data: data.subarray(0, pending.size) });
        pending = null;
      }
      continue;
    }
    const size = packet.data.length >= 2 ? (packet.data[0] << 8) | packet.data[1] : 0;
    if (size > packet.data.length && size <= 65535)
      pending = { packet, parts: [packet.data], length: packet.data.length, size };
    else joined.push(packet);
  }
  return joined;
}

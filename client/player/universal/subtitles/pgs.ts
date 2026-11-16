/** Blu-ray PGS display sets. Palette, object fragments and clear compositions are stateful. */
export interface PGSBitmap {
  x: number;
  y: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  crop?: { x: number; y: number; width: number; height: number };
}
export interface PGSDisplay {
  time: number;
  width: number;
  height: number;
  bitmaps: PGSBitmap[];
}
const MAX_PIXELS = 4096 * 4096,
  MAX_BYTES = 32 * 1024 * 1024;
const u16 = (a: Uint8Array, i: number) => (a[i] << 8) | a[i + 1];
interface ObjectData {
  width: number;
  height: number;
  expected: number;
  chunks: Uint8Array[];
  size: number;
  complete: boolean;
}
interface Placement {
  id: number;
  window: number;
  x: number;
  y: number;
  crop?: PGSBitmap['crop'];
}
function requireBytes(data: Uint8Array, at: number, count: number) {
  if (at < 0 || at + count > data.length) throw new Error('Truncated PGS segment');
}
export class PGSDecoder {
  private palettes = new Map<number, Uint8ClampedArray>();
  private objects = new Map<number, ObjectData>();
  private composition: {
    time: number;
    width: number;
    height: number;
    palette: number;
    objects: Placement[];
  } | null = null;
  private bytes = 0;
  private windows = new Map<number, { x: number; y: number; width: number; height: number }>();
  reset() {
    this.palettes.clear();
    this.objects.clear();
    this.composition = null;
    this.bytes = 0;
    this.windows.clear();
  }
  /** MKV stores type/u16 length segments, SUP prepends PG/PTS/DTS. */
  push(data: Uint8Array, time: number): PGSDisplay[] {
    const displays: PGSDisplay[] = [];
    let at = 0;
    while (at < data.length) {
      let stamp = time;
      if (data[at] === 0x50 && data[at + 1] === 0x47) {
        requireBytes(data, at, 13);
        stamp = new DataView(data.buffer, data.byteOffset + at + 2, 4).getUint32(0) / 90000;
        at += 10;
      }
      requireBytes(data, at, 3);
      const kind = data[at],
        size = u16(data, at + 1);
      at += 3;
      requireBytes(data, at, size);
      const segment = data.subarray(at, at + size);
      at += size;
      if (kind === 0x14) this.palette(segment);
      else if (kind === 0x15) this.object(segment);
      else if (kind === 0x16) this.picture(segment, stamp);
      else if (kind === 0x17) this.window(segment);
      else if (kind === 0x80) {
        const display = this.finish();
        if (display) displays.push(display);
      }
    }
    return displays;
  }
  private palette(data: Uint8Array) {
    requireBytes(data, 0, 2);
    if ((data.length - 2) % 5) throw new Error('Invalid PGS palette');
    const entries = this.palettes.get(data[0])?.slice() ?? new Uint8ClampedArray(1024);
    for (let i = 2; i < data.length; i += 5) {
      const id = data[i] * 4,
        y = ((data[i + 1] - 16) * 255) / 219,
        cr = data[i + 2] - 128,
        cb = data[i + 3] - 128;
      const sd = (this.composition?.height ?? 1080) <= 576;
      entries[id] = y + (sd ? 1.596027 : 1.792741) * cr;
      entries[id + 1] = y - (sd ? 0.391762 : 0.213249) * cb - (sd ? 0.812968 : 0.532909) * cr;
      entries[id + 2] = y + (sd ? 2.017232 : 2.112402) * cb;
      entries[id + 3] = data[i + 4];
    }
    this.palettes.set(data[0], entries);
  }
  private object(data: Uint8Array) {
    requireBytes(data, 0, 4);
    const id = u16(data, 0),
      flags = data[3];
    let start = 4;
    if (flags & 0x80) {
      requireBytes(data, 4, 7);
      const expected = ((data[4] << 16) | (data[5] << 8) | data[6]) - 4,
        width = u16(data, 7),
        height = u16(data, 9);
      if (expected < 0 || expected > MAX_BYTES || !width || !height || width * height > MAX_PIXELS)
        throw new Error('PGS object exceeds bounds');
      this.bytes -= this.objects.get(id)?.size ?? 0;
      this.objects.set(id, { width, height, expected, chunks: [], size: 0, complete: false });
      start = 11;
    }
    const object = this.objects.get(id);
    if (!object) throw new Error('PGS continuation has no object');
    const chunk = data.slice(start);
    object.chunks.push(chunk);
    object.size += chunk.length;
    this.bytes += chunk.length;
    if (object.size > object.expected || this.bytes > MAX_BYTES || this.objects.size > 256)
      throw new Error('PGS object cache exceeds bounds');
    if (flags & 0x40) {
      if (object.size !== object.expected) throw new Error('Truncated PGS object');
      object.complete = true;
    }
  }
  private picture(data: Uint8Array, time: number) {
    requireBytes(data, 0, 11);
    const width = u16(data, 0),
      height = u16(data, 2);
    if (!width || !height || width * height > MAX_PIXELS) throw new Error('PGS composition exceeds bounds');
    if (data[7] & 0x80) {
      this.objects.clear();
      this.palettes.clear();
      this.windows.clear();
      this.bytes = 0;
    }
    const objects: Placement[] = [];
    let at = 11;
    for (let n = 0; n < data[10]; n++) {
      requireBytes(data, at, 8);
      const id = u16(data, at),
        cropped = !!(data[at + 3] & 0x80),
        x = u16(data, at + 4),
        y = u16(data, at + 6);
      at += 8;
      let crop: PGSBitmap['crop'];
      if (cropped) {
        requireBytes(data, at, 8);
        crop = {
          x: u16(data, at),
          y: u16(data, at + 2),
          width: u16(data, at + 4),
          height: u16(data, at + 6),
        };
        at += 8;
      }
      objects.push({ id, window: data[at - (cropped ? 16 : 8) + 2], x, y, crop });
    }
    this.composition = { time, width, height, palette: data[9], objects };
  }
  private window(data: Uint8Array) {
    requireBytes(data, 0, 1);
    if (data.length !== 1 + data[0] * 9) throw new Error('Invalid PGS window segment');
    for (let n = 0; n < data[0]; n++) {
      const at = 1 + n * 9;
      this.windows.set(data[at], {
        x: u16(data, at + 1),
        y: u16(data, at + 3),
        width: u16(data, at + 5),
        height: u16(data, at + 7),
      });
    }
  }
  private finish(): PGSDisplay | null {
    const composition = this.composition;
    if (!composition) return null;
    const palette = this.palettes.get(composition.palette),
      bitmaps: PGSBitmap[] = [];
    let pixels = 0;
    if (composition.objects.length && !palette) return null; // A seek may begin before an acquisition set.
    for (const placement of composition.objects) {
      const object = this.objects.get(placement.id);
      if (!object?.complete) return null;
      pixels += object.width * object.height;
      if (pixels > MAX_PIXELS) throw new Error('PGS display exceeds bounds');
      const packed = new Uint8Array(object.size);
      let at = 0;
      for (const chunk of object.chunks) {
        packed.set(chunk, at);
        at += chunk.length;
      }
      const rgba = new Uint8ClampedArray(object.width * object.height * 4);
      let x = 0,
        y = 0;
      for (let i = 0; i < packed.length; ) {
        let color = packed[i++],
          count = 1;
        if (color === 0) {
          if (i >= packed.length) throw new Error('Truncated PGS run');
          const control = packed[i++];
          if (control === 0) {
            if (x !== object.width) throw new Error('Incomplete PGS row');
            x = 0;
            y++;
            if (y > object.height) throw new Error('PGS rows exceed bitmap');
            continue;
          }
          count = control & 0x3f;
          if (control & 0x40) {
            if (i >= packed.length) throw new Error('Truncated PGS long run');
            count = count * 256 + packed[i++];
          }
          if (control & 0x80) {
            if (i >= packed.length) throw new Error('Truncated PGS color');
            color = packed[i++];
          } else color = 0;
        }
        if (!count || y >= object.height || x + count > object.width) throw new Error('Invalid PGS run');
        for (let n = 0; n < count; n++)
          rgba.set(palette!.subarray(color * 4, color * 4 + 4), (y * object.width + x++) * 4);
      }
      if (y * object.width + x !== object.width * object.height) throw new Error('Incomplete PGS bitmap');
      if (
        placement.crop &&
        (placement.crop.x + placement.crop.width > object.width ||
          placement.crop.y + placement.crop.height > object.height)
      )
        throw new Error('PGS crop exceeds bitmap');
      const crop = placement.crop ?? { x: 0, y: 0, width: object.width, height: object.height },
        window = this.windows.get(placement.window);
      const left = Math.max(placement.x, window?.x ?? 0, 0),
        top = Math.max(placement.y, window?.y ?? 0, 0);
      const right = Math.min(
          placement.x + crop.width,
          window ? window.x + window.width : composition.width,
          composition.width,
        ),
        bottom = Math.min(
          placement.y + crop.height,
          window ? window.y + window.height : composition.height,
          composition.height,
        );
      if (right > left && bottom > top)
        bitmaps.push({
          x: left,
          y: top,
          width: object.width,
          height: object.height,
          rgba,
          crop: {
            x: crop.x + left - placement.x,
            y: crop.y + top - placement.y,
            width: right - left,
            height: bottom - top,
          },
        });
    }
    return { time: composition.time, width: composition.width, height: composition.height, bitmaps };
  }
}

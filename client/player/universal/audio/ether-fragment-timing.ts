/** Validate the actual fMP4 timeline, not FFprobe's edit-list-adjusted PTS.
 * Chrome MSE ignores an empty edit's lead-in, so tfdt itself must be title-absolute. */
export function assertEtherAudioTimeline(init: Uint8Array, fragment: Uint8Array, requestedSeconds: number): void {
  const movie = one(boxes(init), 'moov');
  const tracks = boxes(init, movie.start, movie.end).filter(box => box.type === 'trak');
  if (tracks.length !== 1) throw new Error('Ether audio fallback must contain exactly one audio track');
  const track = tracks[0], trackBoxes = boxes(init, track.start, track.end);
  if (trackBoxes.some(box => box.type === 'edts')) throw new Error('Ether audio init uses an edit-list rebase unsupported by the audio-only timeline');
  const media = one(trackBoxes, 'mdia'), mediaBoxes = boxes(init, media.start, media.end);
  const handler = one(mediaBoxes, 'hdlr');
  if (handler.end - handler.start < 12 || fourcc(init, handler.start + 8) !== 'soun') throw new Error('Ether audio fallback contains a non-audio track');
  const header = one(mediaBoxes, 'mdhd');
  if (header.end - header.start < 4) throw new Error('Truncated Ether audio media header');
  const offset = init[header.start] === 0 ? 12 : init[header.start] === 1 ? 20 : -1;
  if (offset < 0 || header.start + offset + 4 > header.end) throw new Error('Invalid Ether audio media header');
  const timescale = view(init).getUint32(header.start + offset, false);
  if (!timescale) throw new Error('Ether audio has no media timescale');
  const moof = one(boxes(fragment), 'moof');
  const traf = one(boxes(fragment, moof.start, moof.end), 'traf');
  const tfdt = one(boxes(fragment, traf.start, traf.end), 'tfdt');
  if (tfdt.end - tfdt.start < 8) throw new Error('Truncated Ether audio decode time');
  let decodeTime: number;
  if (fragment[tfdt.start] === 0) decodeTime = view(fragment).getUint32(tfdt.start + 4, false);
  else if (fragment[tfdt.start] === 1 && tfdt.end - tfdt.start >= 12) decodeTime = Number(view(fragment).getBigUint64(tfdt.start + 4, false));
  else throw new Error('Invalid Ether audio decode-time version');
  if (!Number.isSafeInteger(decodeTime) || Math.abs(decodeTime / timescale - requestedSeconds) > 0.125)
    throw new Error('Ether audio fragment decode time is not on the requested title timeline');
}
interface Box { type: string; start: number; end: number }
function view(bytes: Uint8Array) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function fourcc(bytes: Uint8Array, offset: number) { return String.fromCharCode(...bytes.subarray(offset, offset + 4)); }
function boxes(bytes: Uint8Array, start = 0, end = bytes.byteLength): Box[] {
  const result: Box[] = [], data = view(bytes);
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) throw new Error('Truncated Ether audio MP4 box');
    let size = data.getUint32(offset, false), header = 8;
    if (size === 1) {
      if (offset + 16 > end) throw new Error('Truncated extended Ether audio MP4 box');
      size = Number(data.getBigUint64(offset + 8, false)); header = 16;
    } else if (!size) size = end - offset;
    if (!Number.isSafeInteger(size) || size < header || size > end - offset) throw new Error('Invalid Ether audio MP4 box size');
    result.push({ type: fourcc(bytes, offset + 4), start: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}
function one(boxes: Box[], type: string): Box {
  const selected = boxes.filter(box => box.type === type);
  if (selected.length !== 1) throw new Error(`Ether audio needs exactly one ${type} box`);
  return selected[0];
}

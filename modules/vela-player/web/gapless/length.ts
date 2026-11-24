// Whether a track's response is of a file that is all there. The gapless player reads a track as a
// file, and the end of what it reads is the track's end. A stream still being produced (a server's
// live transcode: 200, chunked, no Content-Length, Accept-Ranges: none, as Ether serves a transcode
// it has not finished) is not: read as a file, its first fragment looks like the whole track, which
// then "ends" after a few frames. The <audio> element plays such a stream to its real end instead.

/** From a successful response's status and headers. */
export function completeStream(status: number, headers: { get(name: string): string | null }): boolean {
  // A byte range of a resource is of a file, unless its total is not known yet ("bytes 0-99/*").
  // A cross-origin page may not see Content-Range at all; the range is still of a file.
  if (status === 206) return !/\/\s*\*\s*$/.test(headers.get('content-range') ?? '');
  // A whole response says how long it is; without that (chunked) it is still being produced.
  const length = headers.get('content-length');
  return status === 200 && length !== null && /^\s*\d+\s*$/.test(length);
}

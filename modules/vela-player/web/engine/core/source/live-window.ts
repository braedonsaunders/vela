import { livePlaylistReloadDelayMs } from './reload';

/** An HLS sequence is identity, never a duration estimate. Keep one bounded
 * census and anchor new windows by an overlapping segment or exact successor. */
export class LiveWindow {
  private spans = new Map<number, { start: number; duration: number }>();
  private last: { sequence: number; end: number } | null = null;
  start = 0;
  edge = 0;
  targetDuration = 2;
  ended = false;
  gap = false;
  updatedAt = 0;
  reloadDelayMs = 1000;
  update(text: string, anchor?: { mediaSequence: number; windowStartSeconds: number }): string {
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const sequence = Number(
      lines.find((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))?.split(':')[1] ?? 0,
    );
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid live media sequence');
    const segments: { line: number; duration: number }[] = [];
    let duration: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith('#EXTINF:')) {
        duration = Number(line.slice(8).split(',')[0]);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 60)
          throw new Error('Invalid live segment duration');
      } else if (line && !line.startsWith('#')) {
        if (duration === null) throw new Error('Live segment has no duration');
        segments.push({ line: i, duration });
        duration = null;
      }
    }
    if (segments.length > 2048) throw new Error('Live playlist exceeds its segment bound');
    if (!segments.length) return text;
    let start: number | null = null,
      prefix = 0;
    if (anchor) {
      if (
        !Number.isSafeInteger(anchor.mediaSequence) ||
        anchor.mediaSequence < sequence ||
        anchor.mediaSequence >= sequence + segments.length ||
        !Number.isFinite(anchor.windowStartSeconds) ||
        anchor.windowStartSeconds < 0 ||
        !Number.isSafeInteger(Math.round(anchor.windowStartSeconds * 1e6))
      )
        throw new Error('Invalid live playlist anchor');
      start =
        anchor.windowStartSeconds -
        segments
          .slice(0, anchor.mediaSequence - sequence)
          .reduce((sum, segment) => sum + segment.duration, 0);
    }
    for (let i = 0; i < segments.length; i++) {
      const known = this.spans.get(sequence + i);
      if (known) {
        if (Math.abs(known.duration - segments[i]!.duration) > 0.001)
          throw new Error('Live segment changed within its generation');
        const overlap = known.start - prefix;
        if (start !== null && Math.abs(start - overlap) > 0.002)
          throw new Error('Live playlist anchor changed its known timeline');
        start = overlap;
        break;
      }
      prefix += segments[i]!.duration;
    }
    if (start === null) {
      if (!this.last) throw new Error('Live playlist has no exact session anchor');
      else if (sequence === this.last.sequence + 1) start = this.last.end;
      else throw new Error('Live window lost its known timeline; a fresh source is required');
    }
    if (start < 0 || !Number.isFinite(start)) throw new Error('Invalid live window timeline');
    const next = new Map<number, { start: number; duration: number }>();
    let end = start;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      next.set(sequence + i, { start: end, duration: segment.duration });
      end += segment.duration;
    }
    const previousLast = this.last,
      previousEnded = this.ended;
    this.spans = next;
    this.last = { sequence: sequence + segments.length - 1, end };
    this.start = start;
    this.edge = end;
    const target = Number(
      lines.find((line) => line.startsWith('#EXT-X-TARGETDURATION:'))?.split(':')[1] ?? 2,
    );
    if (!Number.isFinite(target) || target <= 0 || target > 60)
      throw new Error('Invalid live target duration');
    this.targetDuration = target;
    this.ended = lines.includes('#EXT-X-ENDLIST');
    this.gap = lines.includes('#EXT-X-GAP');
    this.updatedAt = performance.now();
    const changed =
      !previousLast ||
      previousLast.sequence !== this.last.sequence ||
      Math.abs(previousLast.end - this.last.end) > 0.001 ||
      previousEnded !== this.ended;
    this.reloadDelayMs = livePlaylistReloadDelayMs(
      this.targetDuration,
      segments.at(-1)?.duration ?? null,
      changed,
    );
    // The demux library accepts a date anchor. Use a synthetic epoch ONLY on
    // this private in-memory playlist to carry our exact media timeline; it is
    // not broadcast wall time and is never sent to the broker or diagnostics.
    const first = segments[0]!.line;
    return lines
      .flatMap((line, i) =>
        line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')
          ? []
          : i === first
            ? [`#EXT-X-PROGRAM-DATE-TIME:${new Date(start * 1000).toISOString()}`, line]
            : [line],
      )
      .join('\n');
  }
}

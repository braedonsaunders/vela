// One track for the gapless player (player.ts): opened with Mediabunny (MP3, MP4/M4A, FLAC, Ogg, WAV,
// ADTS), decoded with WebCodecs, and handed out as planar PCM trimmed to the track's real audio
// (trim.ts), so consecutive tracks join sample to sample. Data is read with HTTP ranges as it is
// needed; nothing holds the whole file.
import { ALL_FORMATS, AudioSampleCursor, Input, MP3, MP4, QTFF, UrlSource, type InputAudioTrack } from 'mediabunny';
import { keptFrames, readTrimFacts, trimFor, type GaplessTrim } from './trim';
import { completeStream } from './length';

/** This browser cannot open or decode the track: another engine should play it. */
export class UnsupportedTrack extends Error {}

/** Planar PCM at the track's rate. */
export interface PcmChunk { frames: number; channels: Float32Array[]; sampleRate: number }

/** Decoded audio is gathered into chunks of about this many seconds before it is scheduled. */
const CHUNK_SECONDS = 0.5;

export class TrackStream {
  private constructor(
    readonly url: string,
    private readonly input: Input,
    private readonly track: InputAudioTrack,
    readonly sampleRate: number,
    readonly channelCount: number,
    readonly trim: GaplessTrim,
  ) {}

  /** The track's real length in seconds (0 when the file does not say). */
  get duration(): number { return Number.isFinite(this.trim.end) ? this.trim.end - this.trim.start : 0; }

  static async open(url: string): Promise<TrackStream> {
    // A response that does not say how long the file is (a transcode still being produced) is refused
    // at its first response, before any of it is read as the whole track (length.ts).
    const sized: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (response.ok && !completeStream(response.status, response.headers)) {
        void response.body?.cancel().catch(() => undefined);
        throw new UnsupportedTrack('This stream has no length yet');
      }
      return response;
    };
    const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url, {
      fetchFn: sized,
      getRetryDelay: (attempts, error) => (error instanceof UnsupportedTrack ? null : attempts < 3 ? attempts : null),
    }) });
    try {
      const format = await input.getFormat().catch(error => { throw new UnsupportedTrack(error instanceof Error ? error.message : 'Unknown audio format'); });
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new UnsupportedTrack('No audio track');
      if (!(await track.canDecode())) throw new UnsupportedTrack(`${await track.getCodec() ?? 'This codec'} cannot be decoded here`);
      const [sampleRate, channelCount, duration] = await Promise.all([track.getSampleRate(), track.getNumberOfChannels(), track.getDurationFromMetadata().catch(() => null)]);
      const container = format === MP3 ? 'mp3' : format === MP4 || format === QTFF ? 'mp4' : 'other';
      const facts = await readTrimFacts(container, (start, end) => readRange(url, start, end)).catch(() => ({}));
      return new TrackStream(url, input, track, sampleRate, channelCount, trimFor(container, facts, duration ?? 0));
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  /**
   * The track's audio from `from` seconds (0: its real start) to its real end, in chunks of about half
   * a second. Each call decodes afresh; returning from the generator releases its decoder.
   */
  async *pcm(from = 0): AsyncGenerator<PcmChunk> {
    const cursor = new AudioSampleCursor(this.track);
    const rate = this.sampleRate;
    const begin = this.trim.start + Math.max(0, from), end = this.trim.end;
    let pending: Float32Array[][] = [], pendingFrames = 0;
    const flush = (): PcmChunk => {
      const channels = Array.from({ length: this.channelCount }, (_, c) => {
        const out = new Float32Array(pendingFrames);
        let at = 0;
        for (const part of pending) { const plane = part[c] ?? part[0]!; out.set(plane, at); at += plane.length; }
        return out;
      });
      const chunk = { frames: pendingFrames, channels, sampleRate: rate };
      pending = []; pendingFrames = 0;
      return chunk;
    };
    try {
      let sample = await cursor.seekTo(begin);
      while (sample) {
        const start = sample.timestamp;
        if (start >= end) { sample.close(); break; }
        // Frames before the start (encoder delay, or the seek point) and after the end (padding) are dropped.
        const [first, last] = keptFrames(start, sample.numberOfFrames, sample.sampleRate, begin, end);
        if (last > first) {
          const planes = Array.from({ length: Math.min(sample.numberOfChannels, this.channelCount) }, (_, c) => {
            const plane = new Float32Array(last - first);
            sample!.copyTo(plane, { planeIndex: c, format: 'f32-planar', frameOffset: first, frameCount: last - first });
            return plane;
          });
          pending.push(planes);
          pendingFrames += last - first;
        }
        sample.close();
        if (pendingFrames >= CHUNK_SECONDS * rate) yield flush();
        sample = await cursor.next();
      }
      if (pendingFrames) yield flush();
    } finally {
      await cursor.close();
    }
  }

  close(): void { this.input.dispose(); }
}

async function readRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A server that ignores ranges sends the whole file.
  return response.status === 200 ? bytes.subarray(start, end) : bytes;
}

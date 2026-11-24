// A Mediabunny audio decoder for pages without WebCodecs (an Ether server reached over plain http:
// WebCodecs needs a secure context; Web Audio does not). Packets are gathered into about a second of
// audio, wrapped as a small file of their own (FLAC with its stream header, MP3 frames as they are,
// AAC frames with ADTS headers) and decoded by Web Audio's decodeAudioData at the track's own rate, so
// nothing is resampled. Each batch is decoded with a few of the packets before it, whose audio is then
// dropped: MP3's bit reservoir and AAC's overlap need them, and with them every batch is exactly the
// audio a continuous decoder gives (measured: a batch's sample 0 is its first packet's timestamp in
// Chrome for raw MP3 frames and ADTS, as for FLAC frames).
import { AudioSample, CustomAudioDecoder, type AudioCodec, type EncodedPacket } from 'mediabunny';
import { adtsHeader, flacStreamHeader } from './wrap';

/** Packets decoded ahead of each batch and dropped: enough for MP3's reservoir at low bitrates. */
const WARM_UP: Partial<Record<AudioCodec, number>> = { mp3: 6, aac: 2, flac: 0 };
const BATCH_SECONDS = 1;

export class CompatAudioDecoder extends CustomAudioDecoder {
  private context: OfflineAudioContext | null = null;
  private header: Uint8Array | null = null;
  private pending: EncodedPacket[] = [];
  private history: EncodedPacket[] = [];
  private work: Promise<void> = Promise.resolve();

  static override supports(codec: AudioCodec, config: AudioDecoderConfig): boolean {
    if (typeof AudioDecoder !== 'undefined' || typeof OfflineAudioContext === 'undefined') return false;
    if (codec === 'mp3' || codec === 'flac') return true;
    // AAC-LC only: HE-AAC's implicit SBR would come out at twice the declared rate.
    return codec === 'aac' && (config.codec === 'mp4a.40.2' || config.codec === 'mp4a.40.02' || config.codec === 'mp4a.67');
  }

  init(): void {
    this.context = new OfflineAudioContext(Math.max(1, this.config.numberOfChannels), 1, this.config.sampleRate);
    const description = this.config.description;
    const bytes = description ? new Uint8Array(ArrayBuffer.isView(description) ? description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength) : description) : null;
    if (this.codec === 'flac') {
      if (!bytes) throw new Error('FLAC needs its stream header');
      this.header = flacStreamHeader(bytes);
    } else if (this.codec === 'aac') {
      this.header = bytes;
    }
  }

  decode(packet: EncodedPacket): void {
    this.pending.push(packet);
    const seconds = this.pending.reduce((sum, each) => sum + each.duration, 0);
    if (seconds >= BATCH_SECONDS) this.batch();
  }

  flush(): Promise<void> {
    if (this.pending.length) this.batch();
    return this.work;
  }

  close(): void {
    this.pending = [];
    this.history = [];
    this.context = null;
  }

  private batch(): void {
    const packets = this.pending;
    const warm = this.history.slice(-(WARM_UP[this.codec] ?? 0));
    this.pending = [];
    this.history = [...warm, ...packets].slice(-8);
    this.work = this.work.then(() => this.run(warm, packets)).catch(error => { this.onError(error); });
  }

  private async run(warm: EncodedPacket[], packets: EncodedPacket[]): Promise<void> {
    const context = this.context;
    if (!context || !packets.length) return;
    const all = [...warm, ...packets];
    const parts = all.map(packet => this.codec === 'aac' ? [adtsHeader(this.header, this.config, packet.data.byteLength), packet.data] : [packet.data]).flat();
    if (this.codec === 'flac') parts.unshift(this.header!);
    const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const file = new Uint8Array(size);
    let at = 0;
    for (const part of parts) { file.set(part, at); at += part.byteLength; }
    const decoded = await context.decodeAudioData(file.buffer);
    const rate = decoded.sampleRate;
    // The warm-up packets' audio is dropped; what remains starts at the first packet of the batch.
    const skip = Math.min(decoded.length, Math.round(warm.reduce((sum, packet) => sum + packet.duration, 0) * rate));
    const frames = decoded.length - skip;
    if (frames <= 0) return;
    const channels = decoded.numberOfChannels;
    const data = new Float32Array(frames * channels);
    for (let c = 0; c < channels; c++) data.set(decoded.getChannelData(c).subarray(skip), c * frames);
    this.onSample(new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp: packets[0]!.timestamp }));
  }
}

import type { ByteReader } from '../../core/types';
import { MatroskaSubtitles } from './matroska';
import { MP4Subtitles } from './mp4';
import { readSubtitleDocument, readSubtitleDocumentResponse, SubtitleHTTPError } from './external';
import { assEvent, decodeSubtitleText, tx3gCue, utf8Cue, wvttCues } from './cues';
import { SubtitleCueIndex, parseTextSubtitles, type SubtitleTextCue } from './text';
import { paintPGS, paintText, type SubtitleViewport } from './canvas';
import { PGSDecoder, type PGSDisplay } from './pgs';
import { decodeVobSub, joinVobSubPackets, parseVobSubIdx, type VobSubCue } from './vobsub';
import { createAssOutput, type AssOutput } from './ass';
import { streamingPGS } from './streaming-pgs';
import {
  readSubtitlePreferences,
  validateSubtitlePreferences,
  updateSubtitlePreference,
} from './preferences';
import type {
  SubtitleContainer,
  SubtitleDescription,
  SubtitleFailure,
  SubtitlePacket,
  SubtitlePreferences,
  SubtitleSource,
  SubtitleTrack,
  SubtitleClusterStream,
} from './types';
export interface SubtitleSessionOptions {
  mediaRequests?: import('../../media-auth').MediaRequestPolicy;
  clusterStream?: SubtitleClusterStream;
  surface: HTMLDivElement;
  reader?: ByteReader;
  source: SubtitleSource;
  epoch: number;
  clock: () => number;
  assetBaseURL: string;
  describedTracks?: readonly SubtitleDescription[];
  signal: AbortSignal;
  getViewport?: () => SubtitleViewport;
  onTracks?: (tracks: readonly SubtitleTrack[]) => void;
  onState?: () => void;
  onFailure?: (failure: SubtitleFailure) => void;
}
interface Prepared {
  canvas: HTMLCanvasElement;
  end: number;
  render(time: number): void;
  dispose(): void;
}
const aborted = () => new DOMException('Subtitle operation retired', 'AbortError');
function wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
        clean();
        reject(signal.reason);
      },
      clean = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        clean();
        resolve(value);
      },
      (error) => {
        clean();
        reject(error);
      },
    );
  });
}
function externalTrack(description: SubtitleDescription): SubtitleTrack | null {
  const codec = externalCodec(description);
  if (!codec || !description.delivery || description.delivery.kind === 'embedded') return null;
  return {
    id: description.id,
    serverId: description.id,
    streamIndex: description.streamIndex ?? null,
    containerTrackId: null,
    codec,
    label: (description.label ?? `${description.language ?? 'und'} ${codec.toUpperCase()}`).slice(0, 512),
    language: (description.language ?? 'und').slice(0, 64),
    default: false,
    forced: false,
    delivery: description.delivery,
  };
}
function externalCodec(description: SubtitleDescription): SubtitleTrack['codec'] | null {
  const format =
    description.delivery?.kind === 'external'
      ? description.delivery.format
      : description.codec?.toLowerCase();
  return format === 'webvtt-window' || format === 'vtt'
    ? 'webvtt'
    : format === 'sup' || format === 'hdmv_pgs_subtitle'
      ? 'pgs'
      : format === 'dvd_subtitle' || format === 'dvdsub'
        ? 'vobsub'
      : format === 'subrip'
        ? 'srt'
        : format === 'mov_text'
          ? 'tx3g'
          : ['srt', 'webvtt', 'ass', 'ssa', 'pgs', 'vobsub', 'tx3g'].includes(format ?? '')
            ? (format as SubtitleTrack['codec'])
            : description.delivery?.kind === 'burn-in'
              ? 'unknown'
              : null;
}
function supPackets(bytes: Uint8Array): SubtitlePacket[] {
  const result: SubtitlePacket[] = [];
  for (let at = 0; at < bytes.length; ) {
    if (at + 13 > bytes.length || bytes[at] !== 80 || bytes[at + 1] !== 71)
      throw new Error('Invalid SUP segment');
    const length = bytes[at + 11] * 256 + bytes[at + 12];
    if (at + 13 + length > bytes.length || result.length >= 100000)
      throw new Error('SUP segment exceeds bound');
    result.push({
      time: new DataView(bytes.buffer, bytes.byteOffset + at + 2, 4).getUint32(0) / 90000,
      duration: null,
      data: bytes.subarray(at, at + 13 + length),
    });
    at += 13 + length;
  }
  return result;
}
/** Source-scoped subtitle module. Reader, clock and epoch authority remain with the core. */
export class SubtitleSession {
  tracks: readonly SubtitleTrack[] = [];
  selected: string | null = null;
  pending: string | null = null;
  error: string | null = null;
  private root = new AbortController();
  private operation: AbortController | null = null;
  private container: SubtitleContainer | null = null;
  private discovery: Promise<readonly SubtitleTrack[]> | null = null;
  private active: Prepared | null = null;
  private refreshing = false;
  private epoch: number;
  private serial = 0;
  private frame = 0;
  private disposed = false;
  private preferences = readSubtitlePreferences();
  private documents = new Map<string, Uint8Array>();
  /** Described after the session was created (see describe), and whether it has listed its tracks. */
  private added: SubtitleDescription[] = [];
  private opened = false;
  private fonts: Uint8Array[] | null = null;
  constructor(private options: SubtitleSessionOptions) {
    this.epoch = options.epoch;
    options.signal.addEventListener('abort', this.dispose, { once: true });
    if (options.signal.aborted) this.dispose();
  }
  /** The tracks, once the source is open: the current list, with any described since (see describe). */
  discover(): Promise<readonly SubtitleTrack[]> {
    if (!this.discovery)
      this.discovery = this.open().catch((error) => {
        this.discovery = null;
        throw error;
      });
    return this.discovery.then(() => this.tracks);
  }
  private async open(): Promise<readonly SubtitleTrack[]> {
    const signal = AbortSignal.any([this.root.signal, AbortSignal.timeout(8000)]),
      descriptions = this.options.describedTracks ?? [];
    let container: SubtitleContainer | null = null;
    try {
      if (this.options.reader) {
        const magic = await this.options.reader.read(
          0,
          Math.min(12, await this.options.reader.size(signal)),
          signal,
        );
        if (magic[0] === 0x1a && magic[1] === 0x45 && magic[2] === 0xdf && magic[3] === 0xa3)
          container = await new MatroskaSubtitles(this.options.reader, descriptions).open(signal);
        else if (
          magic.length >= 8 &&
          ['ftyp', 'moov', 'wide', 'free'].includes(String.fromCharCode(...magic.subarray(4, 8)))
        )
          container = await new MP4Subtitles(this.options.reader, descriptions).open(signal);
        else throw new Error('Embedded subtitle container is unsupported');
      }
      signal.throwIfAborted();
      this.container = container;
      const tracks = [...(container?.tracks ?? [])];
      for (const description of [...descriptions, ...this.added]) {
        if (tracks.some((track) => track.serverId === description.id)) continue;
        const track = externalTrack(description);
        if (track) tracks.push(track);
      }
      this.tracks = tracks;
      this.opened = true;
      this.options.onTracks?.(tracks);
      return tracks;
    } catch (error) {
      container?.dispose();
      throw error;
    }
  }
  /** External tracks a newer plan of the same source added (a subtitle downloaded mid-session):
   * they join the list without reopening the source, so the running selection is undisturbed.
   * Whether any track was new. */
  describe(descriptions: readonly SubtitleDescription[]): boolean {
    if (this.disposed) return false;
    const fresh = descriptions.filter(
      (description) =>
        !this.added.some((known) => known.id === description.id) &&
        !this.tracks.some((track) => track.serverId === description.id) &&
        !!externalTrack(description),
    );
    if (!fresh.length) return false;
    // A discovery still opening the source reads these when it lists its tracks.
    this.added.push(...fresh);
    if (this.opened) {
      const tracks = [...this.tracks];
      for (const description of fresh) if (!tracks.some((track) => track.serverId === description.id)) tracks.push(externalTrack(description)!);
      this.tracks = tracks;
      this.options.onTracks?.(tracks);
    }
    return true;
  }
  async select(trackId: string | null): Promise<void> {
    return this.activate(trackId);
  }
  private async activate(trackId: string | null, position?: number): Promise<void> {
    this.ensure();
    const operation = this.begin();
    this.pending = trackId;
    this.selected = null;
    this.error = null;
    this.changed();
    if (trackId === null) return;
    try {
      const tracks = await wait(this.discover(), operation.signal);
      operation.signal.throwIfAborted();
      const track = tracks.find((item) => item.id === trackId);
      if (!track) throw new Error('Subtitle track is unavailable');
      const prepared = await this.prepare(track, position ?? this.now(), operation.signal);
      if (operation.signal.aborted) {
        prepared.dispose();
        operation.signal.throwIfAborted();
      }
      this.install(prepared);
      this.pending = null;
      this.selected = trackId;
      this.changed();
      this.tick();
    } catch (error) {
      if (!operation.signal.aborted) this.fail(trackId, error);
      else if (this.operation === operation) throw error;
    }
  }
  /** Clears immediately, including paused seeks. Borrowed reader/source cache survives. */
  async seek(position: number, epoch: number): Promise<void> {
    this.ensure();
    if (!Number.isFinite(position) || position < 0 || !Number.isSafeInteger(epoch))
      throw new Error('Invalid subtitle seek');
    if (epoch < this.epoch) throw aborted();
    this.epoch = epoch;
    const trackId = this.pending ?? this.selected;
    if (trackId === null) {
      this.begin();
      return;
    }
    await this.activate(trackId, position - this.preferences.offsetSeconds);
  }
  setPreferences(value: SubtitlePreferences | string): void {
    this.preferences =
      typeof value === 'string'
        ? updateSubtitlePreference(this.preferences, value)
        : validateSubtitlePreferences(value);
    const id = this.pending ?? this.selected;
    if (id !== null) void this.activate(id);
    this.changed();
  }
  private now() {
    const time = this.options.clock() - this.preferences.offsetSeconds;
    if (!Number.isFinite(time)) throw new Error('Subtitle clock is unavailable');
    return time;
  }
  private ensure() {
    if (this.disposed) throw aborted();
  }
  private begin() {
    this.operation?.abort(aborted());
    this.operation = new AbortController();
    this.serial++;
    this.refreshing = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.active?.dispose();
    this.active = null;
    return this.operation;
  }
  private changed() {
    this.options.onState?.();
  }
  private install(prepared: Prepared) {
    const old = this.active;
    this.active = prepared;
    old?.dispose();
    this.options.surface.append(prepared.canvas);
  }
  private viewport(): SubtitleViewport {
    const rect = this.options.surface.getBoundingClientRect(),
      v = this.options.getViewport?.() ?? {
        x: 0,
        y: 0,
        width: rect.width,
        height: rect.height,
        bottomInset: 0,
      };
    if (![v.x, v.y, v.width, v.height, v.bottomInset].every(Number.isFinite) || v.width <= 0 || v.height <= 0)
      throw new Error('Subtitle viewport is unavailable');
    return v;
  }
  private canvas(ass: boolean) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.velaSubtitle = '';
    Object.assign(canvas.style, {
      position: 'absolute',
      pointerEvents: 'none',
      zIndex: '2',
      left: '0',
      top: '0',
    });
    let geometry = '';
    let viewport: SubtitleViewport;
    const resize = () => {
      const v = this.viewport(),
        rect = this.options.surface.getBoundingClientRect(),
        dpr = Math.min(2, devicePixelRatio || 1);
      const width = ass ? v.width : rect.width,
        height = ass ? v.height : rect.height,
        scale = Math.min(dpr, 4096 / width, 2160 / height),
        key = [v.x, v.y, width, height, scale].join(':');
      viewport = ass
        ? {
            x: 0,
            y: 0,
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            bottomInset: v.bottomInset * scale,
          }
        : {
            x: v.x * scale,
            y: v.y * scale,
            width: v.width * scale,
            height: v.height * scale,
            bottomInset: v.bottomInset * scale,
          };
      if (key !== geometry) {
        geometry = key;
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        Object.assign(canvas.style, {
          left: `${ass ? v.x : 0}px`,
          top: `${ass ? v.y : 0}px`,
          width: `${width}px`,
          height: `${height}px`,
        });
        return true;
      }
      return false;
    };
    resize();
    return { canvas, resize, viewport: () => viewport };
  }
  private async document(url: string, signal: AbortSignal, max = 8 * 1024 * 1024) {
    const cached = this.documents.get(url);
    if (cached) return cached;
    const bytes = await readSubtitleDocument(url, signal, max, this.options.mediaRequests);
    signal.throwIfAborted();
    if (
      [...this.documents.values()].reduce((n, item) => n + item.length, 0) + bytes.length >
      32 * 1024 * 1024
    )
      throw new Error('Subtitle document cache exceeds bound');
    this.documents.set(url, bytes);
    return bytes;
  }
  private async attachedFonts(signal: AbortSignal) {
    if (this.fonts) return this.fonts;
    const fonts: Uint8Array[] = [];
    let bytes = 0;
    for (const font of this.container?.fonts ?? []) {
      if (!/\.(?:ttf|otf|ttc)$/i.test(font.name) && !/(?:font|truetype|opentype)/i.test(font.mime)) continue;
      bytes += font.size;
      if (bytes > 32 * 1024 * 1024) throw new Error('Subtitle attached fonts exceed bound');
      fonts.push(await font.read(signal));
    }
    signal.throwIfAborted();
    this.fonts = fonts;
    return fonts;
  }
  private async prepare(track: SubtitleTrack, time: number, signal: AbortSignal): Promise<Prepared> {
    signal.throwIfAborted();
    if (track.delivery.kind === 'burn-in') throw new Error('Subtitle track requires server burn-in');
    if (
      track.codec === 'pgs' &&
      track.delivery.kind === 'embedded' &&
      this.container instanceof MatroskaSubtitles
    ) {
      if (!this.options.clusterStream) throw new Error('Streaming subtitle source is unavailable');
      return streamingPGS({
        container: this.container,
        trackId: track.id,
        stream: this.options.clusterStream,
        surface: this.canvas(false),
        position: Math.max(0, time),
        clock: () => this.now(),
        signal,
        onFailure: (error) => {
          if (!signal.aborted) this.fail(track.id, error);
        },
      });
    }
    let packets: SubtitlePacket[] = [],
      end = Infinity,
      fromStart = true,
      content: string | undefined;
    if (track.delivery.kind === 'external') {
      if (track.delivery.format === 'webvtt-window') return this.progressive(track, time, signal);
      const bytes = await this.document(
        track.delivery.url,
        signal,
        track.codec === 'pgs' ? 32 * 1024 * 1024 : 8 * 1024 * 1024,
      );
      if (track.codec === 'pgs') packets = supPackets(bytes);
      else content = decodeSubtitleText(bytes);
    } else {
      if (!this.container) throw new Error('Embedded subtitle reader is unavailable');
      end = Math.max(0, time) + 20;
      const window = await this.container.packets(track.id, Math.max(0, time), end, signal);
      packets = window.packets;
      fromStart = window.fromStart;
      // Text windows need not be complete from 0:00: a mid-file window carries
      // the container's bounded lookback, which covers any plausible text cue.
      if (
        packets.length > 8192 ||
        packets.reduce((n, packet) => n + packet.data.length, 0) > 16 * 1024 * 1024
      )
        throw new Error('Subtitle cue window exceeds bound');
    }
    signal.throwIfAborted();
    if (track.codec === 'ass' || track.codec === 'ssa') {
      const header =
        content ?? decodeSubtitleText(this.container!.configuration(track.id) ?? new Uint8Array());
      const events = content === undefined ? packets.map(assEvent) : undefined,
        fonts = content === undefined ? await this.attachedFonts(signal) : [];
      const surface = this.canvas(true);
      let output: AssOutput | undefined;
      try {
        output = await createAssOutput({
          canvas: surface.canvas,
          content: header,
          events,
          fonts,
          assetBaseURL: this.options.assetBaseURL,
          signal,
          onFailure: () => {
            if (!signal.aborted) this.fail(track.id, new Error('ASS renderer failed'));
          },
        });
        signal.throwIfAborted();
        const renderer = output;
        return {
          canvas: surface.canvas,
          end,
          render: (stamp) => {
            if (surface.resize()) renderer.resize(surface.canvas.width, surface.canvas.height);
            renderer.render(stamp);
          },
          dispose: () => {
            renderer.dispose();
            surface.canvas.remove();
          },
        };
      } catch (error) {
        output?.dispose();
        surface.canvas.remove();
        throw error;
      }
    }
    const surface = this.canvas(false),
      context = surface.canvas.getContext('2d');
    if (!context) throw new Error('Subtitle overlay canvas unavailable');
    let draw: (stamp: number) => void;
    if (track.codec === 'pgs') {
      const decoder = new PGSDecoder();
      let index = 0,
        display: PGSDisplay | null = null;
      const advance = (stamp: number) => {
        while (index < packets.length && packets[index].time <= stamp) {
          const packet = packets[index++];
          for (const value of decoder.push(packet.data, packet.time)) display = value;
        }
      };
      advance(time);
      if (!fromStart && !display) throw new Error('Exact PGS seek acquisition is unavailable');
      draw = (stamp) => {
        advance(stamp);
        if (display) paintPGS(context, display, surface.viewport());
      };
    } else if (track.codec === 'vobsub') {
      if (!this.container) throw new Error('VobSub subtitles must be embedded');
      const configuration = parseVobSubIdx(this.container.configuration(track.id));
      const cues = joinVobSubPackets(packets)
        .map((packet) =>
          decodeVobSub(packet.data, packet.time, configuration, packet.duration === null ? null : packet.time + packet.duration),
        )
        .filter((cue): cue is VobSubCue => cue !== null)
        .sort((a, b) => a.start - b.start);
      draw = (stamp) => {
        // The latest subpicture that has started and not stopped; a newer one replaces it.
        let active: VobSubCue | undefined;
        for (const cue of cues) if (cue.start <= stamp && stamp < cue.end) active = cue;
        if (active) paintPGS(context, active.display, surface.viewport());
      };
    } else {
      let cues: SubtitleTextCue[];
      if (content !== undefined)
        cues = parseTextSubtitles(content, track.codec === 'webvtt' ? 'webvtt' : 'srt');
      else
        cues = packets.flatMap((packet) =>
          track.codec === 'tx3g'
            ? [tx3gCue(packet, this.container!.configuration(track.id))].filter(
                (cue): cue is SubtitleTextCue => cue !== null,
              )
            : track.codec === 'webvtt'
              ? wvttCues(packet)
              : [utf8Cue(packet)],
        );
      const index = new SubtitleCueIndex(cues.sort((a, b) => a.start - b.start || a.end - b.end));
      draw = (stamp) => paintText(context, index.active(stamp), this.preferences, surface.viewport());
    }
    let last = NaN;
    return {
      canvas: surface.canvas,
      end,
      render: (stamp) => {
        const resized = surface.resize();
        if (stamp !== last || resized) {
          context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
          draw(stamp);
          last = stamp;
        }
      },
      dispose: () => surface.canvas.remove(),
    };
  }
  private progressive(track: SubtitleTrack, time: number, signal: AbortSignal): Prepared {
    if (track.delivery.kind !== 'external') throw new Error('Invalid progressive subtitle track');
    const url = track.delivery.url,
      surface = this.canvas(false),
      context = surface.canvas.getContext('2d');
    if (!context) throw new Error('Subtitle overlay canvas unavailable');
    const controller = new AbortController(),
      live = AbortSignal.any([signal, controller.signal]);
    let base = Math.max(0, Math.floor(time * 1000)),
      nextPoll = 0,
      inflight = false,
      complete = false,
      revision = 0,
      lastRevision = -1,
      last = NaN;
    const cues = new Map<string, SubtitleTextCue>();
    let index = new SubtitleCueIndex([]);
    const fetchWindow = async (from: number) => {
      const target = new URL(url, location.href);
      target.searchParams.set('ether_window', '1');
      target.searchParams.set('from_ms', String(from));
      try {
        const response = await readSubtitleDocumentResponse(
          target.href,
          live,
          8 * 1024 * 1024,
          this.options.mediaRequests,
        );
        live.throwIfAborted();
        const parsed = parseTextSubtitles(decodeSubtitleText(response.bytes), 'webvtt');
        if (response.complete === true) cues.clear();
        for (const cue of parsed) {
          const key = JSON.stringify([cue.start, cue.end, cue.runs]);
          cues.set(key, cue);
        }
        let size = 0;
        for (const [key, cue] of cues) {
          if (cue.end < base / 1000) cues.delete(key);
          else size += key.length;
        }
        if (cues.size > 10000 || size > 8 * 1024 * 1024)
          throw new Error('Progressive subtitle window exceeds bound');
        index = new SubtitleCueIndex([...cues.values()].sort((a, b) => a.start - b.start || a.end - b.end));
        complete = response.complete === true;
        revision++;
      } catch (error) {
        if (error instanceof SubtitleHTTPError && error.status === 503) return;
        throw error;
      }
    };
    const poll = (stamp: number) => {
      if (complete || inflight || performance.now() < nextPoll) return;
      if (stamp * 1000 >= base + 120000) base = Math.floor(stamp * 1000);
      inflight = true;
      nextPoll = performance.now() + 1000;
      (async () => {
        await fetchWindow(base);
        if (!complete && stamp * 1000 >= base + 100000) await fetchWindow(base + 120000);
      })()
        .catch((error) => {
          if (!live.aborted) this.fail(track.id, error);
        })
        .finally(() => {
          inflight = false;
        });
    };
    return {
      canvas: surface.canvas,
      end: Infinity,
      render: (stamp) => {
        poll(stamp);
        const resized = surface.resize();
        if (last !== stamp || resized || lastRevision !== revision) {
          context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
          paintText(context, index.active(stamp), this.preferences, surface.viewport());
          last = stamp;
          lastRevision = revision;
        }
      },
      dispose: () => {
        controller.abort(aborted());
        surface.canvas.remove();
        cues.clear();
      },
    };
  }
  private tick = () => {
    if (this.disposed || !this.active || !this.selected) return;
    const operation = this.operation!,
      serial = this.serial;
    try {
      const time = this.now();
      if (time > this.active.end) {
        this.fail(this.selected, new Error('Subtitle acquisition did not keep up'));
        return;
      }
      this.active.render(time);
      if (time >= this.active.end - 6 && !this.refreshing) {
        const track = this.tracks.find((item) => item.id === this.selected)!;
        this.refreshing = true;
        this.prepare(track, time, operation.signal).then(
          (prepared) => {
            if (this.disposed || this.serial !== serial || operation.signal.aborted) {
              prepared.dispose();
              return;
            }
            this.install(prepared);
            this.refreshing = false;
          },
          (error) => {
            if (!operation.signal.aborted && this.serial === serial) this.fail(track.id, error);
          },
        );
      }
      this.frame = requestAnimationFrame(this.tick);
    } catch (error) {
      this.fail(this.selected, error);
    }
  };
  private fail(trackId: string, error: unknown) {
    const track = this.tracks.find((item) => item.id === trackId);
    this.begin();
    this.selected = null;
    this.pending = null;
    this.error = (error instanceof Error ? error.message : 'Subtitle preparation failed')
      .replace(/https?:\/\/\S+/g, '[source]')
      .slice(0, 512);
    this.changed();
    this.options.onFailure?.({
      trackId,
      serverId: track?.serverId,
      code: 'subtitle-unavailable',
      message: this.error,
    });
  }
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.root.abort(aborted());
    this.begin();
    this.container?.dispose();
    this.container = null;
    this.documents.clear();
    this.fonts = null;
    this.options.signal.removeEventListener('abort', this.dispose);
    this.tracks = [];
    this.selected = null;
    this.pending = null;
  };
}

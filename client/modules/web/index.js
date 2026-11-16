// client/player/hls.ts
function parsePlaylist(text, base) {
  if (!text.trimStart().startsWith("#EXTM3U"))
    throw new Error("Invalid HLS playlist");
  if (/#EXT-X-(KEY|BYTERANGE|DISCONTINUITY|STREAM-INF)/m.test(text))
    throw new Error("Requires clear, continuous fMP4 media playlist (not master/TS/encrypted/byte-range HLS)");
  let sequence = 0, start = 0, duration = 0, init = "", targetDuration = 6;
  const segments = [];
  let gap = false;
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:"))
      sequence = Number(line.split(":")[1]);
    else if (line.startsWith("#EXT-X-TARGETDURATION:"))
      targetDuration = Number(line.split(":")[1]);
    else if (line === "#EXT-X-GAP")
      gap = true;
    else if (line.startsWith("#EXT-X-MAP:")) {
      if (/BYTERANGE=/.test(line))
        throw new Error("Byte-range initialization is unsupported");
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (!uri)
        throw new Error("Missing initialization URI");
      init = new URL(uri, base).href;
    } else if (line.startsWith("#EXTINF:"))
      duration = Number(line.slice(8).split(",")[0]);
    else if (line && !line.startsWith("#")) {
      if (!init || !Number.isFinite(duration) || duration <= 0)
        throw new Error("Invalid fMP4 segment");
      segments.push({ sequence: sequence++, url: new URL(line, base).href, start, duration, init, gap });
      start += duration;
      duration = 0;
      gap = false;
    }
  }
  if (!Number.isFinite(sequence) || !Number.isFinite(targetDuration) || targetDuration <= 0 || !segments.length)
    throw new Error("Empty/invalid playlist");
  return { segments, ended: text.includes("#EXT-X-ENDLIST"), targetDuration };
}

// client/player/session.ts
class SessionController {
  sessionId = "";
  source = 0;
  seek = 0;
  abort = new AbortController;
  supersede() {
    this.abort.abort();
    this.abort = new AbortController;
  }
  start(id, source = 0, seek = 0) {
    this.supersede();
    this.sessionId = id;
    this.source = source;
    this.seek = seek;
    return this.token();
  }
  changeSource(increment = true) {
    this.supersede();
    if (increment)
      this.source++;
    return this.token();
  }
  changeSeek() {
    this.supersede();
    this.seek++;
    return this.token();
  }
  token() {
    return { sessionId: this.sessionId, source: this.source, seek: this.seek, signal: this.abort.signal };
  }
  current(t) {
    return !t.signal.aborted && t.sessionId === this.sessionId && t.source === this.source && t.seek === this.seek;
  }
  cancel() {
    this.supersede();
  }
  stop() {
    this.supersede();
    this.sessionId = "";
    this.source++;
  }
}
function cancelled(signal) {
  if (signal.aborted)
    throw new DOMException("Superseded playback work", "AbortError");
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    cancelled(signal);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// client/player/buffer.ts
class PlaybackFault extends Error {
  kind;
  retryable;
  constructor(message, kind, retryable = false) {
    super(message);
    this.kind = kind;
    this.retryable = retryable;
  }
}
function mutation(buffer, signal, operation) {
  return new Promise((resolve, reject) => {
    cancelled(signal);
    const clean = () => {
      buffer.removeEventListener("updateend", done);
      buffer.removeEventListener("error", error);
      signal.removeEventListener("abort", abort);
    };
    const done = () => {
      clean();
      resolve();
    };
    const error = () => {
      clean();
      reject(new PlaybackFault("SourceBuffer rejected media", "decoder"));
    };
    const abort = () => {
      clean();
      reject(new DOMException("Aborted", "AbortError"));
    };
    buffer.addEventListener("updateend", done, { once: true });
    buffer.addEventListener("error", error, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    try {
      operation();
    } catch (e) {
      clean();
      reject(e);
    }
  });
}
async function appendBuffer(buffer, bytes, video, signal) {
  try {
    await mutation(buffer, signal, () => buffer.appendBuffer(bytes));
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "QuotaExceededError")
      throw error;
    const end = video.currentTime - 10;
    if (end <= 0)
      throw new PlaybackFault("Insufficient media buffer quota", "source");
    await mutation(buffer, signal, () => buffer.remove(0, end));
    await mutation(buffer, signal, () => buffer.appendBuffer(bytes));
  }
}

// client/player/audio.ts
class AudioBuffer {
  media;
  video;
  renditions;
  read;
  supported;
  buffer;
  current;
  list;
  nextSequence = -1;
  init = "";
  pending;
  audible;
  constructor(media, video, renditions, read, supported) {
    this.media = media;
    this.video = video;
    this.renditions = renditions;
    this.read = read;
    this.supported = supported;
  }
  get trackId() {
    if (this.audible && this.video.currentTime < this.audible.boundary)
      return this.audible.before;
    return this.current?.trackId ?? null;
  }
  get pendingTrackId() {
    return this.pending?.trackId ?? (this.audible && this.video.currentTime < this.audible.boundary ? this.audible.after : null);
  }
  available(group) {
    return this.renditions.filter((r) => r.groupId === group && this.supported(r.mimeType) && (!this.current || r.mimeType === this.current.mimeType || !!this.buffer?.changeType)).map((r) => r.trackId);
  }
  dispose() {
    this.pending?.abort.abort();
    this.pending?.reject(new DOMException("Audio selection superseded", "AbortError"));
    this.pending = undefined;
    if (this.buffer?.updating)
      try {
        this.buffer.abort();
      } catch {}
  }
  async playlist(track, anchor, signal) {
    const list = parsePlaylist(new TextDecoder().decode(await this.read(track.url, signal)), track.url);
    const match = list.segments.find((s) => anchor.segments.some((a) => a.sequence === s.sequence));
    if (!match)
      throw new PlaybackFault("Audio playlist has no shared timeline boundary", "source");
    const offset = anchor.segments.find((s) => s.sequence === match.sequence).start - match.start;
    list.segments.forEach((s) => {
      s.start += offset;
    });
    return list;
  }
  async start(group, trackId, anchor, signal) {
    const track = this.renditions.find((r) => r.groupId === group && (trackId === null || r.trackId === trackId));
    if (!track || !this.supported(track.mimeType))
      throw new PlaybackFault("Selected audio rendition is not supported", "source");
    this.current = track;
    this.list = await this.playlist(track, anchor, signal);
    this.buffer = this.media.addSourceBuffer(track.mimeType);
  }
  select(trackId) {
    if (!this.current || !this.available(this.current.groupId).includes(trackId))
      return Promise.reject(new Error("Audio track is outside the active rendition group"));
    this.pending?.abort.abort();
    this.pending?.reject(new DOMException("Audio selection superseded", "AbortError"));
    if (trackId === this.current.trackId) {
      this.pending = undefined;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.pending = { trackId, abort: new AbortController, resolve, reject };
    });
  }
  async append(segment, signal) {
    if (this.init !== segment.init) {
      await appendBuffer(this.buffer, await this.read(segment.init, signal), this.video, signal);
      this.init = segment.init;
    }
    await appendBuffer(this.buffer, await this.read(segment.url, signal), this.video, signal);
    this.nextSequence = segment.sequence + 1;
  }
  async fill(from, until, anchor, signal) {
    if (!this.current || !this.list)
      return;
    if (!this.list.ended && !this.list.segments.some((s) => s.start + s.duration >= until - 0.1))
      this.list = await this.playlist(this.current, anchor, signal);
    const shared = this.list.segments.find((s) => anchor.segments.some((a) => a.sequence === s.sequence));
    if (shared) {
      const offset = anchor.segments.find((s) => s.sequence === shared.sequence).start - shared.start;
      this.list.segments.forEach((s) => {
        s.start += offset;
      });
    }
    const segments = this.list.segments.filter((s) => s.start + s.duration > from + 0.001 && s.start < until - 0.001);
    if (!segments.length)
      throw new PlaybackFault("Audio does not cover the video boundary", "source");
    for (const segment of segments) {
      if (segment.sequence < this.nextSequence)
        continue;
      if (segment.gap)
        throw new PlaybackFault("Publisher marked audio unavailable", "source");
      await this.append(segment, signal);
    }
  }
  async applySelection(anchor, signal) {
    const pending = this.pending;
    if (!pending || !this.current || !this.buffer || !this.buffer.buffered.length)
      return;
    let mutated = false;
    try {
      const track = this.renditions.find((r) => r.groupId === this.current.groupId && r.trackId === pending.trackId);
      const requestSignal = AbortSignal.any([signal, pending.abort.signal]);
      const list = await this.playlist(track, anchor, requestSignal);
      const boundary = list.segments.find((s) => s.start > this.video.currentTime + 0.25);
      if (!boundary || !anchor.segments.some((s) => Math.abs(s.start - boundary.start) <= 0.1))
        throw new Error("No aligned future audio switch boundary");
      const end = this.buffer.buffered.length ? this.buffer.buffered.end(this.buffer.buffered.length - 1) : boundary.start + boundary.duration;
      const segments = list.segments.filter((s) => s.start >= boundary.start && s.start < Math.max(end, boundary.start + boundary.duration));
      const init = await this.read(boundary.init, requestSignal);
      const bytes = [];
      for (const segment of segments) {
        if (segment.gap)
          throw new Error("Replacement audio contains an upstream gap");
        bytes.push(await this.read(segment.url, requestSignal));
      }
      cancelled(requestSignal);
      if (this.video.currentTime + 0.05 >= boundary.start)
        throw new Error("Audio switch boundary passed during loading; select again");
      if (track.mimeType !== this.current.mimeType && !this.buffer.changeType)
        throw new Error("Browser cannot change audio codec");
      const before = this.trackId;
      mutated = true;
      await mutation(this.buffer, signal, () => this.buffer.remove(boundary.start, Infinity));
      if (track.mimeType !== this.current.mimeType)
        this.buffer.changeType(track.mimeType);
      this.buffer.appendWindowStart = boundary.start;
      await appendBuffer(this.buffer, init, this.video, signal);
      for (const data of bytes)
        await appendBuffer(this.buffer, data, this.video, signal);
      this.current = track;
      this.list = list;
      this.init = boundary.init;
      this.nextSequence = segments.at(-1).sequence + 1;
      this.audible = { before, after: track.trackId, boundary: boundary.start };
      if (this.pending === pending)
        this.pending = undefined;
      pending.resolve();
    } catch (error) {
      if (this.pending === pending)
        this.pending = undefined;
      pending.reject(error);
      cancelled(signal);
      if (mutated)
        throw error;
    }
  }
  async evict(before, signal) {
    if (before > 0 && this.buffer?.buffered.length && this.buffer.buffered.start(0) < before - 5)
      await mutation(this.buffer, signal, () => this.buffer.remove(0, before));
  }
}
// client/player/abr.ts
class BandwidthEstimator {
  fast = 0;
  slow = 0;
  samples = [];
  get history() {
    return [...this.samples];
  }
  get bps() {
    return this.fast ? Math.min(this.fast, this.slow) : null;
  }
  sample(bytes, elapsedMs, cached) {
    if (cached || bytes < 16384 || elapsedMs < 50)
      return;
    const rate = bytes * 8000 / elapsedMs, seconds = elapsedMs / 1000;
    const blend = (old, halfLife) => old ? old + (rate - old) * (1 - 2 ** (-seconds / halfLife)) : rate;
    this.fast = blend(this.fast, 3);
    this.slow = blend(this.slow, 10);
    this.samples.push(this.bps);
    if (this.samples.length > 30)
      this.samples.shift();
  }
}

class AdaptiveBitrate {
  upSince = 0;
  manual = null;
  expensive = false;
  downSince = 0;
  choose(ladder, current, buffer, throughput, dropRatio, now) {
    const sorted = [...ladder].sort((a, b) => a.bandwidth - b.bandwidth);
    if (!sorted.length)
      throw new Error("No playable renditions");
    const manual = sorted.find((r) => r.id === this.manual);
    if (manual)
      return manual;
    const budget = (throughput ?? sorted[0].bandwidth) * (buffer < 4 ? 0.55 : buffer < 12 ? 0.7 : 0.85);
    let next = sorted.filter((r) => r.bandwidth <= budget).at(-1) ?? sorted[0];
    if (buffer < 2)
      next = sorted[0];
    if (dropRatio > 0.05 && current)
      next = sorted.filter((r) => r.bandwidth < current.bandwidth).at(-1) ?? sorted[0];
    if (this.expensive && current && next.bandwidth < current.bandwidth) {
      if (buffer >= 8) {
        this.downSince = 0;
        return current;
      }
      if (!this.downSince)
        this.downSince = now;
      if (now - this.downSince < 5000)
        return current;
      this.downSince = 0;
    } else
      this.downSince = 0;
    if (current && next.bandwidth > current.bandwidth) {
      if (dropRatio > 0.01) {
        this.upSince = 0;
        return current;
      }
      if (!this.upSince)
        this.upSince = now;
      if (buffer < (this.expensive ? 24 : 12) || now - this.upSince < (this.expensive ? 30000 : 12000))
        return current;
      this.upSince = 0;
      return sorted.find((r) => r.bandwidth > current.bandwidth) ?? current;
    }
    this.upSince = 0;
    return next;
  }
  abandon(current, lower, duration, received, elapsed, buffer) {
    if (elapsed < 1000 || lower.bandwidth >= current.bandwidth || buffer > 8 || received <= 0)
      return false;
    const rate = received * 8 / (elapsed / 1000);
    const remaining = Math.max(0, current.bandwidth * duration - received * 8) / rate;
    const replacement = lower.bandwidth * duration / rate + 0.25;
    return remaining > buffer && replacement < remaining && replacement < Math.max(buffer, 1);
  }
}

// client/player/model.ts
function codecKnown(rendition) {
  return rendition.codecStatus !== "pending" && /codecs="[^"]+"/.test(rendition.mime);
}

// client/player/pipeline.ts
function mediaSourceClass() {
  return globalThis.ManagedMediaSource ?? globalThis.MediaSource;
}
function bufferAhead(video) {
  for (let i = 0;i < video.buffered.length; i++)
    if (video.currentTime >= video.buffered.start(i) - 0.05 && video.currentTime < video.buffered.end(i))
      return video.buffered.end(i) - video.currentTime;
  return 0;
}

class SegmentPipeline {
  video;
  onRendition;
  refreshPlan;
  fetcher;
  bandwidth = new BandwidthEstimator;
  abr = new AdaptiveBitrate;
  ladder = [];
  updateRenditions(ladder) {
    this.ladder = [...ladder];
  }
  playable() {
    const MS = mediaSourceClass();
    return this.ladder.filter((r) => codecKnown(r) && MS?.isTypeSupported(r.mime));
  }
  get qualityIds() {
    return this.playable().filter((r) => !this.current || r.mime === this.current.mime && r.audioGroupId === this.current.audioGroupId).map((r) => r.id);
  }
  async verified(expected, signal) {
    const started = performance.now(), deadline = started + 2000;
    let refreshed = false;
    for (;; ) {
      cancelled(signal);
      const rendition = this.ladder.find((r) => r.id === expected.id && r.url === expected.url);
      if (!rendition)
        throw new PlaybackFault("Prepared rendition identity changed", "source");
      if (codecKnown(rendition)) {
        if (!mediaSourceClass()?.isTypeSupported(rendition.mime))
          throw new PlaybackFault("Prepared codec is not supported by this browser", "source");
        return rendition;
      }
      if (performance.now() >= deadline)
        throw new PlaybackFault("Codec verification did not arrive after initialization", "source");
      if (!refreshed && performance.now() - started >= 500) {
        refreshed = true;
        this.refreshPlan();
      }
      await delay(100, signal);
    }
  }
  current;
  audioRenditions = [];
  initialAudioTrackId = null;
  audio;
  get audioTrackId() {
    return this.audio?.trackId ?? null;
  }
  get pendingAudioTrackId() {
    return this.audio?.pendingTrackId ?? null;
  }
  get audioTracks() {
    return this.current?.audioGroupId ? this.audio?.available(this.current.audioGroupId) ?? [] : [];
  }
  selectAudio(trackId) {
    return this.audio ? this.audio.select(trackId) : Promise.reject(new Error("No alternate audio buffer"));
  }
  liveTargetSeconds = 12;
  livePlaybackRate = 1;
  expensiveSwitches = false;
  initialRenditionId;
  timelineOriginSeconds = 0;
  liveWindowStart = null;
  maxLiveDrift = 45;
  publishedEdge = null;
  publishedStart = null;
  retrying = false;
  networkRetries = 0;
  nominalSegmentSeconds = 2;
  publicationPending = false;
  upstreamGap = false;
  segmentStarted = null;
  segmentDuration = 0;
  get delivery() {
    if (this.upstreamGap)
      return "upstream-gap";
    if (this.segmentStarted !== null && (this.retrying || performance.now() - this.segmentStarted > Math.max(1000, this.segmentDuration * 1000)))
      return "segment-delayed";
    if (this.publicationPending)
      return "waiting-for-publication";
    return this.publishedEdge === null ? "unknown" : "available";
  }
  published(list) {
    this.nominalSegmentSeconds = list.targetDuration;
    this.publishedStart = list.segments[0]?.start ?? null;
    const last = list.segments.at(-1);
    this.publishedEdge = last ? last.start + last.duration : null;
  }
  streamingAllowed = true;
  request;
  detachStreaming;
  media;
  objectUrl;
  buffer;
  dropPrevious = { dropped: 0, total: 0 };
  dropRatio = 0;
  constructor(video, onRendition, refreshPlan, fetcher = (...args) => fetch(...args)) {
    this.video = video;
    this.onRendition = onRendition;
    this.refreshPlan = refreshPlan;
    this.fetcher = fetcher;
  }
  dispose() {
    this.audio?.dispose();
    this.audio = undefined;
    this.detachStreaming?.();
    this.detachStreaming = undefined;
    this.request?.abort();
    this.request = undefined;
    if (this.buffer?.updating) {
      try {
        this.buffer.abort();
      } catch {}
    }
    if (this.objectUrl)
      URL.revokeObjectURL(this.objectUrl);
    this.buffer = undefined;
    this.media = undefined;
    this.objectUrl = undefined;
  }
  async fetchBytes(url, signal, progress, timeoutMs = 12000) {
    const started = performance.now();
    const response = await this.fetcher(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      credentials: "same-origin"
    });
    if (!response.ok)
      throw new PlaybackFault(`Media HTTP ${response.status}`, "network", response.status === 408 || response.status === 429 || response.status >= 500 || response.status === 404);
    const chunks = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;; ) {
          const { done, value } = await reader.read();
          if (done)
            break;
          size += value.byteLength;
          if (size > 64 * 1024 * 1024)
            throw new PlaybackFault("Segment exceeds 64 MiB budget", "source");
          chunks.push(value);
          progress?.(size, performance.now() - started);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
    }
    cancelled(signal);
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    const timing = performance.getEntriesByName(response.url).at(-1);
    const noStore = /(?:^|,)\s*no-store\b/i.test(response.headers.get("Cache-Control") ?? "");
    const sameOrigin = new URL(response.url, document.baseURI).origin === location.origin;
    const cached = response.headers.get("X-Cache")?.toLowerCase() === "hit" || !noStore && sameOrigin && !!(timing && timing.transferSize === 0 && timing.decodedBodySize > 0);
    this.bandwidth.sample(size, performance.now() - started, cached);
    return bytes.buffer;
  }
  async bytes(url, signal, progress) {
    const deadline = performance.now() + 12000;
    try {
      for (let attempt = 0;; attempt++) {
        try {
          return await this.fetchBytes(url, signal, progress);
        } catch (error) {
          cancelled(signal);
          const retryable = error instanceof TypeError || error instanceof PlaybackFault && error.retryable;
          if (!retryable || attempt >= 2 || performance.now() >= deadline)
            throw error;
          this.retrying = true;
          this.networkRetries++;
          await delay(300 * 2 ** attempt, signal);
        }
      }
    } finally {
      this.retrying = false;
    }
  }
  async playlist(r, signal) {
    return parsePlaylist(new TextDecoder().decode(await this.bytes(r.url, signal)), new URL(r.url, document.baseURI).href);
  }
  append(bytes, signal) {
    return appendBuffer(this.buffer, bytes, this.video, signal);
  }
  async run(ladder, position, live, signal) {
    const MS = mediaSourceClass();
    if (!MS)
      throw new PlaybackFault("MediaSource unavailable", "source");
    this.updateRenditions(ladder);
    const candidates = ladder.filter((r) => !codecKnown(r) || MS.isTypeSupported(r.mime));
    if (!candidates.length)
      throw new PlaybackFault("No supported segmented codec", "source");
    const media = this.media = new MS;
    this.streamingAllowed = !("streaming" in media) || !!media.streaming;
    const start = () => {
      this.streamingAllowed = true;
    };
    const stop = () => {
      this.streamingAllowed = false;
      this.request?.abort(new DOMException("Browser paused managed media loading", "AbortError"));
    };
    media.addEventListener("startstreaming", start);
    media.addEventListener("endstreaming", stop);
    this.detachStreaming = () => {
      media.removeEventListener("startstreaming", start);
      media.removeEventListener("endstreaming", stop);
    };
    this.video.disableRemotePlayback = true;
    this.objectUrl = URL.createObjectURL(media);
    this.video.src = this.objectUrl;
    await new Promise((resolve, reject) => {
      const clean = () => {
        media.removeEventListener("sourceopen", open);
        signal.removeEventListener("abort", abort);
      };
      const open = () => {
        clean();
        resolve();
      };
      const abort = () => {
        clean();
        reject(new DOMException("Aborted", "AbortError"));
      };
      media.addEventListener("sourceopen", open, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted)
        abort();
    });
    cancelled(signal);
    let rendition = candidates.find((r) => r.id === this.initialRenditionId) ?? candidates[0];
    this.abr.expensive = this.expensiveSwitches;
    let startupBuffered = false;
    let list = await this.playlist(rendition, signal);
    if (!live && this.timelineOriginSeconds)
      list.segments.forEach((s) => {
        s.start += this.timelineOriginSeconds;
      });
    if (live) {
      list.segments.forEach((s) => {
        s.start += this.liveWindowStart ?? 0;
      });
      this.published(list);
    }
    let preparedInit;
    if (!codecKnown(rendition)) {
      const url = list.segments.find((s) => s.start + s.duration > position)?.init ?? list.segments[0].init;
      preparedInit = { url, bytes: await this.fetchBytes(url, signal, undefined, 50000) };
      rendition = await this.verified(rendition, signal);
    }
    this.current = rendition;
    this.onRendition(rendition);
    this.buffer = media.addSourceBuffer(rendition.mime);
    if (rendition.audioGroupId) {
      this.audio = new AudioBuffer(media, this.video, this.audioRenditions, (url, signal) => this.bytes(url, signal), (mime) => MS.isTypeSupported(mime));
      await this.audio.start(rendition.audioGroupId, this.initialAudioTrackId, list, signal);
    }
    if (!live && list.ended)
      media.duration = this.timelineOriginSeconds + list.segments.reduce((sum, s) => sum + s.duration, 0);
    const liveStart = Math.max(list.segments[0].start, (this.publishedEdge ?? 0) - this.liveTargetSeconds);
    let next = live ? list.segments.find((s) => s.start + s.duration > (position > 0 ? position : liveStart)) ?? list.segments.at(-1) : list.segments.find((s) => s.start + s.duration > position) ?? (list.ended && position === media.duration ? list.segments.at(-1) : undefined);
    if (!next)
      throw new PlaybackFault("Position outside source timeline", "source");
    let sequence = next.sequence, init = "", first = true;
    while (!signal.aborted) {
      await this.audio?.applySelection(list, signal);
      const ahead = bufferAhead(this.video);
      const target = live ? this.liveTargetSeconds + this.nominalSegmentSeconds * 2 : 30;
      if (ahead >= target || !this.streamingAllowed) {
        await delay(250, signal);
        continue;
      }
      const quality = this.video.getVideoPlaybackQuality?.();
      if (quality) {
        const total = quality.totalVideoFrames - this.dropPrevious.total;
        if (total >= 30) {
          this.dropRatio = Math.max(0, quality.droppedVideoFrames - this.dropPrevious.dropped) / total;
          this.dropPrevious = { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames };
        }
      }
      if (ahead >= 12 && this.video.readyState >= 3 && !this.video.paused)
        startupBuffered = true;
      const playable = this.playable();
      const proposed = this.abr.choose(playable.filter((r) => r.mime === rendition.mime && r.audioGroupId === rendition.audioGroupId), rendition, ahead, this.bandwidth.bps, this.dropRatio, performance.now());
      const choice = startupBuffered || this.abr.manual ? proposed : rendition;
      if (choice.id !== rendition.id) {
        const candidate = await this.playlist(choice, signal);
        const compatible = candidate.segments.find((s) => s.sequence === sequence);
        if (compatible) {
          const anchor = candidate.segments.find((s) => list.segments.some((old) => old.sequence === s.sequence));
          if (!anchor)
            throw new PlaybackFault("Rendition lost timeline overlap", "source");
          const offset = list.segments.find((s) => s.sequence === anchor.sequence).start - anchor.start;
          candidate.segments.forEach((s) => {
            s.start += offset;
          });
          rendition = choice;
          list = candidate;
          if (live)
            this.published(list);
          this.current = choice;
          this.onRendition(choice);
          init = "";
        }
      }
      next = list.segments.find((s) => s.sequence === sequence);
      if (!next) {
        if (list.ended) {
          if (media.readyState === "open")
            media.endOfStream();
          if (!this.audio)
            return;
          await delay(250, signal);
          continue;
        }
        this.publicationPending = true;
        await delay(Math.max(500, list.targetDuration * 500), signal);
        const fresh = await this.playlist(rendition, signal);
        const overlap = fresh.segments.find((s) => list.segments.some((old) => old.sequence === s.sequence));
        if (!overlap)
          throw new PlaybackFault("Live playlist lost timeline overlap", "source");
        const offset = list.segments.find((s) => s.sequence === overlap.sequence).start - overlap.start;
        fresh.segments.forEach((s) => {
          s.start += offset;
        });
        list = fresh;
        if (live)
          this.published(list);
        continue;
      }
      this.publicationPending = false;
      if (next.gap) {
        this.upstreamGap = true;
        throw new PlaybackFault("Publisher marked segment unavailable (EXT-X-GAP)", "source");
      }
      if (next.init !== init) {
        await this.append(preparedInit?.url === next.init ? preparedInit.bytes : await this.bytes(next.init, signal), signal);
        init = next.init;
        preparedInit = undefined;
      }
      this.segmentStarted = performance.now();
      this.segmentDuration = next.duration;
      const request = this.request = new AbortController;
      const abort = () => request.abort();
      signal.addEventListener("abort", abort, { once: true });
      let abandon;
      let bytes;
      const timeout = setTimeout(() => request.abort(new PlaybackFault("Segment deadline exceeded", "network", true)), 15000);
      try {
        bytes = await this.bytes(next.url, request.signal, (received, elapsed) => {
          const lower = [...playable].filter((r) => r.mime === rendition.mime && r.audioGroupId === rendition.audioGroupId && r.bandwidth < rendition.bandwidth).sort((a, b) => a.bandwidth - b.bandwidth)[0];
          if (startupBuffered && !this.expensiveSwitches && lower && this.abr.abandon(rendition, lower, next.duration, received, elapsed, bufferAhead(this.video))) {
            abandon = lower;
            request.abort();
          }
        });
      } catch (error) {
        cancelled(signal);
        if (!this.streamingAllowed && request.signal.aborted)
          continue;
        if (!abandon)
          throw request.signal.reason instanceof PlaybackFault ? request.signal.reason : error;
        const candidate = await this.playlist(abandon, signal);
        const anchor = candidate.segments.find((s) => list.segments.some((old) => old.sequence === s.sequence));
        if (!anchor || !candidate.segments.some((s) => s.sequence === sequence))
          throw new PlaybackFault("Replacement rendition lacks next segment boundary", "source");
        const offset = list.segments.find((s) => s.sequence === anchor.sequence).start - anchor.start;
        candidate.segments.forEach((s) => {
          s.start += offset;
        });
        rendition = abandon;
        list = candidate;
        this.current = rendition;
        this.onRendition(rendition);
        init = "";
        continue;
      } finally {
        if (this.request === request)
          this.request = undefined;
        this.segmentStarted = null;
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
      await this.append(bytes, signal);
      await this.audio?.fill(next.start, next.start + next.duration, list, signal);
      if (first && live && this.liveWindowStart === null && this.buffer.buffered.length) {
        const offset = this.buffer.buffered.start(0) - next.start;
        list.segments.forEach((s) => {
          s.start += offset;
        });
        this.published(list);
      }
      if (first) {
        this.video.currentTime = live ? Math.max(next.start, position) : position;
        first = false;
      }
      sequence++;
      const retain = live ? 15 : 30;
      if (this.video.currentTime > retain && this.buffer.buffered.length && this.buffer.buffered.start(0) < this.video.currentTime - retain - 5) {
        await mutation(this.buffer, signal, () => this.buffer.remove(0, this.video.currentTime - retain));
      }
      await this.audio?.evict(this.video.currentTime - retain, signal);
      if (this.video.readyState < 3)
        for (let i = 0;i < this.video.buffered.length; i++) {
          const gap = this.video.buffered.start(i) - this.video.currentTime;
          if (gap > 0.02 && gap <= 0.25) {
            this.video.currentTime = this.video.buffered.start(i) + 0.01;
            break;
          }
        }
      if (live && this.video.buffered.length) {
        const drift = this.video.buffered.end(this.video.buffered.length - 1) - this.video.currentTime;
        if (drift > Math.max(this.maxLiveDrift, this.liveTargetSeconds + 6))
          this.video.currentTime = this.video.buffered.end(this.video.buffered.length - 1) - this.liveTargetSeconds;
        this.video.playbackRate = this.livePlaybackRate;
      }
    }
  }
}

// client/player/host/platform.ts
function saveVolume(context) {
  if (context.surface.ambient)
    return;
  try {
    localStorage.setItem("vela.player.volume", String(context.surface.video.volume));
    localStorage.setItem("vela.player.muted", String(context.surface.video.muted));
  } catch {}
}
function nativeAudio(context, id) {
  const tracks = Array.from(context.surface.video.audioTracks ?? []);
  const byId = tracks.find((t) => t.id === id);
  if (byId)
    return byId;
  const preference = context.session.current?.audioTracks.find((t) => t.id === id);
  if (!preference?.language)
    return;
  const language = (value) => {
    try {
      return Intl.getCanonicalLocales(value)[0]?.split("-")[0] ?? "";
    } catch {
      return "";
    }
  };
  const wanted = language(preference.language);
  const matches = wanted ? tracks.filter((t) => language(t.language) === wanted) : [];
  return matches.length === 1 ? matches[0] : undefined;
}
function applyNativeAudio(context) {
  const selected = context.tracks.audio ? nativeAudio(context, context.tracks.audio) : undefined;
  if (!selected)
    return false;
  for (const track of Array.from(context.surface.video.audioTracks ?? []))
    track.enabled = track === selected;
  return true;
}
function pipAvailable(context) {
  if (context.surface.video.disablePictureInPicture || context.surface.video.readyState < 2 || context.surface.video.videoWidth <= 0 || context.playback.status === "ended")
    return false;
  return !!document.pictureInPictureEnabled && !!context.surface.video.requestPictureInPicture || !!context.surface.video.webkitSetPresentationMode && !!context.surface.video.webkitSupportsPresentationMode?.("picture-in-picture");
}
function fullscreenAvailable(context) {
  if (context.media.backend === "webgpu")
    return !!document.fullscreenEnabled && !!context.surface.fullscreenContainer.requestFullscreen;
  return !!document.fullscreenEnabled && !!context.surface.fullscreenContainer.requestFullscreen || !!context.surface.video.webkitEnterFullscreen && context.surface.video.webkitSupportsFullscreen !== false;
}

// client/player/timing.ts
var key = Symbol.for("vela.playback.timing");
var state = Reflect.get(globalThis, key) ?? {
  points: [],
  attempt: 0,
  mounted: 0,
  source: 0,
  firstSource: -1
};
Reflect.set(globalThis, key, state);
function playbackMark(stage, detail) {
  if (stage === "play")
    state.attempt++;
  if (stage === "source:open")
    state.source++;
  if (stage === "first-frame") {
    if (state.firstSource === state.source)
      return;
    state.firstSource = state.source;
  }
  state.points.push({
    attempt: state.attempt,
    source: state.source,
    stage,
    at: performance.now(),
    ...detail ? { detail } : {}
  });
  if (state.points.length > 200)
    state.points.shift();
}
function playbackTimings() {
  return state.points.map((point) => ({ ...point }));
}
var playIntent = (event) => {
  const target = event.composedPath().find((node) => node instanceof HTMLElement && node.hasAttribute("data-testid"));
  const id = target?.getAttribute("data-testid") ?? "";
  if (id === "hero-primary" || !id.startsWith("player-") && /(^|[-_])(play|watch)([-_]|$)/.test(id))
    playbackMark("play");
};
function mountPlaybackTiming() {
  if (state.mounted++ === 0) {
    document.addEventListener("click", playIntent, true);
    Object.defineProperty(window, "velaPlaybackTimings", { configurable: true, value: playbackTimings });
  }
  let removed = false;
  return () => {
    if (removed)
      return;
    removed = true;
    if (--state.mounted === 0)
      document.removeEventListener("click", playIntent, true);
  };
}

// client/player/universal/retry.ts
function decoderRetry(reason) {
  if (!reason.startsWith("Video decode:") && !/^Audio (native|software|output):/.test(reason) && !reason.startsWith("Original decode: decode-failed") && !reason.startsWith("Original first-frame deadline"))
    return null;
  return { audio: true, video: true };
}

// client/player/host/position.ts
function readPosition(context) {
  return context.playback.terminalMedia?.position ?? context.media.runtime?.position ?? (context.surface.video.readyState >= 1 && Number.isFinite(context.surface.video.currentTime) ? context.media.nativeOrigin + context.surface.video.currentTime : context.playback.resumePosition);
}
function readDuration(context) {
  if (context.session.current?.live)
    return null;
  return context.playback.terminalMedia?.duration ?? context.media.runtime?.readout.duration ?? (Number.isFinite(context.surface.video.duration) ? context.media.nativeOrigin + context.surface.video.duration : context.session.current?.duration ?? null);
}
function readFrameMetrics(context) {
  const quality = context.surface.video.getVideoPlaybackQuality?.();
  return {
    frames: context.media.runtime?.readout.frames ?? quality?.totalVideoFrames ?? null,
    dropped: context.media.runtime?.readout.dropped ?? quality?.droppedVideoFrames ?? null
  };
}
function snapshotBitrate(context) {
  const rendition = context.media.source?.renditions?.find((r) => r.id === (context.quality.manual ?? context.quality.automatic.id ?? context.media.source?.initialRenditionId));
  return context.media.pipeline?.current?.bandwidth ?? rendition?.bandwidth ?? context.media.source?.quality?.bitrate ?? null;
}

// client/player/core/async.ts
function abortable(value, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(value).then((result) => {
      cleanup();
      resolve(result);
    }, (error) => {
      cleanup();
      reject(error);
    });
  });
}

// client/player/universal/qualified.ts
var QUALIFIED_ORIGINAL_VIDEO = ["h264", "hevc"];
var QUALIFIED_ORIGINAL_AUDIO = [
  "aac",
  "ac3",
  "eac3",
  "truehd",
  "dts",
  "flac",
  "opus",
  "vorbis",
  "mp3",
  "alac",
  "mp2",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_f32le",
  "pcm_f64le"
];

// client/player/universal/loader.ts
function assetLocation() {
  const descriptor = window.velaUniversalAssets;
  if (descriptor === undefined)
    return { base: new URL("./universal/", import.meta.url) };
  if (!descriptor || typeof descriptor !== "object")
    throw new Error("Invalid shared original runtime descriptor");
  const { baseURL, assetKey } = descriptor;
  if (typeof baseURL !== "string" || typeof assetKey !== "string" || !/^[a-f0-9]{16}$/.test(assetKey))
    throw new Error("Invalid shared original runtime identity");
  const base = new URL(baseURL, location.origin);
  if (base.origin !== location.origin || base.username || base.password || base.search || base.hash || base.pathname !== `/vela/universal/${assetKey}/`)
    throw new Error("Original runtime assets must use the same-origin immutable base");
  return { base, assetKey };
}
function canAttemptOriginal() {
  return isSecureContext && !!navigator.gpu && typeof VideoFrame === "function" && typeof Worker === "function";
}
async function loadOriginalRuntime(options) {
  if (!canAttemptOriginal())
    throw new Error("Secure WebGPU, workers and VideoFrame are required for original playback");
  const { module, assets } = await loadRuntimeModule(options.signal);
  return new module.UniversalRuntime({ ...options, assets });
}
var manifests = new Map;
var resolvedManifests = new Map;
function hasCoreHls() {
  return canAttemptOriginal() && resolvedManifests.get(capabilityIdentity())?.core?.version === 1 && resolvedManifests.get(capabilityIdentity())?.core?.vodHls === true;
}
function hasCoreLive() {
  return hasCoreHls() && resolvedManifests.get(capabilityIdentity())?.core?.liveHls === true;
}
function capabilityIdentity() {
  const { base, assetKey } = assetLocation();
  return `${base.href}#${assetKey ?? ""}`;
}
function runtimeManifest(signal) {
  const { base, assetKey } = assetLocation(), key = capabilityIdentity();
  let pending = manifests.get(key);
  if (!pending) {
    playbackMark("assets:start");
    const load = (async () => {
      const response = await fetch(new URL("assets.json", base), {
        signal: AbortSignal.timeout(1e4),
        credentials: "same-origin"
      });
      if (!response.ok)
        throw new Error(`Original runtime assets HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.version !== 1 || assetKey !== undefined && manifest.assetKey !== assetKey || !/^[a-f0-9]{16}$/.test(manifest.assetKey) || manifest.upstreamRevision !== "a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2")
        throw new Error("Original runtime asset identity mismatch");
      if (manifest.subtitleAssets && (!/^[a-f0-9]{16}$/.test(manifest.subtitleAssets.assetKey) || manifest.subtitleAssets.directory !== "libraries/subtitles/"))
        throw new Error("Invalid subtitle asset identity");
      resolvedManifests.set(key, manifest);
      if (resolvedManifests.size > 2)
        resolvedManifests.delete(resolvedManifests.keys().next().value);
      playbackMark("assets:ready");
      return Object.freeze(manifest);
    })();
    pending = load.catch((error) => {
      if (manifests.get(key) === pending)
        manifests.delete(key);
      throw error;
    });
    manifests.set(key, pending);
    pending.catch(() => {});
    if (manifests.size > 2)
      manifests.delete(manifests.keys().next().value);
  }
  return abortable(pending, signal);
}
async function loadRuntimeModule(signal) {
  const { base } = assetLocation();
  const manifest = await runtimeManifest(signal);
  signal.throwIfAborted();
  playbackMark("runtime:start");
  const moduleURL = new URL("runtime.js", base);
  moduleURL.searchParams.set("v", manifest.assetKey);
  const module = await import(moduleURL.href);
  signal.throwIfAborted();
  playbackMark("runtime:ready");
  const subtitles = manifest.subtitleAssets;
  if (subtitles && (!/^[a-f0-9]{16}$/.test(subtitles.assetKey) || subtitles.directory !== "libraries/subtitles/"))
    throw new Error("Invalid subtitle asset identity");
  return {
    module,
    assets: {
      baseURL: new URL("libraries/", base).href,
      assetKey: manifest.assetKey,
      audioDecoderURL: new URL("libraries/audio-decoders/", base).href,
      videoDecoderURL: new URL("libraries/video-decoders/", base).href,
      subtitleBaseURL: subtitles ? new URL(subtitles.directory, base).href : undefined
    }
  };
}
async function loadSubtitleSession(options) {
  const { module, assets } = await loadRuntimeModule(options.signal);
  if (!module.SubtitleSession || !assets.subtitleBaseURL)
    throw new Error("Subtitle overlay assets are not installed");
  options.signal.throwIfAborted();
  return new module.SubtitleSession({ ...options, assetBaseURL: assets.subtitleBaseURL });
}
async function subtitleCapabilities(signal, original) {
  const value = await runtimeManifest(signal);
  if (!value.subtitleAssets)
    return [];
  const embedded = original && Array.isArray(value.originalSubtitleFormats) ? value.originalSubtitleFormats.filter((format) => typeof format === "string" && ["srt", "webvtt", "ass", "ssa", "pgs", "tx3g"].includes(format)) : [];
  return [...new Set(["webvtt", "ether-vtt-window", ...embedded])];
}
async function originalPlaybackCapabilities(signal) {
  if (!canAttemptOriginal())
    return null;
  const adapterSignal = AbortSignal.timeout(2000);
  const gpu = navigator.gpu;
  const [adapter, manifest] = await abortable(Promise.all([abortable(gpu?.requestAdapter(), adapterSignal).catch(() => null), runtimeManifest(signal)]), signal);
  if (!adapter)
    return null;
  const declaration = manifest.originalPlayback;
  if (!declaration || declaration.version !== 1 || declaration.range !== true || declaration.webgpu !== true)
    return null;
  for (const list of [declaration.demuxContainers, declaration.videoDecoders, declaration.audioDecoders])
    if (!Array.isArray(list) || !list.length || list.length > 32 || list.some((value) => typeof value !== "string" || !/^[a-z0-9_-]{1,40}$/.test(value)))
      return null;
  if (typeof VideoDecoder !== "function" || typeof AudioContext !== "function" || typeof AudioWorkletNode !== "function")
    return null;
  const videoDecoders = declaration.videoDecoders.filter((codec) => QUALIFIED_ORIGINAL_VIDEO.includes(codec));
  if (!videoDecoders.length)
    return null;
  return {
    ...declaration,
    videoDecoders,
    audioDecoders: declaration.audioDecoders.filter((codec) => QUALIFIED_ORIGINAL_AUDIO.includes(codec))
  };
}
function mountCoreWarmup(signal) {
  let phase = new AbortController, pending = false, last = -Infinity, frame, idle;
  const stopped = () => signal.aborted || !canAttemptOriginal() || document.hidden || navigator.connection?.saveData === true;
  const run = () => {
    idle = undefined;
    if (stopped() || pending)
      return;
    pending = true;
    last = performance.now();
    const active = phase;
    (async () => {
      const manifest = await runtimeManifest(active.signal);
      if (manifest.core?.version !== 1)
        return;
      const { module, assets } = await loadRuntimeModule(active.signal);
      active.signal.throwIfAborted();
      if (!module.warmup)
        return;
      playbackMark("warmup:start");
      const ready = await module.warmup({ assets, signal: active.signal });
      active.signal.throwIfAborted();
      playbackMark(ready === undefined ? "warmup:skipped" : ready ? "warmup:ready" : "warmup:failed");
    })().catch(() => {
      if (!active.signal.aborted)
        playbackMark("warmup:failed");
    }).finally(() => {
      pending = false;
      if (active !== phase && !stopped())
        queue();
    });
  };
  const queue = () => {
    if (stopped() || pending || frame !== undefined || idle !== undefined || performance.now() - last < 5000)
      return;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = undefined;
        idle = typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout: 1000 }) : window.setTimeout(run, 0);
      });
    });
  };
  const intent = (event) => {
    const target = event.composedPath().find((node) => node instanceof HTMLElement && node.hasAttribute("data-testid"));
    const id = target?.getAttribute("data-testid") ?? "";
    if (!id.startsWith("player-") && /card|detail|hero-primary|play/.test(id))
      queue();
  };
  const cancelSchedule = () => {
    if (frame !== undefined)
      cancelAnimationFrame(frame);
    frame = undefined;
    if (idle !== undefined) {
      if (typeof cancelIdleCallback === "function")
        cancelIdleCallback(idle);
      clearTimeout(idle);
    }
    idle = undefined;
  };
  const visible = () => {
    if (document.hidden) {
      cancelSchedule();
      phase.abort();
      phase = new AbortController;
      last = -Infinity;
    } else
      queue();
  };
  const release = () => {
    cancelSchedule();
    phase.abort();
    document.removeEventListener("pointerover", intent);
    document.removeEventListener("focusin", intent);
    document.removeEventListener("visibilitychange", visible);
    signal.removeEventListener("abort", release);
  };
  signal.addEventListener("abort", release, { once: true });
  document.addEventListener("pointerover", intent, { passive: true });
  document.addEventListener("focusin", intent);
  document.addEventListener("visibilitychange", visible);
  queue();
  return release;
}

// client/player/video-info.ts
var QUALITY_HEADROOM = 1.25;
function codecFamily(value) {
  const token = value.split(".")[0].toLowerCase();
  return {
    avc1: "h264",
    avc3: "h264",
    hvc1: "hevc",
    hev1: "hevc",
    dvh1: "hevc",
    dvhe: "hevc",
    av01: "av1",
    vp09: "vp9"
  }[token] ?? token;
}

// client/player/host/live.ts
function adaptLive(context) {
  if (!context.session.current?.live)
    return;
  context.live.latency.setPreference(context.session.current.livePolicy);
  const bounds = liveBounds(context);
  const retries = context.media.runtime?.live?.retries ?? context.media.pipeline?.networkRetries ?? 0;
  const decision = context.live.latency.sample({
    now: performance.now(),
    playing: context.playback.status === "playing" && context.playback.wantsPlay,
    waiting: context.playback.status === "buffering" || retries > context.live.networkRetries,
    bufferGoalSeconds: context.media.runtime ? 2 : undefined,
    bufferAhead: context.media.runtime ? Math.max(context.media.runtime.readout.bufferAheadSeconds ?? 0, context.media.runtime.readout.readAheadSeconds ?? 0) : bufferAhead(context.surface.video),
    throughputBps: context.media.runtime?.readout.throughputBps ?? context.media.pipeline?.bandwidth.bps ?? null,
    bitrateBps: snapshotBitrate(context),
    segmentSeconds: context.media.runtime?.live?.segmentSeconds ?? context.media.pipeline?.nominalSegmentSeconds ?? 2,
    windowSeconds: bounds.edge !== null && bounds.start !== null ? bounds.edge - bounds.start : null,
    behindSeconds: bounds.edge === null ? null : Math.max(0, bounds.edge - readPosition(context))
  });
  context.live.networkRetries = retries;
  context.live.targetSeconds = decision.targetSeconds;
  if (context.media.pipeline) {
    context.media.pipeline.liveTargetSeconds = decision.targetSeconds;
    context.media.pipeline.livePlaybackRate = decision.playbackRate;
  }
  if (context.media.runtime?.setLiveTarget)
    context.media.runtime.setLiveTarget(decision.targetSeconds, decision.playbackRate);
  else if (!context.media.runtime)
    context.surface.video.playbackRate = decision.playbackRate;
}
function catchUpTarget(context) {
  if (!context.session.current?.live)
    return null;
  const bounds = liveBounds(context);
  if (bounds.edge === null || bounds.start === null)
    return null;
  const start = bounds.start;
  const end = bounds.edge;
  if (end - start < 0.25)
    return null;
  const target = Math.max(start + 0.05, end - context.live.targetSeconds);
  return target > readPosition(context) + 0.25 ? Math.min(target, end - 0.1) : null;
}
function liveBounds(context) {
  const seekable = context.surface.video.seekable;
  let edge = context.media.runtime?.live?.edgeSeconds ?? context.media.pipeline?.publishedEdge ?? null;
  let start = context.media.runtime?.live?.startSeconds ?? context.media.pipeline?.publishedStart ?? null;
  let source = edge === null ? null : "playlist";
  if (edge === null && seekable.length) {
    edge = seekable.end(seekable.length - 1);
    start = seekable.start(0);
    source = "seekable";
  }
  if (edge === null && Number.isFinite(context.session.current?.liveEdge)) {
    edge = context.session.current.liveEdge;
    start = context.session.current.liveWindowStart ?? null;
    source = "server";
  }
  return { edge, start, source };
}
function liveSnapshot(context) {
  if (!context.session.current?.live)
    return null;
  const { edge, start, source } = liveBounds(context);
  return {
    edgeSeconds: edge,
    windowStartSeconds: start,
    driftSeconds: edge === null ? null : Math.max(0, edge - readPosition(context)),
    edgeSource: source,
    reconnecting: context.playback.status === "recovering" || !!context.media.runtime?.live?.retrying || !!context.media.pipeline?.retrying,
    delivery: context.media.runtime?.live?.delivery ?? context.media.pipeline?.delivery ?? "unknown",
    canCatchUp: catchUpTarget(context) !== null
  };
}

// client/player/host/telemetry.ts
function snapshotHost(context) {
  const ranges = context.surface.video.buffered;
  const quality = context.surface.video.getVideoPlaybackQuality?.();
  const audioTrackIds = context.media.runtime && context.media.runtime.supportsLocalAudioSwitch !== false ? context.media.runtime.audioTrackIds : context.session.current?.serverControlled ? context.session.current.audioTracks.map((t) => t.id) : context.media.backend === "mse" ? context.media.pipeline?.audioTracks ?? [] : context.session.current?.audioTracks.filter((t) => !!nativeAudio(context, t.id)).map((t) => t.id) ?? [];
  const subtitleTracks = context.tracks.overlay?.tracks.map((track) => ({
    id: track.id,
    label: track.label,
    language: track.language,
    codec: track.codec,
    streamIndex: track.streamIndex ?? undefined,
    forced: track.forced,
    delivery: track.delivery.kind === "external" ? undefined : track.delivery
  })) ?? context.session.current?.subtitleTracks.map(({ url, delivery, ...track }) => ({
    ...track,
    delivery: delivery?.kind === "external" ? undefined : delivery
  })) ?? [];
  const burned = !!context.tracks.subtitle && context.session.current?.subtitleTracks.some((track) => track.id === context.tracks.subtitle && track.delivery?.kind === "burn-in") && !context.tracks.overlay?.tracks.some((track) => track.id === context.tracks.subtitle && track.delivery.kind === "embedded");
  const subtitleId = context.tracks.overlay && !burned ? context.tracks.overlay.selected : context.tracks.subtitle;
  const selectedSubtitle = context.tracks.overlay?.tracks.find((track) => track.id === subtitleId);
  const audioId = context.media.runtime?.readout.audioTrackId ?? context.media.pipeline?.audioTrackId ?? context.tracks.audio;
  const readout = context.media.runtime?.readout;
  const rendition = context.media.pipeline?.current ?? context.media.source?.renditions?.find((r) => r.id === (context.quality.manual ?? context.quality.automatic.id ?? context.media.source?.initialRenditionId));
  const bitrate = rendition?.bandwidth ?? context.media.source?.quality?.bitrate;
  const currentBitrateBps = bitrate && Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null;
  const video = readout?.video ?? (context.surface.video.videoWidth > 0 ? {
    width: context.surface.video.videoWidth,
    height: context.surface.video.videoHeight,
    codec: rendition?.codec ?? "",
    dynamicRange: rendition?.dynamicRange ?? null
  } : null);
  const ahead = context.media.runtime ? readout?.bufferAheadSeconds ?? null : context.surface.video.readyState >= 1 ? bufferAhead(context.surface.video) : null;
  return {
    sessionId: context.session.current?.id ?? null,
    sourceGeneration: context.session.controller.source,
    seekGeneration: context.session.controller.seek,
    state: context.session.pendingSeek ? "buffering" : context.playback.status,
    sourceId: context.media.source?.id ?? null,
    strategy: context.media.source?.strategy ?? null,
    diagnostics: context.media.runtime || context.tracks.subtitleFailureNotes.length || context.recovery.history.length ? {
      implementation: context.media.runtime?.implementation,
      metadataDiscrepancies: context.media.runtime?.readout.metadataDiscrepancies ?? [],
      subtitleFailures: [...context.tracks.subtitleFailureNotes],
      recoveryHistory: context.recovery.history.snapshot()
    } : undefined,
    backend: context.media.backend,
    renditionId: context.media.pipeline?.current?.id ?? (context.media.backend === "webgpu" ? context.quality.automatic.id : context.media.backend === "native-hls" ? context.quality.manual ?? context.media.source?.initialRenditionId ?? null : null),
    qualityIds: context.media.pipeline?.qualityIds ?? (context.media.backend === "webgpu" ? context.media.source?.renditions?.map((r) => r.id) ?? [] : []),
    capabilities: {
      pip: pipAvailable(context),
      fullscreen: fullscreenAvailable(context),
      audioSwitch: audioTrackIds.length > 1
    },
    lockedQuality: context.quality.manual,
    audioTracks: context.media.runtime?.supportsLocalAudioSwitch !== false ? context.media.runtime?.audioTracks ?? context.session.current?.audioTracks ?? [] : context.session.current?.audioTracks ?? [],
    subtitleTracks,
    renditions: context.media.source?.renditions?.map(({ url, ...rendition }) => ({
      ...rendition,
      bitrateBps: rendition.bandwidth,
      requiredBandwidthBps: rendition.bandwidth * QUALITY_HEADROOM
    })) ?? [],
    video,
    currentBitrateBps,
    requiredBandwidthBps: currentBitrateBps === null ? null : currentBitrateBps * QUALITY_HEADROOM,
    bufferAheadSeconds: ahead,
    throughputHistory: context.media.pipeline?.bandwidth.history ?? readout?.throughputHistory ?? [],
    speed: context.session.current?.live ? 1 : context.playback.speed,
    speeds: context.session.current?.live || context.media.runtime && !context.media.runtime.setSpeed ? [] : [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
    pendingSubtitleTrackId: context.tracks.pendingTracks?.subtitle ?? context.tracks.overlay?.pending ?? null,
    chapters: context.session.current?.chapters ?? [],
    subtitleError: context.tracks.overlay?.error ?? null,
    subtitleStyle: context.tracks.subtitleStyle,
    subtitleStyleAvailable: !!context.tracks.overlay && !burned && (!selectedSubtitle || ["srt", "webvtt", "tx3g"].includes(selectedSubtitle.codec)),
    subtitleReportingId: selectedSubtitle?.serverId ?? subtitleId,
    subtitleClientOnly: !!selectedSubtitle && !selectedSubtitle.serverId,
    audioClientOnly: !!audioId && !context.session.current?.audioTracks.some((track) => track.id === audioId),
    live: liveSnapshot(context),
    seekTarget: context.session.pendingSeek?.position ?? null,
    waiting: !!context.session.pendingSeek || ["loading", "buffering", "recovering"].includes(context.playback.status) || context.playback.wantsPlay && context.surface.video.seeking,
    volume: context.surface.video.volume,
    muted: context.surface.video.muted,
    preparation: ["loading", "buffering"].includes(context.playback.status) && (context.media.runtime?.readout.frames ?? quality?.totalVideoFrames ?? 0) === 0 ? context.surface.video.readyState < 1 ? "media-metadata" : context.surface.video.paused ? "starting" : "initial-buffer" : null,
    position: readPosition(context),
    duration: readDuration(context),
    playable: context.media.runtime ? ahead !== null && ahead > 0 ? [{ start: readPosition(context), end: readPosition(context) + ahead }] : [] : Array.from({ length: Math.min(ranges.length, 32) }, (_, i) => ({
      start: context.media.nativeOrigin + ranges.start(i),
      end: context.media.nativeOrigin + ranges.end(i)
    })),
    throughputBps: context.media.pipeline?.bandwidth.bps ?? readout?.throughputBps ?? null,
    droppedFrames: context.playback.terminalMedia?.dropped ?? context.media.runtime?.readout.dropped ?? quality?.droppedVideoFrames ?? null,
    totalFrames: context.playback.terminalMedia?.frames ?? context.media.runtime?.readout.frames ?? quality?.totalVideoFrames ?? null,
    audioTrackIds,
    audioTrackId: audioId,
    pendingAudioTrackId: context.tracks.pendingTracks?.audio ?? context.media.runtime?.pendingAudioTrackId ?? context.media.pipeline?.pendingAudioTrackId ?? null,
    subtitleTrackId: subtitleId,
    failure: context.playback.failure
  };
}
function observationAllowed(context) {
  return context.session.current?.serverState !== "ended" && !context.session.pendingSeek && !context.session.pendingSwitch && (context.watchdog.frameSeen || context.playback.status === "failed" || context.playback.status === "ended");
}

// client/player/host/events.ts
function emitHostEvent(context, event) {
  context.events.deliver(event.type === "error" ? {
    ...event,
    sessionId: context.session.current?.id ?? null,
    sourceGeneration: context.session.controller.source,
    seekGeneration: context.session.controller.seek
  } : event);
}
function publishHostState(context, force = false) {
  if (context.lifecycle.disposed)
    return;
  if (context.media.pipeline?.audioTrackId)
    context.tracks.audio = context.media.pipeline.audioTrackId;
  if (context.media.runtime && !context.watchdog.frameSeen && context.media.runtime.readout.presentedFrames > 0) {
    context.watchdog.frameSeen = true;
    playbackMark("first-frame", "webgpu");
  }
  const now = performance.now();
  if (!force && now - context.telemetry.lastObservation < 250)
    return;
  context.telemetry.lastObservation = now;
  emitHostEvent(context, { type: "snapshot", snapshot: snapshotHost(context) });
}

// client/src/protocol/id.ts
function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  return Array.from(bytes, (b, i) => `${i === 4 || i === 6 || i === 8 || i === 10 ? "-" : ""}${b.toString(16).padStart(2, "0")}`).join("");
}

// client/player/host/authorizations.ts
function rejectCommand(context, message) {
  if (context.tracks.pendingTracks) {
    if (context.tracks.pendingTracks.subtitle !== undefined)
      context.tracks.subtitlePreference = context.tracks.pendingTracks.previousSubtitlePreference;
    context.tracks.pendingTracks = undefined;
    context.tracks.deferredPath = null;
    if (message)
      emitHostEvent(context, { type: "error", failure: { kind: "action", message, recoverable: true } });
    publishHostState(context);
    return;
  }
  context.session.pendingSwitch = undefined;
  if (message)
    failPlayback(context, { kind: "source", message, recoverable: false });
}
function requestTracks(context, tracks) {
  if (!context.session.current?.serverControlled)
    throw new Error("Server track selection is unavailable");
  if (context.tracks.pendingTracks)
    throw new Error("A track selection is already pending");
  context.tracks.pendingTracks = {
    ...tracks,
    previousSubtitlePreference: context.tracks.subtitlePreference,
    startedAt: performance.now()
  };
  if (tracks.subtitle !== undefined)
    context.tracks.subtitlePreference = tracks.subtitle;
  emitHostEvent(context, {
    type: "session-command",
    sessionId: context.session.current.id,
    command: {
      kind: "tracks",
      sourceGeneration: context.session.controller.source,
      seekGeneration: context.session.controller.seek,
      idempotencyKey: randomId(),
      ...tracks.audio === undefined ? {} : { audioTrackId: tracks.audio },
      ...tracks.subtitle === undefined ? {} : { subtitleTrackId: tracks.subtitle }
    }
  });
}
function requestSeek(context, seconds) {
  context.session.pendingSeek = { position: seconds, startedAt: performance.now(), authorized: false };
  context.playback.status = "buffering";
  context.media.runtime?.pause();
  context.surface.video.pause();
  context.telemetry.lastObservation = -Infinity;
  publishHostState(context);
  emitHostEvent(context, {
    type: "session-command",
    sessionId: context.session.current.id,
    command: {
      kind: "seek",
      positionSeconds: seconds,
      sourceGeneration: context.session.controller.source,
      seekGeneration: context.session.controller.seek,
      idempotencyKey: randomId()
    }
  });
}
function requestSwitch(context, source, position, recovery = false) {
  const boundary = "onDemand" in source ? position : source.boundaries?.filter((at) => at <= position).sort((a, b) => b - a)[0];
  if (boundary === undefined)
    throw new Error("No independent switch boundary offered by server");
  context.session.pendingSwitch = {
    startedAt: performance.now(),
    sessionId: context.session.current.id,
    sourceId: source.id,
    source: context.session.controller.source,
    seek: context.session.controller.seek,
    position,
    recovery
  };
  emitHostEvent(context, {
    type: "session-command",
    sessionId: context.session.current.id,
    command: {
      kind: "switch",
      pathId: source.id,
      atSeconds: boundary,
      sourceGeneration: context.session.controller.source,
      seekGeneration: context.session.controller.seek,
      idempotencyKey: randomId()
    }
  });
}
function awaitingReplacement(context, token) {
  if (!context.session.current?.serverControlled || !context.session.controller.current(token))
    return false;
  const pending = context.session.pendingSwitch;
  return !!(pending && pending.sessionId === token.sessionId && pending.source === token.source && pending.seek === token.seek || context.session.pendingSeek && !context.session.pendingSeek.authorized || context.tracks.pendingTracks);
}

// client/player/host/subtitles.ts
function releaseOverlay(context) {
  context.tracks.overlayJob?.abort();
  context.tracks.overlayJob = undefined;
  context.tracks.overlay?.dispose();
  context.tracks.overlay = undefined;
  context.tracks.overlayLoading = undefined;
  context.tracks.overlayEpoch++;
}
async function ensureOverlay(context) {
  if (context.tracks.overlay)
    return context.tracks.overlay;
  if (context.tracks.overlayLoading)
    return context.tracks.overlayLoading;
  const source = context.media.source;
  const session = context.session.current;
  const surface = context.surface.video.parentElement;
  if (!source || !session || !(surface instanceof HTMLDivElement))
    throw new Error("Subtitle source is unavailable");
  const job = context.tracks.overlayJob = new AbortController;
  const original = context.media.runtime;
  const current = () => context.tracks.overlayJob === job && !job.signal.aborted && !context.lifecycle.disposed;
  const loading = (async () => {
    const overlay = await loadSubtitleSession({
      surface,
      reader: original?.supportsSubtitles ? original.byteReader : undefined,
      clusterStream: original?.subtitleClusters,
      mediaRequests: context.surface.mediaAccess,
      source: {
        url: source.url,
        container: original?.sourceContainer ?? source.delivery,
        sessionId: session.id,
        sourceGeneration: context.session.controller.source,
        seekGeneration: context.session.controller.seek
      },
      epoch: ++context.tracks.overlayEpoch,
      clock: () => readPosition(context),
      signal: job.signal,
      describedTracks: session.subtitleTracks.map((track) => ({
        id: track.id,
        streamIndex: track.streamIndex,
        codec: track.codec,
        label: track.label,
        language: track.language,
        delivery: track.delivery ?? (track.url ? { kind: "external", format: "webvtt", url: track.url } : undefined)
      })),
      getViewport: () => {
        const rect = surface.getBoundingClientRect();
        const video = original?.supportsSubtitles ? original.videoSize : undefined;
        const width = context.surface.video.videoWidth || video?.width || rect.width;
        const height = context.surface.video.videoHeight || video?.height || rect.height;
        const scale = Math.min(rect.width / width, rect.height / height);
        const y = (rect.height - height * scale) / 2;
        const button = context.surface.fullscreenContainer.querySelector('[data-testid="player-toggle"]');
        let visible = !!button;
        for (let node = button;node && visible; node = node.parentElement)
          if (getComputedStyle(node).visibility === "hidden" || Number(getComputedStyle(node).opacity) < 0.05)
            visible = false;
        const controlsTop = button?.parentElement?.getBoundingClientRect().top ?? Infinity;
        return {
          x: (rect.width - width * scale) / 2,
          y,
          width: width * scale,
          height: height * scale,
          bottomInset: visible ? Math.max(0, rect.top + y + height * scale - controlsTop + 12) : 0
        };
      },
      onTracks: () => {
        if (current())
          publishHostState(context, true);
      },
      onState: () => {
        if (current())
          publishHostState(context, true);
      },
      onFailure: (failure) => {
        if (current())
          subtitleFailed(context, failure);
      }
    });
    if (!current()) {
      overlay.dispose();
      throw new DOMException("Subtitle source retired", "AbortError");
    }
    context.tracks.overlay = overlay;
    overlay.setPreferences(context.tracks.subtitleStyle);
    await overlay.discover();
    job.signal.throwIfAborted();
    return overlay;
  })();
  context.tracks.overlayLoading = loading;
  try {
    return await loading;
  } catch (error) {
    if (current())
      releaseOverlay(context);
    throw error;
  }
}
function subtitleFailed(context, failure) {
  const note = failure.message.replace(/https?:\/\/\S+/g, "[source]").slice(0, 256);
  if (!context.tracks.subtitleFailureNotes.includes(note)) {
    context.tracks.subtitleFailureNotes.push(note);
    if (context.tracks.subtitleFailureNotes.length > 8)
      context.tracks.subtitleFailureNotes.shift();
  }
  publishHostState(context, true);
  const serverId = failure.serverId;
  const key = [
    String(context.session.current?.id),
    String(context.media.source?.sourceRevision ?? context.media.source?.timeline),
    failure.trackId
  ].join(":");
  if (serverId && context.session.current?.serverControlled && context.tracks.overlay?.tracks.some((track) => track.id === failure.trackId && track.delivery.kind === "embedded") && context.session.current.subtitleTracks.some((track) => track.id === serverId) && !context.tracks.subtitleFailures.has(key) && !context.tracks.pendingTracks && !context.session.pendingSwitch && !context.recovery.active && !["failed", "ended"].includes(context.playback.status)) {
    context.tracks.subtitleFailures.add(key);
    requestTracks(context, { subtitle: serverId });
  } else
    emitHostEvent(context, {
      type: "error",
      failure: { kind: "action", message: failure.message, recoverable: true }
    });
}
function applySubtitle(context) {
  context.tracks.nativeTrack?.remove();
  context.tracks.nativeTrack = undefined;
  if (context.tracks.overlay) {
    const selected = context.tracks.overlay.tracks.find((track) => track.id === context.tracks.subtitle);
    if (selected?.delivery.kind === "burn-in") {
      context.tracks.overlay.select(null);
      return;
    }
    context.tracks.overlay.select(context.tracks.subtitle).catch(() => {});
    return;
  }
  if (!context.tracks.subtitle)
    return;
  const selected = context.session.current?.subtitleTracks.find((t) => t.id === context.tracks.subtitle);
  if (selected?.delivery?.kind === "burn-in")
    return;
  const source = context.media.source;
  const id = context.tracks.subtitle;
  ensureOverlay(context).then(() => {
    if (source === context.media.source && id === context.tracks.subtitle)
      applySubtitle(context);
  }).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError" || source !== context.media.source || id !== context.tracks.subtitle)
      return;
    try {
      applyLegacySubtitle(context);
    } catch (error) {
      emitHostEvent(context, {
        type: "error",
        failure: {
          kind: "action",
          message: error instanceof Error ? error.message : "Subtitle unavailable",
          recoverable: true
        }
      });
    }
  });
}
function applyLegacySubtitle(context) {
  if (context.lifecycle.disposed || !context.tracks.subtitle || context.tracks.nativeTrack)
    return;
  const selected = context.session.current?.subtitleTracks.find((track) => track.id === context.tracks.subtitle);
  if (!selected?.url)
    throw new Error("Selected subtitle has no WebVTT URL");
  if (context.surface.mediaAccess?.authorization())
    throw new Error("Authorized subtitles require the installed overlay");
  const track = context.tracks.nativeTrack = document.createElement("track");
  track.kind = "subtitles";
  track.label = selected.label;
  track.srclang = selected.language ?? "und";
  track.src = selected.url;
  track.default = true;
  track.addEventListener("load", () => {
    if (context.tracks.nativeTrack === track)
      track.track.mode = "showing";
  }, { once: true });
  track.addEventListener("error", () => {
    if (context.tracks.nativeTrack === track)
      emitHostEvent(context, {
        type: "error",
        failure: { kind: "source", message: "Subtitle could not be loaded", recoverable: true }
      });
  }, { once: true });
  context.surface.video.append(track);
  track.track.mode = "showing";
}

// client/player/host/packet-runtime.ts
async function activatePacketRuntime(context, source, position, token, retry) {
  context.media.backend = "webgpu";
  context.watchdog.startupDeadlineMs = 8000;
  const parent = context.surface.video.parentElement;
  if (!(parent instanceof HTMLDivElement))
    throw new Error("Original renderer surface is missing");
  const job = context.media.runtimeJob = new AbortController;
  context.media.runtimeGeneration = token;
  const current = () => context.media.runtimeJob === job && !job.signal.aborted && !!context.media.runtimeGeneration && context.session.controller.current(context.media.runtimeGeneration);
  const original = await loadOriginalRuntime({
    surface: { container: parent, video: context.surface.video },
    signal: job.signal,
    retry,
    mediaRequests: context.surface.mediaAccess,
    onFailure: (reason, _position, transport) => {
      if (current()) {
        const generation = context.media.runtimeGeneration;
        if (transport?.httpStatus === 410 && awaitingReplacement(context, generation)) {
          context.playback.status = "loading";
          publishHostState(context);
          return;
        }
        recoverPlayback(context, new PlaybackFault(reason, "decoder"), generation);
      }
    },
    onEvent: (event) => {
      if (!current() || !context.media.runtime)
        return;
      if (event.type === "waiting")
        context.playback.status = "buffering";
      else if (event.type === "playing" || event.type === "statechange") {
        const state = context.media.runtime.readout.state;
        context.playback.status = state === "failed" && awaitingReplacement(context, context.media.runtimeGeneration) ? "loading" : state;
        if (context.playback.status === "playing") {
          context.playback.failure = null;
          if (context.session.pendingSeek?.authorized)
            context.session.pendingSeek = undefined;
        }
      } else if (event.type === "ended") {
        endPlayback(context);
        return;
      }
      publishHostState(context);
    }
  });
  cancelled(token.signal);
  context.media.runtime = original;
  if (!context.playback.wantsPlay)
    original.pause();
  if (context.tracks.subtitle && !original.supportsSubtitles)
    throw new Error("Selected subtitles require a compatible fallback; original overlay is not ready");
  const info = source.originalVideo;
  const level = source.delivery === "hls" ? context.quality.automatic.choose(source.renditions ?? [], source.initialRenditionId) : undefined;
  await original.open({
    url: level?.url ?? source.url,
    authority: {
      sourceGeneration: context.session.controller.source,
      seekGeneration: context.session.controller.seek
    },
    ...source.delivery === "hls" ? {
      hls: {
        originSeconds: source.timelineOriginSeconds ?? 0,
        ...context.session.current?.live ? {
          live: {
            windowStartSeconds: context.session.current.liveWindowStart,
            targetSeconds: context.live.targetSeconds,
            startAtEdge: !context.session.pendingSeek
          }
        } : {}
      }
    } : {},
    container: "",
    duration: context.session.current?.duration ?? null,
    position,
    video: { ...info, codec: info?.codec ?? "", width: info?.width ?? 0, height: info?.height ?? 0 },
    audio: (context.session.current?.audioTracks ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      codec: t.codec ?? "",
      channels: t.channels,
      language: t.language,
      streamIndex: t.streamIndex ?? -1
    })),
    selectedAudioId: context.tracks.audio
  });
  if (original.setSpeed)
    await original.setSpeed(context.playback.speed);
  if (original.supportsSubtitles)
    ensureOverlay(context).then(() => applySubtitle(context)).catch((error) => {
      if (current()) {
        const message = error instanceof Error ? error.message : "Subtitle discovery failed";
        if (context.tracks.subtitle)
          subtitleFailed(context, {
            trackId: context.tracks.subtitle,
            serverId: context.session.current?.subtitleTracks.find((track) => track.id === context.tracks.subtitle)?.id,
            code: "subtitle-unavailable",
            message
          });
        else
          emitHostEvent(context, {
            type: "error",
            failure: { kind: "action", message, recoverable: true }
          });
      }
    });
  cancelled(token.signal);
  context.playback.status = original.readout.state;
  if (context.session.pendingSeek?.authorized && context.playback.status === "paused")
    context.session.pendingSeek = undefined;
  publishHostState(context);
  return;
}

// client/player/native-hls.ts
async function nativeMediaPlaylist(url, signal, depth = 0, fetcher = (...args) => fetch(...args)) {
  if (depth > 1)
    throw new Error("Nested HLS masters are unsupported");
  const response = await fetcher(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    credentials: "same-origin",
    redirect: "error"
  });
  if (!response.ok)
    throw new TypeError(`HLS manifest HTTP ${response.status}`);
  const text = await response.text();
  cancelled(signal);
  if (text.length > 1024 * 1024 || !text.trimStart().startsWith("#EXTM3U"))
    throw new Error("Invalid HLS manifest");
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const first = lines.findIndex((line) => line.startsWith("#EXT-X-STREAM-INF:"));
  if (first < 0) {
    const durations = lines.filter((line) => line.startsWith("#EXTINF:")).map((line) => Number(line.slice(8).split(",")[0]));
    const duration = lines.includes("#EXT-X-ENDLIST") && durations.length > 0 && durations.every((d) => Number.isFinite(d) && d > 0) ? durations.reduce((a, b) => a + b, 0) : null;
    return { url: response.url, duration };
  }
  const uri = lines.slice(first + 1).find((line) => line && !line.startsWith("#"));
  if (!uri)
    throw new Error("HLS default variant is missing");
  const variant = new URL(uri, response.url);
  if (variant.origin !== new URL(response.url).origin || variant.username || variant.password)
    throw new Error("HLS variant outside broker origin");
  return nativeMediaPlaylist(variant.href, signal, depth + 1, fetcher);
}

// client/player/host/watchdog.ts
function checkWaiting(context) {
  if (context.tracks.pendingTracks && performance.now() - context.tracks.pendingTracks.startedAt > 15000) {
    if (context.tracks.pendingTracks.subtitle !== undefined)
      context.tracks.subtitlePreference = context.tracks.pendingTracks.previousSubtitlePreference;
    context.tracks.pendingTracks = undefined;
    context.tracks.deferredPath = null;
    emitHostEvent(context, {
      type: "error",
      failure: { kind: "action", message: "Track selection authorization timed out", recoverable: true }
    });
  }
  if (context.session.pendingSeek && !context.session.pendingSeek.authorized && performance.now() - context.session.pendingSeek.startedAt > 15000) {
    failPlayback(context, { kind: "network", message: "Seek authorization timed out", recoverable: true });
    return;
  }
  if (context.session.pendingSwitch && performance.now() - context.session.pendingSwitch.startedAt > 15000) {
    context.session.pendingSwitch = undefined;
    failPlayback(context, {
      kind: "network",
      message: "Source switch authorization timed out",
      recoverable: true
    });
    return;
  }
  if (!context.session.current || !context.media.source || !context.playback.wantsPlay || ["failed", "ended", "recovering"].includes(context.playback.status))
    return;
  const now = performance.now();
  if (recordPlaybackProgress(context, now))
    return;
  if (context.media.runtime?.implementation === "vela-core" && context.media.runtime.startupPending)
    return;
  const expired = !context.watchdog.everPlayed ? now - context.watchdog.waitSince > context.watchdog.startupDeadlineMs : now - context.watchdog.lastAdvance > 30000;
  if (expired)
    recoverPlayback(context, new PlaybackFault(context.watchdog.everPlayed ? "Playback stalled for 30 seconds" : `Playback did not start within ${context.watchdog.startupDeadlineMs / 1000} seconds`, "network"), context.session.controller.token());
}
function recordPlaybackProgress(context, now = performance.now()) {
  if (context.session.pendingSeek)
    return false;
  const position = readPosition(context);
  const decoded = (readFrameMetrics(context).frames ?? 0) > 0 || !context.media.runtime && context.surface.video.readyState >= 2;
  const started = !context.watchdog.everPlayed && (context.watchdog.frameSeen || (context.media.runtime?.readout.presentedFrames ?? 0) > 0 || position > context.watchdog.lastPosition && decoded);
  const advanced = (context.watchdog.everPlayed || decoded) && position > context.watchdog.lastPosition + 0.02 && (context.media.runtime ? context.playback.status === "playing" : !context.surface.video.paused);
  if (!started && !advanced)
    return false;
  context.watchdog.everPlayed = true;
  context.watchdog.lastAdvance = now;
  context.watchdog.lastPosition = position;
  if (context.watchdog.startTimer)
    clearTimeout(context.watchdog.startTimer);
  context.watchdog.startTimer = undefined;
  return true;
}
function resetProgress(context, position) {
  context.watchdog.waitSince = performance.now();
  context.watchdog.lastAdvance = context.watchdog.waitSince;
  context.watchdog.lastPosition = position;
  context.watchdog.everPlayed = false;
}

// client/player/host/quality.ts
function adaptCoreQuality(context) {
  if (!context.media.runtime || context.media.source?.delivery !== "hls" || context.session.pendingSwitch || context.session.pendingSeek || context.tracks.pendingTracks || context.recovery.active || !context.playback.wantsPlay)
    return;
  const next = context.quality.automatic.sample(context.media.source.renditions ?? [], context.playback.status === "buffering", context.media.runtime.readout.throughputBps ?? null);
  if (next) {
    context.quality.manual = null;
    activateSource(context, context.media.source, readPosition(context), false, true);
  }
}
function routeKey(context, source) {
  return [
    String(context.session.current?.id),
    context.session.controller.source,
    context.session.controller.seek,
    source.id
  ].join(":");
}
function usesPacketRuntime(context, source) {
  return !context.recovery.browserFallbacks.has(routeKey(context, source)) && (source.original && canAttemptOriginal() || source.delivery === "hls" && (context.session.current?.live ? hasCoreLive() : hasCoreHls()));
}
function supportsSource(context, source) {
  if (source.edition !== context.session.current?.edition)
    return false;
  if (source.delivery === "file")
    return source.original && canAttemptOriginal() || !!context.surface.video.canPlayType(source.mime);
  return (context.session.current?.live ? hasCoreLive() : hasCoreHls()) || !!context.surface.video.canPlayType("application/vnd.apple.mpegurl") || !!source.renditions?.some((r) => mediaSourceClass() && (!codecKnown(r) || mediaSourceClass().isTypeSupported(r.mime)));
}
function useNativeHls(context, source) {
  const native = !!context.surface.video.canPlayType("application/vnd.apple.mpegurl");
  const segmented = !!source.renditions?.some((r) => mediaSourceClass() && (!codecKnown(r) || mediaSourceClass().isTypeSupported(r.mime)));
  const pending = !!source.renditions?.some((r) => !codecKnown(r));
  const managed = "ManagedMediaSource" in globalThis;
  return native && (!segmented || navigator.vendor === "Apple Computer, Inc." && !managed && !pending);
}
function candidateSources(context) {
  const priority = { direct: 0, remux: 1, transcode: 2 };
  return (context.session.current?.sources ?? []).filter((s) => supportsSource(context, s)).sort((a, b) => priority[a.strategy] - priority[b.strategy]);
}

// client/player/host/transport.ts
async function playMedia(context) {
  if (context.media.runtime) {
    context.media.runtime.resume();
    return;
  }
  const token = context.session.controller.token();
  try {
    await context.surface.video.play();
    if (context.session.controller.current(token)) {
      if (["failed", "ended"].includes(context.playback.status) || context.surface.video.error)
        return;
      context.playback.status = "playing";
      context.playback.failure = null;
      if (context.session.pendingSeek?.authorized)
        context.session.pendingSeek = undefined;
      context.telemetry.lastObservation = -Infinity;
      publishHostState(context);
    }
  } catch (e) {
    if (!context.session.controller.current(token))
      return;
    if (e instanceof DOMException && e.name === "NotAllowedError" && !context.surface.video.muted) {
      context.surface.video.muted = true;
      try {
        await context.surface.video.play();
        if (!context.session.controller.current(token))
          return;
        context.playback.status = "playing";
        context.playback.failure = null;
        if (context.session.pendingSeek?.authorized)
          context.session.pendingSeek = undefined;
        context.telemetry.lastObservation = -Infinity;
        publishHostState(context);
        return;
      } catch (retryError) {
        e = retryError;
      }
    }
    if (context.session.controller.current(token))
      failPlayback(context, {
        kind: "action",
        message: e instanceof Error ? e.message : String(e),
        recoverable: true
      });
  }
}

// client/player/host/media.ts
function releaseOriginal(context) {
  releaseOverlay(context);
  if (context.watchdog.startTimer)
    clearTimeout(context.watchdog.startTimer);
  context.watchdog.startTimer = undefined;
  const original = context.media.runtime;
  context.media.runtime = undefined;
  context.media.runtimeJob?.abort();
  context.media.runtimeJob = undefined;
  context.media.runtimeGeneration = undefined;
  if (original)
    context.media.closingRuntime = original.dispose().catch(() => {});
}
function resetMedia(context) {
  if (context.watchdog.videoCallback !== undefined)
    context.surface.video.cancelVideoFrameCallback?.(context.watchdog.videoCallback);
  context.watchdog.videoCallback = undefined;
  if (context.watchdog.startTimer)
    clearTimeout(context.watchdog.startTimer);
  context.watchdog.startTimer = undefined;
  releaseOriginal(context);
  context.media.nativeOrigin = 0;
  context.playback.terminalMedia = undefined;
  context.surface.video.pause();
  context.media.pipeline?.dispose();
  context.media.pipeline = undefined;
  context.tracks.nativeTrack?.remove();
  context.tracks.nativeTrack = undefined;
  context.surface.video.removeAttribute("src");
  context.surface.video.load();
  context.surface.video.playbackRate = 1;
}
async function activateSource(context, source, position, recovery = false, initial = false, retry) {
  context.watchdog.startupDeadlineMs = source.renditions?.some((r) => !codecKnown(r)) ? 60000 : 45000;
  context.playback.resumePosition = position;
  resetProgress(context, position);
  const token = context.session.controller.changeSource(!initial);
  resetMedia(context);
  context.media.source = source;
  context.watchdog.frameSeen = false;
  playbackMark("source:open", source.delivery);
  context.watchdog.videoCallback = context.surface.video.requestVideoFrameCallback?.(() => {
    if (context.session.controller.current(token)) {
      context.watchdog.videoCallback = undefined;
      if (context.media.backend !== "webgpu" && !context.media.runtime && !context.watchdog.frameSeen) {
        context.watchdog.frameSeen = true;
        playbackMark("first-frame", context.media.backend === "mse" ? "mse" : "native");
      }
    }
  });
  bindMedia(context, token);
  context.recovery.attempted.add(source.id);
  context.playback.status = recovery ? "recovering" : "loading";
  context.playback.failure = null;
  context.telemetry.lastObservation = -Infinity;
  publishHostState(context);
  if (usesPacketRuntime(context, source)) {
    context.media.backend = "webgpu";
    context.watchdog.startupDeadlineMs = 8000;
    context.watchdog.startTimer = setTimeout(() => {
      context.watchdog.startTimer = undefined;
      if (!context.session.controller.current(token))
        return;
      if (context.media.runtime?.implementation === "vela-core" && context.media.runtime.startupPending)
        return;
      recordPlaybackProgress(context);
      if (!context.watchdog.everPlayed)
        recoverPlayback(context, new PlaybackFault("Original first-frame deadline exceeded (8 seconds)", "decoder"), token);
    }, 8000);
  }
  try {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3500);
      context.media.closingRuntime.then(() => {
        clearTimeout(timer);
        resolve();
      }, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    cancelled(token.signal);
    if (usesPacketRuntime(context, source)) {
      await activatePacketRuntime(context, source, position, token, retry);
      return;
    }
    if (source.delivery === "hls" && !useNativeHls(context, source)) {
      context.media.backend = "mse";
      const pipeline = context.media.pipeline = new SegmentPipeline(context.surface.video, () => publishHostState(context), () => {
        if (context.session.controller.current(token) && context.session.current)
          emitHostEvent(context, { type: "session-refresh", sessionId: context.session.current.id });
      }, context.surface.mediaAccess?.fetch);
      pipeline.timelineOriginSeconds = source.timelineOriginSeconds ?? 0;
      pipeline.audioRenditions = source.audioRenditions ?? [];
      pipeline.initialAudioTrackId = context.tracks.audio;
      pipeline.expensiveSwitches = source.strategy === "transcode";
      pipeline.initialRenditionId = context.quality.manual ?? source.initialRenditionId;
      pipeline.liveTargetSeconds = context.live.targetSeconds;
      pipeline.liveWindowStart = context.session.current?.liveWindowStart ?? null;
      pipeline.maxLiveDrift = context.session.current?.liveMaxDrift ?? 45;
      pipeline.abr.manual = context.quality.manual;
      pipeline.run(source.renditions ?? [], position, !!context.session.current?.live, token.signal).catch((e) => {
        if (context.session.controller.current(token))
          recoverPlayback(context, e, token);
      });
    } else {
      context.media.backend = source.delivery === "file" ? "file" : "native-hls";
      context.surface.video.disableRemotePlayback = false;
      const pinned = source.renditions?.find((r) => r.id === context.quality.manual);
      const media = source.delivery === "hls" ? await nativeMediaPlaylist(pinned?.url ?? source.url, token.signal, 0, context.surface.mediaAccess?.fetch) : { url: source.url, duration: null };
      cancelled(token.signal);
      const legacyOffset = !context.session.current?.live && position > 0 && media.duration !== null && context.session.current?.duration !== undefined && Math.abs(media.duration + position - context.session.current.duration) <= 0.25;
      if (source.timelineOriginSeconds !== undefined && (!Number.isFinite(source.timelineOriginSeconds) || source.timelineOriginSeconds < 0))
        throw new Error("Invalid media timeline origin");
      context.media.nativeOrigin = source.delivery === "hls" ? source.timelineOriginSeconds ?? (legacyOffset ? position : 0) : 0;
      const attached = context.surface.mediaAccess ? await context.surface.mediaAccess.nativeURL(media.url, token.signal) : media.url;
      cancelled(token.signal);
      context.surface.video.src = attached;
    }
    await metadata(context, token);
    cancelled(token.signal);
    context.surface.video.playbackRate = context.playback.speed;
    if (context.media.backend !== "mse" && position > 0)
      context.surface.video.currentTime = Math.max(0, position - context.media.nativeOrigin);
    applySubtitle(context);
    applyNativeAudio(context);
    context.playback.status = context.playback.wantsPlay ? "loading" : "paused";
    if (context.playback.wantsPlay)
      await playMedia(context);
    publishHostState(context);
  } catch (e) {
    if (context.session.controller.current(token))
      await recoverPlayback(context, e, token);
  }
}
function metadata(context, token) {
  return new Promise((resolve, reject) => {
    const done = () => {
      clean();
      resolve();
    };
    const abort = () => {
      clean();
      reject(new DOMException("Superseded", "AbortError"));
    };
    const error = () => {
      clean();
      reject(new PlaybackFault("Media metadata unavailable", "source"));
    };
    const timer = setTimeout(() => {
      clean();
      reject(new PlaybackFault("Metadata deadline exceeded", "network", true));
    }, context.watchdog.startupDeadlineMs);
    const clean = () => {
      clearTimeout(timer);
      context.surface.video.removeEventListener("loadedmetadata", done);
      context.surface.video.removeEventListener("error", error);
      token.signal.removeEventListener("abort", abort);
    };
    context.surface.video.addEventListener("loadedmetadata", done, { once: true });
    context.surface.video.addEventListener("error", error, { once: true });
    token.signal.addEventListener("abort", abort, { once: true });
    if (context.surface.video.readyState >= 1)
      done();
    else if (token.signal.aborted)
      abort();
  });
}

// client/player/host/recovery.ts
function failPlayback(context, failure) {
  const position = readPosition(context);
  const duration = readDuration(context);
  const metrics = readFrameMetrics(context);
  context.session.pendingSeek = undefined;
  context.playback.failure = failure;
  context.playback.status = "failed";
  context.session.controller.cancel();
  detachMedia(context);
  resetMedia(context);
  context.playback.terminalMedia = { position, duration, ...metrics };
  emitHostEvent(context, { type: "error", failure });
  context.telemetry.lastObservation = -Infinity;
  publishHostState(context);
}
async function recoverPlayback(context, error, token) {
  if (!context.session.controller.current(token) || context.recovery.active)
    return;
  context.recovery.active = true;
  const kind = error instanceof PlaybackFault ? error.kind : error instanceof TypeError || error instanceof DOMException && error.name === "TimeoutError" ? "network" : "source";
  const position = readPosition(context);
  const failure = {
    kind,
    message: error instanceof Error ? error.message : String(error),
    recoverable: true
  };
  const readout = context.media.runtime?.readout;
  context.recovery.history.record({
    atMilliseconds: performance.now(),
    sourceGeneration: context.session.controller.source,
    seekGeneration: context.session.controller.seek,
    positionSeconds: position,
    delivery: context.media.source?.delivery ?? null,
    backend: context.media.backend,
    kind,
    message: failure.message,
    bufferAheadSeconds: readout?.bufferAheadSeconds ?? null,
    readAheadSeconds: readout?.readAheadSeconds ?? null
  });
  if (context.watchdog.startTimer)
    clearTimeout(context.watchdog.startTimer);
  context.watchdog.startTimer = undefined;
  playbackMark("source:failed");
  context.playback.status = "recovering";
  context.playback.failure = failure;
  publishHostState(context, true);
  try {
    const retry = context.media.backend === "webgpu" && (!failure.message.startsWith("Original first-frame deadline") || context.media.runtime?.readout.decoderReady) ? decoderRetry(failure.message) : null;
    if (retry && context.media.source && !context.recovery.localDecoderRetries.has(context.media.source.id)) {
      context.recovery.localDecoderRetries.add(context.media.source.id);
      context.recovery.active = false;
      await activateSource(context, context.media.source, position, true, true, retry);
      return;
    }
    if (context.media.backend === "webgpu" && context.media.source && context.media.source.delivery === "hls" && !context.recovery.browserFallbacks.has(routeKey(context, context.media.source))) {
      context.recovery.browserFallbacks.add(routeKey(context, context.media.source));
      if (context.recovery.browserFallbacks.size > 32)
        context.recovery.browserFallbacks.delete(context.recovery.browserFallbacks.values().next().value);
      context.recovery.active = false;
      await activateSource(context, context.media.source, position, true, true);
      return;
    }
    context.playback.resumePosition = position;
    releaseOriginal(context);
    await delay(300, token.signal);
    if (!context.surface.video.error && context.surface.video.readyState >= 3 && (!context.surface.video.paused || !context.playback.wantsPlay)) {
      context.playback.status = context.surface.video.paused ? "paused" : "playing";
      context.playback.failure = null;
      context.telemetry.lastObservation = -Infinity;
      publishHostState(context);
      return;
    }
    const source = candidateSources(context).find((s) => !context.recovery.attempted.has(s.id) && s.recoveryAllowed !== false && s.timeline === context.media.source?.timeline && s.edition === context.media.source?.edition && (!context.tracks.audio || s.audioTrackId === context.tracks.audio));
    if (!source) {
      const pending = context.session.current?.onDemandSources?.find((s) => !context.recovery.attempted.has(s.id));
      if (pending && context.session.current?.serverControlled) {
        context.recovery.attempted.add(pending.id);
        requestSwitch(context, pending, position, true);
        return;
      }
      failPlayback(context, { ...failure, recoverable: false });
      return;
    }
    context.recovery.active = false;
    if (context.session.current?.serverControlled)
      requestSwitch(context, source, position, true);
    else
      await activateSource(context, source, position, true);
  } catch (e) {
    if (context.session.controller.current(token))
      failPlayback(context, { kind, message: String(e), recoverable: false });
  } finally {
    context.recovery.active = false;
  }
}

// client/player/host/native-events.ts
function detachMedia(context) {
  for (const remove of context.lifecycle.listeners)
    remove();
  context.lifecycle.listeners = [];
}
function bindMedia(context, token) {
  const { video } = context.surface;
  detachMedia(context);
  for (const [name, handler] of Object.entries({
    volumechange: () => {
      saveVolume(context);
    },
    playing: () => {
      if (!context.surface.video.paused && !context.surface.video.error && context.surface.video.readyState >= 3) {
        context.playback.status = "playing";
        context.playback.failure = null;
        if (context.session.pendingSeek?.authorized)
          context.session.pendingSeek = undefined;
      }
    },
    seeked: () => {
      if (context.session.pendingSeek?.authorized && !context.playback.wantsPlay && context.surface.video.readyState >= 2)
        context.session.pendingSeek = undefined;
    },
    pause: () => {
      if (!context.playback.wantsPlay && !["loading", "recovering", "failed", "ended"].includes(context.playback.status))
        context.playback.status = "paused";
    },
    waiting: () => {
      if (!["recovering", "ended", "failed"].includes(context.playback.status))
        context.playback.status = "buffering";
    },
    ended: () => {
      endPlayback(context);
    },
    error: () => {
      const e = video.error;
      if (!e || !context.session.current || context.lifecycle.disposed || ["failed", "ended"].includes(context.playback.status))
        return;
      const kind = e.code === 2 ? "network" : e.code === 3 ? "decoder" : "source";
      recoverPlayback(context, new PlaybackFault(e.message || `Media error ${e.code}`, kind), context.session.controller.token());
    }
  })) {
    const listener = () => {
      if (!context.session.controller.current(token) || ["failed", "ended"].includes(context.playback.status) || context.media.backend === "webgpu" && name !== "volumechange")
        return;
      const previous = context.playback.status;
      const failure = context.playback.failure;
      handler();
      if (previous !== context.playback.status || failure !== context.playback.failure)
        context.telemetry.lastObservation = -Infinity;
      publishHostState(context);
    };
    video.addEventListener(name, listener);
    context.lifecycle.listeners.push(() => video.removeEventListener(name, listener));
  }
}

// client/player/host/file-retention.ts
function canRetainOriginal(context, session, source) {
  const previous = context.session.current;
  const current = context.media.source;
  const original = context.media.runtime;
  if (!previous || !current || !original?.retainsSource || !context.media.runtimeJob || context.media.runtimeJob.signal.aborted || session.serverState === "ended" || session.id !== previous.id || session.mediaId !== previous.mediaId || session.sourceGeneration !== context.session.controller.source || session.seekGeneration === context.session.controller.seek || !source.original || source.delivery !== "file" || source.delivery !== current.delivery || source.id !== current.id || source.url !== current.url || source.edition !== current.edition || source.timeline !== current.timeline || source.sourceRevision !== current.sourceRevision || source.timelineOriginSeconds !== current.timelineOriginSeconds || (session.subtitleTrackId ?? null) !== context.tracks.subtitle)
    return false;
  const identities = (tracks) => JSON.stringify(tracks.map((track) => [track.id, track.streamIndex]));
  if (identities(session.audioTracks) !== identities(previous.audioTracks))
    return false;
  const selected = context.tracks.audioPreference && session.audioTracks.some((track) => track.id === context.tracks.audioPreference) ? context.tracks.audioPreference : session.audioTrackId ?? null;
  return selected === original.readout.audioTrackId;
}
async function seekRetainedOriginal(context, session, source) {
  const original = context.media.runtime;
  const previous = context.session.current?.serverState;
  const token = context.session.controller.start(session.id, session.sourceGeneration, session.seekGeneration);
  context.media.runtimeGeneration = token;
  context.session.current = session;
  context.media.source = source;
  context.tracks.pendingTracks = undefined;
  context.session.pendingSwitch = undefined;
  context.session.pendingSeek = {
    position: session.position ?? 0,
    startedAt: performance.now(),
    authorized: true
  };
  resetProgress(context, session.position ?? 0);
  context.playback.status = "buffering";
  context.playback.failure = null;
  context.telemetry.lastObservation = -Infinity;
  applyServerState(context, session.serverState, previous);
  publishHostState(context);
  try {
    if (context.playback.wantsPlay)
      original.resume();
    else
      original.pause();
    const seeking = original.seek(session.position ?? 0);
    if (context.tracks.overlay)
      context.tracks.overlay.seek(session.position ?? 0, ++context.tracks.overlayEpoch).catch(() => {});
    await seeking;
    if (!context.session.controller.current(token) || context.media.runtime !== original)
      return;
    resetProgress(context, original.position);
    context.session.pendingSeek = undefined;
    context.playback.status = original.readout.state;
    context.telemetry.lastObservation = -Infinity;
    publishHostState(context);
  } catch (error) {
    if (context.session.controller.current(token) && context.media.runtime === original)
      await recoverPlayback(context, error, token);
  }
}

// client/player/host/session.ts
function retireMediaAuthorization(context) {
  context.recovery.history.clear();
  context.session.controller.stop();
  detachMedia(context);
  resetMedia(context);
  context.session.current = undefined;
  context.media.source = undefined;
  context.session.pendingSeek = undefined;
  context.session.pendingSwitch = undefined;
  context.tracks.pendingTracks = undefined;
  context.playback.failure = null;
  context.playback.status = "idle";
}
async function loadSession(context, session) {
  if (!context.lifecycle.timer)
    context.lifecycle.timer = setInterval(() => {
      checkWaiting(context);
      adaptLive(context);
      adaptCoreQuality(context);
      publishHostState(context);
    }, 1000);
  if (session.id !== context.session.current?.id || session.sourceGeneration !== context.session.controller.source || session.seekGeneration !== context.session.controller.seek)
    context.recovery.localDecoderRetries.clear();
  const retained = session.sources.find((source) => source.id === session.selectedSourceId);
  if (retained && canRetainOriginal(context, session, retained)) {
    await seekRetainedOriginal(context, session, retained);
    return;
  }
  const pending = context.session.pendingSwitch;
  const handoff = pending && pending.sessionId === session.id && pending.sourceId === session.selectedSourceId && session.sourceGeneration !== undefined && session.seekGeneration !== undefined && session.sourceGeneration >= pending.source && session.sourceGeneration <= pending.source + 1 && session.seekGeneration >= pending.seek && session.seekGeneration <= pending.seek + 1 && (session.sourceGeneration > pending.source || session.seekGeneration > pending.seek);
  const position = handoff ? Math.max(pending.position, readPosition(context)) : session.position ?? 0;
  const recovery = !!handoff && pending.recovery;
  context.session.pendingSwitch = undefined;
  if (session.id !== context.session.current?.id)
    context.session.pendingSeek = undefined;
  else if (context.session.pendingSeek && session.seekGeneration !== context.session.controller.seek)
    context.session.pendingSeek = {
      ...context.session.pendingSeek,
      position: session.position ?? context.session.pendingSeek.position,
      authorized: true
    };
  const previousServerState = session.id === context.session.current?.id ? context.session.current.serverState : undefined;
  if (session.id !== context.session.current?.id || session.selectedSourceId !== context.media.source?.id) {
    context.quality.manual = null;
    context.quality.automatic.reset();
  }
  if (session.id !== context.session.current?.id) {
    context.recovery.history.clear();
    context.recovery.browserFallbacks.clear();
    context.tracks.subtitleFailures.clear();
    context.tracks.subtitleFailureNotes = [];
    context.tracks.subtitlePreference = undefined;
    context.tracks.deferredPath = null;
    context.tracks.audioPreference = undefined;
    context.playback.localIntent = undefined;
    context.live.latency.reset(session.livePolicy);
    context.live.networkRetries = 0;
    context.playback.wantsPlay = session.serverState !== "paused" && session.serverState !== "ended";
  }
  context.session.controller.start(session.id, session.sourceGeneration, session.seekGeneration);
  resetMedia(context);
  context.session.current = session;
  context.tracks.pendingTracks = undefined;
  if (session.serverState === "ended") {
    context.media.source = session.sources.find((s) => s.id === session.selectedSourceId);
    endPlayback(context, session.position ?? 0);
    return;
  }
  applyServerState(context, session.serverState, previousServerState, false);
  context.media.source = undefined;
  context.playback.failure = null;
  context.recovery.attempted.clear();
  context.recovery.active = false;
  adaptLive(context);
  const preferred = context.tracks.audioPreference;
  const selected = session.sources.find((s) => s.id === session.selectedSourceId);
  context.tracks.audio = preferred && (selected?.audioRenditions?.some((a) => a.trackId === preferred) || selected?.original && session.audioTracks.some((track) => track.id === preferred)) ? preferred : session.audioTrackId ?? null;
  context.tracks.subtitle = context.tracks.subtitlePreference !== undefined ? context.tracks.subtitlePreference : session.subtitleTrackId ?? null;
  const source = candidateSources(context).find((s) => s.id === session.selectedSourceId) ?? candidateSources(context).find((s) => !context.tracks.audio || s.audioTrackId === context.tracks.audio) ?? candidateSources(context)[0];
  if (!source) {
    failPlayback(context, {
      kind: "unsupported",
      message: "No browser-compatible source for this edition",
      recoverable: false
    });
    return;
  }
  if (context.tracks.deferredPath) {
    const id = context.tracks.deferredPath;
    context.tracks.deferredPath = null;
    if (id !== source.id && (session.sources.some((s) => s.id === id) || session.onDemandSources?.some((s) => s.id === id))) {
      context.media.source = source;
      context.playback.status = "buffering";
      requestSwitch(context, { id, onDemand: true }, Math.max(position, context.tracks.deferredPosition));
      publishHostState(context);
      return;
    }
  }
  await activateSource(context, source, position, recovery, true);
}
function updateSession(context, session) {
  if (session.id !== context.session.current?.id)
    throw new Error("Cannot update a different session");
  const next = session.sources.find((source) => source.id === context.media.source?.id);
  const current = context.media.source;
  if (next && current && (next.url !== current.url || next.delivery !== current.delivery || next.sourceRevision !== current.sourceRevision || next.timeline !== current.timeline || next.timelineOriginSeconds !== current.timelineOriginSeconds)) {
    const replacement = {
      ...session,
      position: context.session.pendingSeek?.position ?? readPosition(context)
    };
    loadSession(context, replacement).catch((error) => {
      if (!context.lifecycle.disposed && context.session.current === replacement)
        failPlayback(context, {
          kind: "source",
          message: error instanceof Error ? error.message : "Updated media source could not be opened",
          recoverable: true
        });
    });
    return;
  }
  const previousState = context.session.current?.serverState;
  context.session.current = session;
  if (context.tracks.pendingTracks && (context.tracks.pendingTracks.audio === undefined || context.tracks.pendingTracks.audio === session.audioTrackId) && (context.tracks.pendingTracks.subtitle === undefined || context.tracks.pendingTracks.subtitle === (session.subtitleTrackId ?? null)))
    context.tracks.pendingTracks = undefined;
  const source = session.sources.find((s) => s.id === context.media.source?.id);
  if (source) {
    context.media.source = source;
    context.media.pipeline?.updateRenditions(source.renditions ?? []);
  }
  applyServerState(context, session.serverState, previousState);
  if (context.playback.status === "ended")
    return;
  adaptLive(context);
  if (context.media.pipeline)
    context.media.pipeline.maxLiveDrift = session.liveMaxDrift ?? 45;
  if (context.tracks.subtitlePreference !== undefined && (session.subtitleTrackId ?? null) === context.tracks.subtitlePreference)
    context.tracks.subtitlePreference = undefined;
  if (context.tracks.subtitlePreference === undefined && (session.subtitleTrackId ?? null) !== context.tracks.subtitle) {
    context.tracks.subtitle = session.subtitleTrackId ?? null;
    applySubtitle(context);
  }
  if ((session.audioTrackId ?? null) !== context.tracks.audio) {
    if (context.media.runtime?.supportsLocalAudioSwitch !== false && context.media.runtime && (context.media.runtime.readout.audioTrackId === (session.audioTrackId ?? null) || context.media.runtime.pendingAudioTrackId === (session.audioTrackId ?? null))) {
      context.tracks.audio = session.audioTrackId ?? null;
      return;
    }
    if (context.media.runtime && context.tracks.audioPreference === context.tracks.audio && session.audioTracks.some((track) => track.id === context.tracks.audio))
      return;
    const previous = context.tracks.audio;
    const preferred = context.tracks.audioPreference;
    const selected = session.sources.find((s) => s.id === session.selectedSourceId);
    context.tracks.audio = preferred && selected?.audioRenditions?.some((a) => a.trackId === preferred) ? preferred : session.audioTrackId ?? null;
    if (!applyNativeAudio(context)) {
      context.tracks.audio = previous;
      emitHostEvent(context, {
        type: "error",
        failure: {
          kind: "action",
          message: "Audio change requires a new server source generation",
          recoverable: true
        }
      });
    }
  }
}
function applyServerState(context, state, previous, touchVideo = true) {
  if (state === "ended") {
    endPlayback(context);
    return;
  }
  if (state !== "paused" && state !== "playing")
    return;
  if (context.playback.localIntent) {
    if (state === context.playback.localIntent)
      context.playback.localIntent = undefined;
    return;
  }
  if (state === previous)
    return;
  context.playback.wantsPlay = state === "playing";
  if (!touchVideo)
    return;
  if (state === "paused") {
    context.media.runtime?.pause();
    context.surface.video.pause();
    context.playback.status = "paused";
    publishHostState(context);
  } else if (context.surface.video.paused)
    playMedia(context);
}
function endPlayback(context, position) {
  if (context.playback.status === "ended" && context.playback.terminalMedia)
    return;
  context.playback.terminalMedia = {
    position: position ?? readPosition(context),
    duration: readDuration(context),
    ...readFrameMetrics(context)
  };
  context.session.pendingSeek = undefined;
  releaseOriginal(context);
  detachMedia(context);
  context.playback.status = "ended";
  context.playback.failure = null;
  context.playback.wantsPlay = false;
  context.playback.localIntent = undefined;
  context.session.controller.cancel();
  context.media.pipeline?.dispose();
  context.media.pipeline = undefined;
  context.tracks.nativeTrack?.remove();
  context.tracks.nativeTrack = undefined;
  if (context.lifecycle.timer)
    clearInterval(context.lifecycle.timer);
  context.lifecycle.timer = undefined;
  context.surface.video.pause();
  context.surface.video.removeAttribute("src");
  context.surface.video.load();
  context.telemetry.lastObservation = -Infinity;
  publishHostState(context);
}

// client/player/host/command-seek.ts
async function seekFromCommand(context, command) {
  if (!Number.isFinite(command.seconds) || command.seconds < 0 || readDuration(context) !== null && command.seconds > readDuration(context))
    throw new Error("Seek outside media timeline");
  if (context.session.current?.live && context.media.runtime?.live) {
    const original = context.media.runtime;
    const bounds = original.live;
    if (!bounds)
      throw new Error("Live source was retired");
    if (command.seconds < bounds.startSeconds || command.seconds >= bounds.edgeSeconds)
      throw new Error("Seek is outside the retained live window");
    const token = context.session.controller.token();
    context.session.pendingSeek = {
      position: command.seconds,
      startedAt: performance.now(),
      authorized: true
    };
    context.playback.status = "buffering";
    publishHostState(context, true);
    resetProgress(context, command.seconds);
    if (context.tracks.overlay)
      context.tracks.overlay.seek(command.seconds, ++context.tracks.overlayEpoch).catch(() => {});
    await original.seek(command.seconds);
    if (context.session.controller.current(token) && context.media.runtime === original) {
      resetProgress(context, original.position);
      context.session.pendingSeek = undefined;
      context.playback.status = original.readout.state;
    }
    return true;
  }
  if (context.session.current?.serverControlled) {
    requestSeek(context, command.seconds);
    return true;
  }
  const token = context.session.controller.changeSeek();
  resetProgress(context, command.seconds);
  if (context.media.runtime) {
    const original = context.media.runtime;
    context.media.runtimeGeneration = token;
    context.session.pendingSeek = {
      position: command.seconds,
      startedAt: performance.now(),
      authorized: true
    };
    publishHostState(context, true);
    if (context.tracks.overlay)
      context.tracks.overlay.seek(command.seconds, ++context.tracks.overlayEpoch).catch(() => {});
    await original.seek(command.seconds);
    if (context.session.controller.current(token) && context.media.runtime === original) {
      resetProgress(context, original.position);
      context.session.pendingSeek = undefined;
      context.playback.status = original.readout.state;
    }
  } else if (context.media.backend === "mse" && context.media.source)
    await activateSource(context, context.media.source, command.seconds, false, true);
  else
    context.surface.video.currentTime = Math.max(0, command.seconds - context.media.nativeOrigin);
  return true;
}

// client/player/host/command-tracks.ts
async function selectAudioFromCommand(context, command) {
  if (!(context.media.runtime && context.media.runtime.supportsLocalAudioSwitch !== false ? context.media.runtime.audioTrackIds : context.session.current?.audioTracks.map((track) => track.id) ?? []).includes(command.trackId))
    throw new Error("Unknown audio track");
  if (context.media.runtime && context.media.runtime.supportsLocalAudioSwitch !== false) {
    const original = context.media.runtime;
    await original.selectAudio(command.trackId);
    if (context.media.runtime !== original || original.readout.audioTrackId !== command.trackId)
      return false;
    context.tracks.audio = command.trackId;
    context.tracks.audioPreference = command.trackId;
    return true;
  }
  if (context.media.pipeline?.audioTracks.includes(command.trackId)) {
    context.tracks.audioPreference = command.trackId;
    try {
      await context.media.pipeline.selectAudio(command.trackId);
    } catch (error) {
      if (context.tracks.audioPreference === command.trackId)
        context.tracks.audioPreference = context.tracks.audio ?? undefined;
      throw error;
    }
    return true;
  }
  if (context.session.current?.serverControlled && !nativeAudio(context, command.trackId)) {
    requestTracks(context, { audio: command.trackId });
    return true;
  }
  const previous = context.tracks.audio;
  context.tracks.audio = command.trackId;
  if (applyNativeAudio(context))
    return true;
  const source = candidateSources(context).find((s) => s.audioTrackId === command.trackId && s.timeline === context.media.source?.timeline);
  if (!source) {
    context.tracks.audio = previous;
    throw new Error("Audio selection requires a compatible server source");
  }
  await activateSource(context, source, readPosition(context));
  return true;
}
async function selectSubtitleFromCommand(context, command) {
  if (context.media.runtime?.supportsSubtitles) {
    const overlay = await ensureOverlay(context);
    const local = overlay.tracks.find((track) => track.id === command.trackId);
    const burned = context.session.current?.subtitleTracks.some((t) => t.id === context.tracks.subtitle && t.delivery?.kind === "burn-in");
    if (!burned && (command.trackId === null || local?.delivery.kind !== "burn-in" && !!local)) {
      context.tracks.subtitlePreference = command.trackId;
      context.tracks.subtitle = command.trackId;
      await overlay.select(command.trackId);
      return true;
    }
  }
  const selected = command.trackId ? context.session.current?.subtitleTracks.find((t) => t.id === command.trackId) : null;
  if (command.trackId && !selected)
    throw new Error("Unknown subtitle track");
  const current = context.session.current?.subtitleTracks.find((t) => t.id === context.tracks.subtitle);
  if (selected?.delivery?.kind === "burn-in" || current?.delivery?.kind === "burn-in") {
    requestTracks(context, { subtitle: command.trackId });
    return true;
  }
  if (context.media.runtime && command.trackId && context.session.current?.serverControlled) {
    requestTracks(context, { subtitle: command.trackId });
    return true;
  }
  if (context.media.runtime && command.trackId)
    throw new Error("This source has no installed subtitle renderer");
  if (command.trackId && !context.session.current?.subtitleTracks.some((t) => t.id === command.trackId && t.url))
    throw new Error("Unknown WebVTT track");
  context.tracks.subtitlePreference = command.trackId;
  context.tracks.subtitle = command.trackId;
  applySubtitle(context);
  return true;
}

// client/player/host/command-selection.ts
async function switchPathFromCommand(context, command) {
  const source = candidateSources(context).find((s) => s.id === command.pathId) ?? context.session.current?.onDemandSources?.find((s) => s.id === command.pathId);
  if (!source || source.id === context.media.source?.id)
    return true;
  if (context.session.current?.serverControlled) {
    const audio = context.tracks.audio && context.session.current.audioTracks.some((t) => t.id === context.tracks.audio) && context.tracks.audio !== context.session.current.audioTrackId ? context.tracks.audio : undefined;
    const subtitle = context.tracks.overlay?.tracks.find((t) => t.id === context.tracks.subtitle);
    const burn = subtitle?.delivery.kind === "embedded" && subtitle.codec === "pgs" ? subtitle.serverId : undefined;
    if (audio || burn) {
      context.tracks.deferredPath = source.id;
      context.tracks.deferredPosition = readPosition(context);
      requestTracks(context, { ...audio ? { audio } : {}, ...burn ? { subtitle: burn } : {} });
    } else
      requestSwitch(context, { id: source.id, onDemand: true }, readPosition(context));
  } else if (!("onDemand" in source) && source.recoveryAllowed !== false)
    await activateSource(context, source, readPosition(context));
  return true;
}
async function selectQualityFromCommand(context, command) {
  if (command.renditionId?.startsWith("path:")) {
    await executeCommand(context, {
      id: command.id,
      type: "switchPath",
      pathId: command.renditionId.slice(5)
    });
    return true;
  }
  const chosen = context.media.source?.renditions?.find((r) => r.id === command.renditionId);
  if (command.renditionId && !chosen)
    throw new Error("Unknown quality rendition");
  if (context.media.source?.delivery !== "hls") {
    if (command.renditionId)
      throw new Error("Original quality is fixed");
    return true;
  }
  context.quality.manual = command.renditionId;
  if (context.media.runtime) {
    const previous = context.quality.automatic.id;
    context.quality.automatic.pin(command.renditionId, context.media.source.renditions ?? []);
    if (!command.renditionId || command.renditionId === previous)
      return true;
  }
  if (context.media.pipeline && (!chosen || context.media.pipeline.qualityIds.includes(chosen.id)))
    context.media.pipeline.abr.manual = command.renditionId;
  else if (context.media.source)
    await activateSource(context, context.media.source, readPosition(context), false, true);
  return true;
}

// client/player/universal/subtitles/types.ts
var defaultSubtitlePreferences = {
  subtitleSize: "medium",
  subtitleBackground: "shadow",
  subtitleColor: "white",
  subtitlePosition: "bottom",
  offsetSeconds: 0
};

// client/player/universal/subtitles/preferences.ts
var choices = {
  subtitleSize: ["small", "medium", "large", "xl"],
  subtitleBackground: ["none", "shadow", "box"],
  subtitleColor: ["white", "yellow"],
  subtitlePosition: ["bottom", "raised"]
};
function readSubtitlePreferences() {
  const result = { ...defaultSubtitlePreferences };
  try {
    for (const name of Object.keys(choices)) {
      const value = localStorage.getItem(`vela.player.${name}`);
      if (value && choices[name].includes(value))
        Object.assign(result, { [name]: value });
    }
  } catch {}
  return result;
}
function updateSubtitlePreference(current, command) {
  const match = /^(subtitleSize|subtitleBackground|subtitleColor|subtitlePosition)=([a-z]+)$/.exec(command);
  if (!match || !choices[match[1]].includes(match[2]))
    throw new Error("Invalid subtitle appearance preference");
  const next = { ...current, [match[1]]: match[2] };
  try {
    localStorage.setItem(`vela.player.${match[1]}`, match[2]);
  } catch {}
  return next;
}

// client/player/host/commands.ts
async function executeCommand(context, command) {
  if (context.lifecycle.disposed)
    return;
  try {
    switch (command.type) {
      case "play":
        context.playback.localIntent = "playing";
        context.playback.wantsPlay = true;
        await playMedia(context);
        break;
      case "pause":
        context.playback.localIntent = "paused";
        context.playback.wantsPlay = false;
        context.media.runtime?.pause();
        context.surface.video.pause();
        break;
      case "retry":
        if (context.session.current)
          await loadSession(context, {
            ...context.session.current,
            position: context.playback.terminalMedia?.position ?? readPosition(context)
          });
        break;
      case "switchPath":
        if (!await switchPathFromCommand(context, command))
          return;
        break;
      case "seekBy": {
        if (!Number.isFinite(command.seconds))
          throw new Error("Invalid relative seek");
        const upper = readDuration(context) ?? Infinity;
        await executeCommand(context, {
          id: command.id,
          type: "seek",
          seconds: Math.max(0, Math.min(upper, (context.session.pendingSeek?.position ?? readPosition(context)) + command.seconds))
        });
        break;
      }
      case "seek":
        if (!await seekFromCommand(context, command))
          return;
        break;
      case "catchUp": {
        const target = catchUpTarget(context);
        if (target === null)
          throw new Error("No newer usable live buffer or seekable range");
        await executeCommand(context, { id: command.id, type: "seek", seconds: target });
        break;
      }
      case "mute":
        context.surface.video.muted = command.muted ?? !context.surface.video.muted;
        context.media.runtime?.setMuted(context.surface.video.muted);
        saveVolume(context);
        context.telemetry.lastObservation = -Infinity;
        break;
      case "volume":
        if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1)
          throw new Error("Volume outside 0–1");
        context.surface.video.volume = command.value;
        context.media.runtime?.setVolume(command.value);
        if (command.value > 0)
          context.surface.video.muted = false;
        context.media.runtime?.setMuted(context.surface.video.muted);
        saveVolume(context);
        context.telemetry.lastObservation = -Infinity;
        break;
      case "speed":
        if (context.session.current?.live)
          throw new Error("Live playback speed is managed automatically");
        if (!Number.isFinite(command.value) || command.value < 0.5 || command.value > 2)
          throw new Error("Playback speed must be between 0.5 and 2");
        if (context.media.runtime) {
          if (!context.media.runtime.setSpeed)
            throw new Error("Playback speed requires an updated runtime");
          await context.media.runtime.setSpeed(command.value);
        } else
          context.surface.video.playbackRate = command.value;
        context.playback.speed = command.value;
        break;
      case "subtitleStyle":
        context.tracks.subtitleStyle = updateSubtitlePreference(context.tracks.subtitleStyle, command.value);
        context.tracks.overlay?.setPreferences(context.tracks.subtitleStyle);
        break;
      case "quality":
        if (!await selectQualityFromCommand(context, command))
          return;
        break;
      case "audio":
        if (!await selectAudioFromCommand(context, command))
          return;
        break;
      case "subtitle":
        if (!await selectSubtitleFromCommand(context, command))
          return;
        break;
      case "lowDelay":
        break;
      case "pip":
        if (!pipAvailable(context))
          throw new Error("Picture-in-picture is unavailable");
        if (document.pictureInPictureElement === context.surface.video)
          await document.exitPictureInPicture();
        else if (document.pictureInPictureEnabled && context.surface.video.requestPictureInPicture)
          await context.surface.video.requestPictureInPicture();
        else
          context.surface.video.webkitSetPresentationMode?.("picture-in-picture");
        break;
      case "fullscreen":
        if (!fullscreenAvailable(context))
          throw new Error("Fullscreen is unavailable");
        if (document.fullscreenElement === context.surface.fullscreenContainer)
          await document.exitFullscreen();
        else if (document.fullscreenEnabled && context.surface.fullscreenContainer.requestFullscreen)
          await context.surface.fullscreenContainer.requestFullscreen();
        else if (context.surface.video.webkitDisplayingFullscreen)
          context.surface.video.webkitExitFullscreen?.();
        else if (context.surface.video.webkitEnterFullscreen)
          context.surface.video.webkitEnterFullscreen();
        else
          throw new Error("Fullscreen is unavailable");
        break;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError")
      return;
    emitHostEvent(context, {
      type: "error",
      failure: { kind: "action", message: e instanceof Error ? e.message : String(e), recoverable: true }
    });
  }
  publishHostState(context);
}

// client/player/host/lifecycle.ts
function disposeHost(context) {
  context.lifecycle.disposed = true;
  context.session.controller.stop();
  clearInterval(context.lifecycle.timer);
  for (const remove of context.lifecycle.listeners)
    remove();
  context.lifecycle.listeners = [];
  resetMedia(context);
  context.session.current = undefined;
}

// client/player/core/quality.ts
class CoreQuality {
  selected = null;
  locked = null;
  since = 0;
  stalled = null;
  switched = -Infinity;
  get id() {
    return this.selected;
  }
  get manual() {
    return this.locked;
  }
  reset() {
    this.selected = null;
    this.locked = null;
    this.since = 0;
    this.stalled = null;
    this.switched = -Infinity;
  }
  choose(ladder, initial, now = performance.now()) {
    const current = ladder.find((r) => r.id === (this.locked ?? this.selected));
    const selected = current ?? ladder.find((r) => r.id === initial) ?? ladder[0];
    if (selected && selected.id !== this.selected) {
      this.selected = selected.id;
      this.since = now;
      this.stalled = null;
    }
    return selected;
  }
  pin(id, ladder) {
    if (id && !ladder.some((r) => r.id === id))
      throw new Error("Unknown quality rendition");
    this.locked = id;
    this.stalled = null;
    if (id) {
      this.selected = id;
      this.since = performance.now();
    }
  }
  sample(ladder, waiting, throughput, now = performance.now()) {
    if (this.locked || !this.selected || now - this.since < 1e4 || now - this.switched < 30000)
      return;
    const current = ladder.find((r) => r.id === this.selected);
    if (!current)
      return;
    if (!waiting) {
      this.stalled = null;
      return;
    }
    this.stalled ??= now;
    if (now - this.stalled < 5000)
      return;
    const lower = ladder.filter((r) => r.bandwidth < current.bandwidth).sort((a, b) => a.bandwidth - b.bandwidth);
    const next = throughput === null ? lower.at(-1) : lower.filter((r) => r.bandwidth * 1.4 < throughput).at(-1) ?? lower[0];
    if (!next)
      return;
    this.selected = next.id;
    this.since = now;
    this.switched = now;
    this.stalled = null;
    return next;
  }
}

// client/player/live-latency.ts
var clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class LiveLatency {
  preference;
  target = null;
  last = 0;
  steady = null;
  cooldown = 0;
  lastRelax = -Infinity;
  hasPlayed = false;
  reset(preference) {
    this.preference = preference;
    this.target = null;
    this.last = 0;
    this.steady = null;
    this.cooldown = 0;
    this.lastRelax = -Infinity;
    this.hasPlayed = false;
  }
  setPreference(preference) {
    if (preference?.latencyProfile === this.preference?.latencyProfile && preference?.targetLatencySeconds === this.preference?.targetLatencySeconds)
      return;
    this.preference = preference;
    this.steady = null;
  }
  sample(sample) {
    const segment = Number.isFinite(sample.segmentSeconds) && sample.segmentSeconds > 0 ? clamp(sample.segmentSeconds, 0.2, 10) : 2;
    const goal = sample.bufferGoalSeconds !== undefined && Number.isFinite(sample.bufferGoalSeconds) ? clamp(sample.bufferGoalSeconds, 0.5, segment * 2) : segment * 2;
    const profile = this.preference?.latencyProfile ?? "auto";
    const declared = this.preference?.targetLatencySeconds;
    const preferred = declared && Number.isFinite(declared) && declared > 0 ? declared : Math.max(6, segment * 2);
    const floor = Math.max(1, segment * 1.5);
    const ceiling = Math.max(floor, Math.min(40, sample.windowSeconds && sample.windowSeconds > 0 ? sample.windowSeconds * 0.75 : 40));
    const baseline = clamp(Math.max(preferred * 2, segment * 4, 12), floor, ceiling);
    this.target = clamp(this.target ?? baseline, floor, ceiling);
    const elapsed = this.last ? clamp((sample.now - this.last) / 1000, 0, 2) : 0;
    this.last = sample.now;
    if (sample.playing)
      this.hasPlayed = true;
    const bandwidthKnown = sample.throughputBps !== null && sample.bitrateBps !== null && sample.bitrateBps > 0;
    const headroom = bandwidthKnown ? sample.throughputBps / sample.bitrateBps : null;
    const starved = this.hasPlayed && (sample.waiting || sample.playing && sample.bufferAhead < Math.min(1, segment * 0.5));
    const insufficient = sample.playing && headroom !== null && headroom < 1.25;
    if (starved || insufficient) {
      this.steady = null;
      this.cooldown = sample.now + 30000;
      if (sample.now - this.lastRelax >= 5000) {
        this.target = clamp(Math.max(baseline, this.target + segment * 2), floor, ceiling);
        this.lastRelax = sample.now;
      }
    } else if (sample.playing && !sample.waiting && sample.bufferAhead >= Math.min(goal, this.target * 0.75) && (headroom === null ? sample.bufferAhead >= goal : headroom >= 1.5)) {
      this.steady ??= sample.now;
      const stableFor = sample.now - this.steady, threshold = profile === "low" ? 1e4 : profile === "stable" ? 45000 : 20000;
      if (sample.now >= this.cooldown && stableFor >= threshold) {
        const bias = profile === "stable" ? 1 : stableFor >= 60000 ? 0.9 : 1;
        const goal = clamp(preferred * bias, floor, ceiling);
        this.target = Math.max(goal, this.target - elapsed * 0.5);
      }
    } else
      this.steady = null;
    const steady = this.steady !== null && sample.now - this.steady >= 5000;
    const catchingUp = sample.playing && !sample.waiting && steady && sample.bufferAhead >= goal && sample.behindSeconds !== null && sample.behindSeconds > this.target + Math.max(1, segment);
    return { targetSeconds: this.target, playbackRate: catchingUp ? 1.03 : 1 };
  }
}

// client/player/media-auth.ts
var headerName = /^(accept|authorization|x-plex-token|x-emby-token|x-emby-authorization|x-plex-product|x-plex-version|x-plex-client-identifier|x-plex-platform|x-plex-device-name)$/i;
var urlSecrets = /^(api_key|x-plex-token|x-emby-token|access_token|authorization)$/i;
var aborted = () => new DOMException("Media authorization retired", "AbortError");
function parseMediaAuthorization(json) {
  if (!json)
    return;
  try {
    if (json.length > 16384)
      throw 0;
    const value = JSON.parse(json);
    const origin = new URL(value.origin);
    if (!value || typeof value.handle !== "string" || !value.handle || value.handle.length > 256 || !["https:", "http:"].includes(origin.protocol) || origin.origin !== value.origin || origin.username || origin.password || typeof value.pathPrefix !== "string" || !value.pathPrefix.startsWith("/") || value.pathPrefix.includes("?") || value.pathPrefix.includes("#") || /[\\\u0000-\u0020]|%(?:2f|5c|2e)/i.test(value.pathPrefix) || new URL(value.pathPrefix, origin).pathname !== value.pathPrefix || !value.headers || Array.isArray(value.headers) || typeof value.headers !== "object")
      throw 0;
    const entries = Object.entries(value.headers);
    if (entries.length < 1 || entries.length > 8 || entries.some(([key, text]) => !headerName.test(key) || typeof text !== "string" || !text || text.length > 8192 || /[\u0000-\u001f\u007f]/.test(text)))
      throw 0;
    return {
      handle: value.handle,
      origin: origin.origin,
      pathPrefix: value.pathPrefix,
      headers: Object.fromEntries(entries)
    };
  } catch {
    throw new Error("Invalid media authorization");
  }
}
function inside(auth, url) {
  return url.origin === auth.origin && (auth.pathPrefix === "/" || url.pathname === auth.pathPrefix || url.pathname.startsWith(auth.pathPrefix.endsWith("/") ? auth.pathPrefix : auth.pathPrefix + "/"));
}
function permittedMediaURL(input, authorization) {
  let url;
  try {
    url = new URL(String(input), typeof location === "undefined" ? undefined : location.href);
  } catch {
    throw new Error("Invalid media URL");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash || /%(?:2e|2f|5c|25)/i.test(url.pathname) || (authorization ? !inside(authorization, url) : url.origin !== location.origin))
    throw new Error("Media URL is outside its authorization scope");
  if (authorization) {
    for (const key of [...url.searchParams.keys()])
      if (urlSecrets.test(key))
        url.searchParams.delete(key);
  }
  return url;
}
function authorizedMediaFetch(auth, lifetime) {
  return async (input, init) => {
    lifetime?.throwIfAborted();
    const url = permittedMediaURL(input instanceof Request ? input.url : String(input), auth);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (auth)
      for (const [name, value] of Object.entries(auth.headers))
        headers.set(name, value);
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = lifetime ? AbortSignal.any([lifetime, ...requestSignal ? [requestSignal] : []]) : requestSignal;
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal,
        credentials: auth ? "omit" : "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer"
      });
      if (response.url)
        permittedMediaURL(response.url, auth);
      return response;
    } catch (error) {
      if (signal?.aborted)
        throw aborted();
      throw new TypeError("Media request failed");
    }
  };
}
function redactMediaError(message) {
  return message.replace(/https?:\/\/[^\s<>"']+/gi, (text) => {
    try {
      const url = new URL(text);
      return url.origin + url.pathname;
    } catch {
      return "[media URL]";
    }
  }).replace(/\b(?:api_key|x-plex-token|x-emby-token|access_token|authorization|token)\s*[=:]\s*[^\r\n]+/gi, "[media credential]").replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
}

class MediaAccess {
  request;
  value;
  json = "";
  retired = new AbortController;
  sequence = 0;
  disposed = false;
  pending = new Map;
  constructor(request) {
    this.request = request;
  }
  update(json) {
    if (this.disposed)
      throw aborted();
    if (json === this.json)
      return false;
    let next;
    try {
      next = parseMediaAuthorization(json);
    } catch (error) {
      this.retired.abort();
      this.cancel();
      this.value = undefined;
      this.json = "";
      throw error;
    }
    const changed = next?.handle !== this.value?.handle || JSON.stringify(next) !== JSON.stringify(this.value);
    this.retired.abort();
    this.retired = new AbortController;
    this.cancel();
    this.value = next;
    this.json = json;
    return changed;
  }
  authorization() {
    return this.value ? { ...this.value, headers: { ...this.value.headers } } : undefined;
  }
  allows(url) {
    try {
      permittedMediaURL(url, this.value);
      return true;
    } catch {
      return false;
    }
  }
  fetch = (input, init) => authorizedMediaFetch(this.value, this.retired.signal)(input, init);
  nativeURL(url, signal) {
    signal.throwIfAborted();
    this.retired.signal.throwIfAborted();
    const target = permittedMediaURL(url, this.value);
    if (!this.value)
      return Promise.resolve(target.href);
    const requestId = ++this.sequence, handle = this.value.handle;
    return new Promise((resolve, reject) => {
      const operation = AbortSignal.any([signal, this.retired.signal, AbortSignal.timeout(1e4)]);
      const abort = () => {
        cleanup();
        reject(aborted());
      };
      const cleanup = () => {
        operation.removeEventListener("abort", abort);
        this.pending.delete(requestId);
      };
      operation.addEventListener("abort", abort, { once: true });
      this.pending.set(requestId, { handle, url: target.href, resolve, reject, cleanup });
      try {
        this.request({ type: "native-media-request", requestId, handle, url: target.href });
      } catch {
        cleanup();
        reject(new Error("Native media authorization unavailable"));
      }
    });
  }
  accept(json) {
    if (!json || this.disposed)
      return;
    let reply;
    try {
      reply = JSON.parse(json);
    } catch {
      return;
    }
    const pending = this.pending.get(reply.requestId);
    if (!pending)
      return;
    try {
      if (!this.value || pending.handle !== this.value.handle || reply.handle !== pending.handle || !Number.isFinite(reply.expiresAt) || reply.expiresAt <= Date.now() || reply.expiresAt > Date.now() + 600000)
        throw 0;
      const url = new URL(reply.url), original = new URL(pending.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash || !inside(this.value, url) || url.pathname !== original.pathname)
        throw 0;
      pending.cleanup();
      pending.resolve(url.href);
    } catch {
      pending.cleanup();
      pending.reject(new Error("Native media authorization unavailable"));
    }
  }
  cancel() {
    for (const item of [...this.pending.values()]) {
      item.cleanup();
      item.reject(aborted());
    }
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    this.retired.abort();
    this.cancel();
    this.value = undefined;
    this.json = "";
  }
}

// client/player/recovery-history.ts
function recoveryMessage(message) {
  return redactMediaError(message).replace(/https?:\/\/[^\s<>"']+/gi, "[media URL]").replace(/\/(?:vela\/v0\/)?sessions\/media\/[^\s<>"']+/gi, "[media path]").slice(0, 512);
}

class RecoveryHistory {
  entries = [];
  record(entry) {
    this.entries.push({ ...entry, message: recoveryMessage(entry.message) });
    if (this.entries.length > 8)
      this.entries.shift();
  }
  snapshot() {
    return this.entries.map((entry) => ({ ...entry }));
  }
  get length() {
    return this.entries.length;
  }
  clear() {
    this.entries = [];
  }
}

// client/player/host/context.ts
function createHostContext(video, deliver, fullscreenContainer = video, ambient = false, mediaAccess) {
  const controller = new SessionController;
  const coreQuality = new CoreQuality;
  const browserFallbacks = new Set;
  const subtitleStyle = readSubtitlePreferences();
  const subtitleFailures = new Set;
  const localDecoderRetries = new Set;
  const originalClosing = Promise.resolve();
  const recoveryHistory = new RecoveryHistory;
  const attempted = new Set;
  const liveLatency = new LiveLatency;
  const context = {
    session: {
      controller,
      current: undefined,
      pendingSwitch: undefined,
      pendingSeek: undefined
    },
    media: {
      source: undefined,
      pipeline: undefined,
      runtime: undefined,
      runtimeJob: undefined,
      runtimeGeneration: undefined,
      closingRuntime: originalClosing,
      backend: null,
      nativeOrigin: 0
    },
    watchdog: {
      frameSeen: false,
      videoCallback: undefined,
      startTimer: undefined,
      startupDeadlineMs: 45000,
      waitSince: 0,
      everPlayed: false,
      lastPosition: 0,
      lastAdvance: 0
    },
    quality: {
      automatic: coreQuality,
      manual: null
    },
    tracks: {
      deferredPath: null,
      deferredPosition: 0,
      overlay: undefined,
      overlayJob: undefined,
      overlayLoading: undefined,
      overlayEpoch: 0,
      subtitleStyle,
      subtitleFailures,
      subtitleFailureNotes: [],
      audioPreference: undefined,
      subtitlePreference: undefined,
      audio: null,
      subtitle: null,
      pendingTracks: undefined,
      nativeTrack: undefined
    },
    recovery: {
      browserFallbacks,
      localDecoderRetries,
      history: recoveryHistory,
      attempted,
      active: false
    },
    playback: {
      status: "idle",
      failure: null,
      resumePosition: 0,
      terminalMedia: undefined,
      localIntent: undefined,
      wantsPlay: false,
      speed: 1
    },
    lifecycle: {
      timer: undefined,
      listeners: [],
      disposed: false
    },
    live: {
      latency: liveLatency,
      targetSeconds: 12,
      networkRetries: 0
    },
    telemetry: {
      lastObservation: 0
    },
    surface: {
      video,
      fullscreenContainer,
      ambient,
      mediaAccess
    },
    events: {
      deliver
    }
  };
  video.crossOrigin = "anonymous";
  video.playsInline = true;
  video.controls = false;
  video.preload = "auto";
  if (ambient) {
    video.defaultMuted = true;
    video.muted = true;
  } else
    try {
      const saved = localStorage.getItem("vela.player.volume");
      if (saved !== null && Number.isFinite(Number(saved)))
        video.volume = Math.max(0, Math.min(1, Number(saved)));
      video.muted = video.muted || localStorage.getItem("vela.player.muted") === "true";
    } catch {}
  context.lifecycle.timer = setInterval(() => {
    checkWaiting(context);
    adaptLive(context);
    adaptCoreQuality(context);
    publishHostState(context);
  }, 1000);
  return context;
}

// client/player/engine.ts
class PlaybackEngine {
  context;
  constructor(video, deliver, fullscreenContainer = video, ambient = false, mediaAccess) {
    this.context = createHostContext(video, deliver, fullscreenContainer, ambient, mediaAccess);
  }
  get video() {
    return this.context.surface.video;
  }
  get controller() {
    return this.context.session.controller;
  }
  retireMediaAuthorization() {
    return retireMediaAuthorization(this.context);
  }
  get observationAllowed() {
    return observationAllowed(this.context);
  }
  snapshot() {
    return snapshotHost(this.context);
  }
  load(session) {
    return loadSession(this.context, session);
  }
  updateSession(session) {
    return updateSession(this.context, session);
  }
  rejectCommand(message) {
    return rejectCommand(this.context, message);
  }
  command(command) {
    return executeCommand(this.context, command);
  }
  dispose() {
    return disposeHost(this.context);
  }
}

// client/player/protocol.ts
function sessionFromPlan(plan) {
  const selected = plan.paths.find((p) => p.id === plan.selectedPathId);
  if (!selected)
    throw new Error("Plan selected path is absent");
  const edition = selected.edition ?? "";
  return {
    id: plan.sessionId,
    serverState: plan.state,
    serverControlled: true,
    selectedSourceId: plan.selectedPathId,
    mediaId: plan.titleId ?? plan.channelId ?? plan.extraId ?? "",
    edition,
    position: plan.positionSeconds,
    duration: plan.durationSeconds,
    live: !!plan.channelId,
    livePolicy: plan.livePolicy,
    liveWindowStart: plan.live?.windowStartSeconds,
    liveEdge: plan.live?.liveEdgeSeconds,
    liveMaxDrift: plan.live?.maxDriftSeconds,
    lowDelay: plan.live?.mode === "low-delay",
    sourceGeneration: plan.sourceGeneration,
    seekGeneration: plan.seekGeneration,
    audioTrackId: plan.selectedAudioTrackId,
    subtitleTrackId: plan.selectedSubtitleTrackId ?? undefined,
    chapters: plan.chapters,
    audioTracks: plan.audioTracks.map((t) => ({
      id: t.id,
      label: t.name,
      language: t.language,
      codec: t.codec,
      channels: t.channels,
      streamIndex: t.streamIndex
    })),
    subtitleTracks: plan.subtitleTracks.map((t) => ({
      id: t.id,
      label: t.name,
      language: t.language,
      codec: t.codec,
      streamIndex: t.streamIndex,
      url: t.delivery?.kind === "external" ? t.delivery.url : t.url,
      delivery: t.delivery,
      forced: t.forced,
      hearingImpaired: t.hearingImpaired
    })),
    onDemandSources: plan.paths.filter((p) => p.readiness === "on-demand" && !!p.sourceId && p.sourceId === selected.sourceId && !!p.timelineId && p.timelineId === selected.timelineId && (p.edition ?? "") === edition).map((p) => ({ id: p.id, onDemand: true })),
    sources: plan.paths.filter((p) => p.readiness === "ready" && (p.edition ?? "") === edition).map((p) => ({
      id: p.id,
      strategy: p.kind,
      delivery: p.transport,
      url: p.url,
      mime: p.mimeType,
      edition: p.edition ?? "",
      timeline: p.timelineId ?? `unverified:${p.id}`,
      audioTrackId: plan.selectedAudioTrackId,
      boundaries: p.boundaries.filter((b) => b.independent).map((b) => b.atSeconds),
      recoveryAllowed: p.id === selected.id || !!selected.timelineId && !!p.timelineId && p.boundaries.some((b) => b.independent && (b.compatibility === "verified-timeline" || b.compatibility === "same-source" && !!p.sourceId && p.sourceId === selected.sourceId) && b.timelineId === selected.timelineId && (!plan.selectedAudioTrackId || b.audioTrackIds.includes(plan.selectedAudioTrackId)) && (!plan.selectedSubtitleTrackId || b.subtitleTrackIds.includes(plan.selectedSubtitleTrackId))),
      quality: p.quality,
      original: p.original,
      originalVideo: p.originalVideo,
      sourceRevision: p.sourceId,
      timelineOriginSeconds: p.timelineOriginSeconds,
      initialRenditionId: p.initialRenditionId,
      audioRenditions: p.audioRenditions,
      renditions: p.qualities.map((q) => ({
        id: q.id,
        url: q.url,
        bandwidth: q.bitrate,
        height: q.height,
        width: q.width,
        codec: q.codec ?? codecFamily(q.videoCodec),
        dynamicRange: q.dynamicRange,
        averageBitrate: q.averageBitrate,
        audioGroupId: q.audioGroupId,
        codecStatus: q.codecStatus === "pending" || !q.videoCodec.trim() ? "pending" : "verified",
        mime: `video/mp4; codecs="${q.videoCodec}${q.audioCodec ? `,${q.audioCodec}` : ""}"`
      }))
    }))
  };
}
function observation(snapshot, sequence) {
  if (!snapshot.sessionId || !snapshot.sourceId)
    return null;
  return {
    idempotencyKey: `${snapshot.sessionId}:${snapshot.sourceGeneration}:${snapshot.seekGeneration}:${sequence}`,
    sourceGeneration: snapshot.sourceGeneration,
    seekGeneration: snapshot.seekGeneration,
    sequence,
    observedAt: new Date().toISOString(),
    positionSeconds: snapshot.position,
    state: snapshot.state === "playing" ? "playing" : snapshot.state === "ended" ? "ended" : snapshot.state === "paused" ? "paused" : "buffering",
    playableRanges: snapshot.playable.map((r) => ({ startSeconds: r.start, endSeconds: r.end })),
    selectedPathId: snapshot.sourceId,
    ...snapshot.throughputBps === null ? {} : { throughputBps: snapshot.throughputBps },
    ...snapshot.droppedFrames === null ? {} : { droppedFrames: snapshot.droppedFrames },
    ...snapshot.totalFrames === null ? {} : { totalFrames: snapshot.totalFrames },
    ...snapshot.audioTrackId === null || snapshot.audioClientOnly ? {} : { audioTrackId: snapshot.audioTrackId },
    ...snapshot.subtitleClientOnly ? {} : { subtitleTrackId: snapshot.subtitleReportingId ?? snapshot.subtitleTrackId },
    ...snapshot.failure ? {
      error: {
        class: snapshot.failure.kind === "network" ? "transient" : snapshot.failure.kind === "decoder" ? "decoder" : "source",
        message: snapshot.failure.message
      }
    } : {}
  };
}

// client/player/browser-view.ts
function createBrowserPlayerView(element, json, event) {
  const ambient = JSON.parse(json).ambient === "true";
  const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  const video = document.createElement("video");
  video.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none";
  const surface = document.createElement("div");
  surface.style.cssText = "position:relative;width:100%;height:100%;isolation:isolate;z-index:0;pointer-events:none";
  const style = document.createElement("style");
  style.textContent = ".webgpuPlayerCanvas{position:absolute;display:block;z-index:1;opacity:0;pointer-events:none}" + ".webgpuPlayerCanvas-visible{opacity:1}";
  surface.append(video);
  root.replaceChildren(style, surface);
  const media = new MediaAccess((request) => event(8, JSON.stringify(request)));
  const handle = {
    media,
    engine: undefined,
    video,
    sessionJson: "",
    lastCommand: -1,
    planRevision: -1,
    planSession: "",
    sequence: 0,
    lastReport: 0,
    serverError: "",
    endedReport: "",
    reportedFailure: "",
    reportedTracks: ""
  };
  handle.engine = new PlaybackEngine(video, (value) => {
    if (value.type === "error")
      value = { ...value, failure: { ...value.failure, message: redactMediaError(value.failure.message) } };
    else if (value.type === "snapshot" && value.snapshot.failure)
      value = {
        ...value,
        snapshot: {
          ...value.snapshot,
          failure: { ...value.snapshot.failure, message: redactMediaError(value.snapshot.failure.message) }
        }
      };
    event(8, JSON.stringify(value));
    const now = performance.now();
    const failureKey = value.type === "snapshot" && value.snapshot.failure ? [
      value.snapshot.sessionId,
      value.snapshot.sourceGeneration,
      value.snapshot.seekGeneration,
      value.snapshot.sourceId,
      value.snapshot.failure.kind,
      value.snapshot.failure.message
    ].map(String).join(":") : "";
    const trackKey = value.type === "snapshot" ? JSON.stringify([
      value.snapshot.sessionId,
      value.snapshot.sourceGeneration,
      value.snapshot.seekGeneration,
      value.snapshot.audioTrackId,
      value.snapshot.subtitleTrackId
    ]) : "";
    if (value.type === "snapshot" && handle.engine.observationAllowed && (now - handle.lastReport >= 1000 || failureKey !== "" && failureKey !== handle.reportedFailure || trackKey !== handle.reportedTracks)) {
      if (failureKey)
        handle.reportedFailure = failureKey;
      const endedKey = [
        value.snapshot.sessionId,
        value.snapshot.sourceGeneration,
        value.snapshot.seekGeneration
      ].map(String).join(":");
      if (value.snapshot.state === "ended" && handle.endedReport === endedKey)
        return;
      if (value.snapshot.state === "ended")
        handle.endedReport = endedKey;
      const report = observation(value.snapshot, ++handle.sequence);
      if (report) {
        handle.lastReport = now;
        handle.reportedTracks = trackKey;
        event(8, JSON.stringify({ type: "observation", sessionId: value.snapshot.sessionId, observation: report }));
      }
    }
  }, element.parentElement ?? element, ambient, media);
  try {
    updateBrowserPlayerView(handle, json);
  } catch (error) {
    handle.engine.dispose();
    media.dispose();
    video.remove();
    throw error;
  }
  return handle;
}
function updateBrowserPlayerView(handle, json) {
  const props = JSON.parse(json);
  let changed;
  try {
    changed = handle.media.update(props.mediaAuth ?? "");
  } catch (error) {
    handle.engine.retireMediaAuthorization();
    throw error;
  }
  if (changed) {
    handle.engine.retireMediaAuthorization();
    handle.sessionJson = "";
    handle.planSession = "";
    handle.planRevision = -1;
  }
  handle.media.accept(props.nativeMedia ?? "");
  if (props.serverError !== handle.serverError) {
    handle.serverError = props.serverError ?? "";
    if (handle.serverError)
      handle.engine.rejectCommand(handle.serverError);
  }
  const input = props.plan || props.session || "";
  if (input && input !== handle.sessionJson) {
    let session;
    if (props.plan) {
      const plan = JSON.parse(input);
      const stale = plan.sessionId === handle.planSession && (plan.revision <= handle.planRevision || plan.sourceGeneration < handle.engine.controller.source || plan.seekGeneration < handle.engine.controller.seek);
      if (stale) {
        applyCommand(handle, props);
        return;
      }
      session = sessionFromPlan(plan);
      handle.planRevision = plan.revision;
      handle.planSession = plan.sessionId;
    } else
      session = JSON.parse(input);
    if (!session.id || !Array.isArray(session.sources))
      throw new Error("Invalid playback session");
    if (handle.engine.snapshot().sessionId !== session.id)
      playbackMark("plan:received");
    handle.sessionJson = input;
    const current = handle.engine.snapshot();
    if (props.plan && current.sessionId === session.id && current.sourceId === session.selectedSourceId && current.sourceGeneration === session.sourceGeneration && current.seekGeneration === session.seekGeneration)
      handle.engine.updateSession(session);
    else
      handle.engine.load(session);
  }
  applyCommand(handle, props);
}
function applyCommand(handle, props) {
  if (props.playerCommand) {
    let command = JSON.parse(props.playerCommand);
    const value = command.value;
    if (typeof value === "string") {
      const decoded = decodeURIComponent(value);
      const base = { id: command.id, type: command.type };
      switch (command.type) {
        case "lowDelay":
          command = { ...base, type: "lowDelay", enabled: decoded === "true" };
          break;
        case "seekBy":
          command = { ...base, type: "seekBy", seconds: Number(decoded) };
          break;
        case "seek":
          command = { ...base, type: "seek", seconds: Number(decoded) };
          break;
        case "volume":
          command = { ...base, type: "volume", value: Number(decoded) };
          break;
        case "speed":
          command = { ...base, type: "speed", value: Number(decoded) };
          break;
        case "subtitleStyle":
          command = { ...base, type: "subtitleStyle", value: decoded };
          break;
        case "mute":
          command = { ...base, type: "mute", muted: decoded === "" ? undefined : decoded === "true" };
          break;
        case "quality":
          command = { ...base, type: "quality", renditionId: decoded || null };
          break;
        case "audio":
          command = { ...base, type: "audio", trackId: decoded };
          break;
        case "subtitle":
          command = { ...base, type: "subtitle", trackId: decoded || null };
          break;
        case "switchPath":
          command = { ...base, type: "switchPath", pathId: decoded };
          break;
      }
    }
    if (!Number.isSafeInteger(command.id))
      throw new Error("Command requires integer id");
    if (command.id > handle.lastCommand) {
      handle.lastCommand = command.id;
      handle.engine.command(command);
    }
  }
}
function disposeBrowserPlayerView(handle) {
  handle.engine.dispose();
  handle.media.dispose();
  handle.video.remove();
}

// client/player/media-capabilities.ts
var cached;
async function mediaCapabilities(signal) {
  const identity = capabilityIdentity();
  if (!cached || cached.identity !== identity) {
    const current = {
      identity,
      pending: Promise.resolve(null)
    };
    playbackMark("probe:start");
    current.pending = probe(AbortSignal.timeout(12000)).then((value) => {
      playbackMark("probe:ready");
      return value;
    }).catch((error) => {
      if (cached === current)
        cached = undefined;
      throw error;
    });
    cached = current;
    current.pending.catch(() => {});
  } else
    playbackMark("probe:cached");
  return structuredClone(await abortable(cached.pending, signal));
}
async function probe(signal) {
  try {
    localStorage.removeItem("vela.player.beta");
  } catch {}
  const video = document.createElement("video");
  const supports = (mime) => video.canPlayType(mime) !== "";
  const MS = globalThis.ManagedMediaSource ?? globalThis.MediaSource;
  const videoFormats = [
    ["h264", 'video/mp4; codecs="avc1.42E01E"'],
    ["hevc", 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
    ["vp9", 'video/webm; codecs="vp9"'],
    ["av1", 'video/mp4; codecs="av01.0.05M.08"']
  ];
  const audioFormats = [
    ["aac", 'audio/mp4; codecs="mp4a.40.2"'],
    ["opus", 'audio/webm; codecs="opus"'],
    ["ac3", 'audio/mp4; codecs="ac-3"'],
    ["eac3", 'audio/mp4; codecs="ec-3"']
  ];
  const [originalPlayback, availableSubtitles] = await Promise.all([
    originalPlaybackCapabilities(signal).catch(() => null),
    subtitleCapabilities(signal, true).catch(() => [])
  ]);
  const subtitles = originalPlayback ? availableSubtitles : availableSubtitles.filter((format) => ["webvtt", "ether-vtt-window"].includes(format));
  return {
    ...originalPlayback ? { originalPlayback } : {},
    containers: [supports("video/mp4") ? "mp4" : "", supports("video/webm") ? "webm" : ""].filter(Boolean),
    videoCodecs: videoFormats.filter(([name, mime]) => name === "h264" && supports(mime)).map(([name]) => name),
    audioCodecs: audioFormats.filter(([, mime]) => supports(mime)).map(([name]) => name),
    subtitleFormats: [...new Set([...typeof VTTCue === "function" ? ["webvtt"] : [], ...subtitles])],
    hls: supports("application/vnd.apple.mpegurl"),
    mse: !!MS && videoFormats.some(([, mime]) => MS.isTypeSupported(mime))
  };
}

// client/player/install.ts
function createInstall(element, json, event) {
  let runtime = window.velaPwa;
  const button = document.createElement("button");
  button.type = "button";
  button.style.cssText = "font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:20px;padding:8px 14px;cursor:pointer";
  element.replaceChildren(button);
  let disposed = false, action = "install", label = "";
  const update = () => {
    if (disposed)
      return;
    button.hidden = action === "update" ? !runtime?.state.updateAvailable : !runtime?.state.installable;
    button.style.display = button.hidden ? "none" : "inline-block";
    button.textContent = label || (action === "update" ? "Update ready, reload" : "Install Vela");
    button.setAttribute("aria-label", button.textContent);
    if (runtime)
      event(8, JSON.stringify(runtime.state));
  };
  const setProps = (json) => {
    const props = JSON.parse(json);
    action = props.pwaAction === "update" ? "update" : "install";
    label = props.buttonLabel ?? "";
    update();
  };
  let unsubscribe = runtime?.subscribe(update);
  const appeared = () => {
    const next = window.velaPwa;
    if (next === runtime || disposed)
      return;
    unsubscribe?.();
    runtime = next;
    unsubscribe = runtime?.subscribe(update);
    update();
  };
  window.addEventListener("vela:pwa-state", appeared);
  const clicked = () => {
    if (!runtime)
      return;
    if (action === "update")
      runtime.applyUpdate();
    else
      runtime.install().then(() => update(), () => update());
  };
  button.addEventListener("click", clicked);
  setProps(json);
  queueMicrotask(update);
  return { install: true, button, update: setProps, dispose() {
    disposed = true;
    window.removeEventListener("vela:pwa-state", appeared);
    unsubscribe?.();
    button.removeEventListener("click", clicked);
    button.remove();
  } };
}

// client/player/preview.ts
function apply(handle) {
  const video = handle.video;
  if (handle.expiryTimer)
    clearTimeout(handle.expiryTimer);
  const remaining = Number(handle.props.expiresAt) - Date.now();
  const connection = navigator.connection;
  const allowed = handle.props.active === "true" && handle.props.still !== "true" && !connection?.saveData && handle.visible && document.visibilityState === "visible" && Number.isFinite(remaining) && remaining > 0;
  if (!allowed || !handle.props.url) {
    handle.generation++;
    handle.requestAbort.abort();
    handle.requestAbort = new AbortController;
    handle.sourceURL = "";
    video.pause();
    video.style.opacity = "0";
    if (video.hasAttribute("src")) {
      video.removeAttribute("src");
      video.load();
      handle.event(8, "paused");
    }
    return;
  }
  handle.expiryTimer = setTimeout(() => apply(handle), Math.min(remaining + 1, 2147483647));
  const url = new URL(handle.props.url, document.baseURI).href;
  if (handle.sourceURL === url)
    return;
  handle.requestAbort.abort();
  handle.requestAbort = new AbortController;
  handle.sourceURL = url;
  const generation = ++handle.generation;
  handle.media.nativeURL(url, handle.requestAbort.signal).then((attached) => {
    if (handle.disposed || handle.generation !== generation)
      return;
    video.src = attached;
    return video.play();
  }).catch(() => {
    if (!handle.disposed && handle.generation === generation) {
      video.style.opacity = "0";
      handle.sourceURL = "";
      handle.event(8, "refused");
    }
  });
}
function createPreview(element, json, event) {
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.controls = false;
  video.preload = "none";
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  video.style.cssText = "width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none";
  const handle = {
    media: new MediaAccess((request) => event(8, JSON.stringify(request))),
    requestAbort: new AbortController,
    sourceURL: "",
    preview: true,
    video,
    props: {},
    event,
    visible: false,
    disposed: false,
    generation: 0,
    visibilityChanged: () => {},
    observer: undefined
  };
  video.addEventListener("canplay", () => {
    if (!handle.disposed && video.hasAttribute("src"))
      event(8, "ready");
  });
  video.addEventListener("playing", () => {
    if (handle.disposed || handle.props.active !== "true" || !handle.visible || !video.hasAttribute("src"))
      return;
    video.style.opacity = "1";
    event(8, "playing");
  });
  video.addEventListener("error", () => {
    if (!handle.disposed && video.hasAttribute("src")) {
      video.style.opacity = "0";
      event(8, "refused");
    }
  });
  handle.visibilityChanged = () => apply(handle);
  document.addEventListener("visibilitychange", handle.visibilityChanged);
  element.replaceChildren(video);
  handle.observer = new IntersectionObserver((entries) => {
    handle.visible = entries.some((e) => e.isIntersecting);
    apply(handle);
  });
  handle.observer.observe(element);
  try {
    setPreview(handle, json);
  } catch (error) {
    destroyPreview(handle);
    throw error;
  }
  return handle;
}
function setPreview(handle, json) {
  const props = JSON.parse(json);
  try {
    if (handle.media.update(props.mediaAuth ?? "")) {
      handle.generation++;
      handle.sourceURL = "";
      handle.requestAbort.abort();
      handle.video.pause();
      handle.video.removeAttribute("src");
      handle.video.load();
    }
  } catch (error) {
    handle.generation++;
    handle.requestAbort.abort();
    handle.video.pause();
    handle.video.removeAttribute("src");
    handle.video.load();
    throw error;
  }
  handle.media.accept(props.nativeMedia ?? "");
  if (props.url && !["http:", "https:"].includes(new URL(props.url, document.baseURI).protocol))
    throw new Error("Unsupported preview URL protocol");
  handle.props = props;
  handle.video.style.transition = props.still === "true" ? "none" : "opacity 360ms ease";
  apply(handle);
}
function destroyPreview(handle) {
  if (handle.expiryTimer)
    clearTimeout(handle.expiryTimer);
  document.removeEventListener("visibilitychange", handle.visibilityChanged);
  handle.disposed = true;
  handle.generation++;
  handle.observer.disconnect();
  handle.video.pause();
  handle.video.removeAttribute("src");
  handle.video.load();
  handle.video.remove();
  handle.requestAbort.abort();
  handle.media.dispose();
  handle.sourceURL = "";
  handle.props = {};
}

// client/player/theme.ts
var ENGINES = {
  cinematic: {
    roles: {
      page: "surface.page",
      raised: "surface.raised",
      ink: "ink.primary",
      inkSecondary: "ink.secondary",
      inkQuiet: "ink.quiet",
      inkInverse: "ink.inverse",
      accent: "brand.warm",
      ember: "cinematic.ember",
      tide: "cinematic.tide",
      dusk: "cinematic.dusk",
      live: "cinematic.guide-now"
    },
    prefixes: ["--x-cinematic-", "--x-surface-", "--x-ink-", "--x-brand-", "--x-media-"]
  }
};
var SELECTOR = '[data-x-modes*="pack=installed"][data-x-modes*="pack=installed"]';
var HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
var NEAR = 48;
var property = (token) => `--x-${token.replace(/[^A-Za-z0-9_-]/g, "-")}`;
var rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
var toHex = (c, alpha = "") => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}${alpha}`;
function houseValues(own) {
  const out = new Map;
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.ownerNode === own)
      continue;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes("pack=installed"))
        continue;
      for (const name of Array.from(rule.style))
        if (name.startsWith("--x-"))
          out.set(name, rule.style.getPropertyValue(name).trim());
    }
  }
  return out;
}
function declarations(pack, house, fontName) {
  const engine = ENGINES[pack.engine];
  if (!engine)
    return [];
  const roles = [];
  for (const [role, token] of Object.entries(engine.roles)) {
    const from = HEX.exec(house.get(property(token)) ?? ""), to = HEX.exec(pack.palette[role] ?? "");
    if (from && to)
      roles.push({ from: rgb(from[1]), to: rgb(to[1]) });
  }
  const out = [];
  for (const [name, value] of house) {
    if (!engine.prefixes.some((p) => name.startsWith(p)))
      continue;
    const m = HEX.exec(value);
    if (!m)
      continue;
    const c = rgb(m[1]);
    let best, distance = Infinity;
    for (const r of roles) {
      const d = Math.hypot(c[0] - r.from[0], c[1] - r.from[1], c[2] - r.from[2]);
      if (d < distance) {
        distance = d;
        best = r;
      }
    }
    if (best && distance <= NEAR)
      out.push(`${name}:${toHex(c.map((v, i) => best.to[i] + v - best.from[i]), m[2] ?? "")}`);
  }
  for (const [token, colour] of Object.entries(pack.tokens)) {
    const name = property(token);
    if (HEX.test(colour) && house.has(name) && engine.prefixes.some((p) => name.startsWith(p)))
      out.push(`${name}:${colour}`);
  }
  const display = house.get("--x-cinematic-display");
  if (fontName && display)
    out.push(`--x-cinematic-display:"${fontName}", ${display}`);
  const px = (token, v, max) => {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max && house.has(property(token)))
      out.push(`${property(token)}:${Math.round(v)}px`);
  };
  px("cinematic.radius-card", pack.radius.card, 48);
  px("cinematic.radius-panel", pack.radius.panel, 48);
  px("cinematic.radius-pill", pack.radius.pill, 999);
  return out;
}
function fontFaces(pack, name) {
  const font = pack.fonts.display;
  if (!font || typeof FontFace !== "function")
    return [];
  return font.files.flatMap((f) => {
    let url;
    try {
      url = new URL(f.url, location.href);
    } catch {
      return [];
    }
    if (url.origin !== pack.origin || !url.pathname.startsWith("/vela/v0/appearance/") || !/\.(woff2|woff|ttf|otf)$/.test(url.pathname))
      return [];
    const descriptors = { weight: String(f.weight), style: f.style === "italic" ? "italic" : "normal", display: "swap", sizeAdjust: `${Math.min(150, Math.max(50, font.sizeAdjust ?? 100))}%` };
    const face = new FontFace(name, `url("${url.href.replace(/["\\]/g, "")}")`, descriptors);
    document.fonts.add(face);
    face.load().catch(() => document.fonts.delete(face));
    return [face];
  });
}
function documentFonts(handle, json) {
  if (json === handle.docFontsJson)
    return;
  handle.docFontsJson = json;
  for (const face of handle.docFonts)
    document.fonts.delete(face);
  handle.docFonts = [];
  if (!json || typeof FontFace !== "function")
    return;
  for (const f of JSON.parse(json)) {
    let url;
    try {
      url = new URL(f.url, location.href);
    } catch {
      continue;
    }
    if (!/^[A-Za-z0-9 ]{1,48}$/.test(f.family) || !(url.pathname.startsWith("/vela/v0/appearance/") || url.pathname.startsWith("/vela/skins/")) || !/\.(woff2|woff|ttf|otf)$/.test(url.pathname))
      continue;
    const descriptors = { weight: String(f.weight), style: f.style === "italic" ? "italic" : "normal", display: "swap", sizeAdjust: `${Math.min(150, Math.max(50, f.sizeAdjust || 100))}%` };
    const face = new FontFace(f.family, `url("${url.href.replace(/["\\]/g, "")}")`, descriptors);
    document.fonts.add(face);
    face.load().catch(() => document.fonts.delete(face));
    handle.docFonts.push(face);
  }
}
function apply2(handle, json) {
  const props = JSON.parse(json);
  if (props.fonts !== undefined) {
    documentFonts(handle, props.fonts);
    return;
  }
  if (props.css !== undefined) {
    handle.sheet.textContent = !/[<\\]|@import/i.test(props.css) ? props.css : "";
    return;
  }
  if (props.keyframes !== undefined) {
    handle.sheet.textContent = /^[@a-zA-Z0-9{}:;.%\s,()-]*$/.test(props.keyframes) ? props.keyframes : "";
    return;
  }
  const packJson = props.pack ?? "";
  if (packJson === handle.json)
    return;
  handle.json = packJson;
  for (const face of handle.fonts)
    document.fonts.delete(face);
  handle.fonts = [];
  if (!packJson) {
    handle.sheet.textContent = "";
    return;
  }
  const pack = JSON.parse(packJson);
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(pack.id)) {
    handle.sheet.textContent = "";
    return;
  }
  const fontName = pack.fonts?.display ? `vela-pack-${pack.id}-display` : "";
  handle.fonts = fontName ? fontFaces(pack, fontName) : [];
  const lines = declarations({ ...pack, tokens: pack.tokens ?? {}, radius: pack.radius ?? {}, fonts: pack.fonts ?? {} }, houseValues(handle.sheet), handle.fonts.length ? fontName : "");
  handle.sheet.textContent = lines.length ? `${SELECTOR}{${lines.join(";")}}` : "";
}
var transitionInput;
function letInputThroughTransitions() {
  if (transitionInput)
    return;
  transitionInput = document.createElement("style");
  transitionInput.setAttribute("data-vela-transitions", "");
  transitionInput.textContent = "::view-transition { pointer-events: none; }";
  document.head.append(transitionInput);
}
function createTheme(json) {
  letInputThroughTransitions();
  const sheet = document.createElement("style");
  sheet.setAttribute("data-vela-pack", "");
  document.head.append(sheet);
  const handle = { theme: true, sheet, fonts: [], json: "", docFonts: [], docFontsJson: "" };
  apply2(handle, json);
  return handle;
}
var setTheme = apply2;
function destroyTheme(handle) {
  for (const face of [...handle.fonts, ...handle.docFonts])
    document.fonts.delete(face);
  handle.sheet.remove();
}

// client/player/engine-handoff.ts
var CHOSEN = "vela.engine";
var DEFAULT = "vela.engine.default";
var HANDOFF = "vela.handoff";
var ENGINE = /^[a-z][a-z0-9-]{0,31}$/;
var FRESH_MS = 15000;
var installed = () => {
  const list = window.velaEngines;
  return Array.isArray(list) ? list.filter((e) => typeof e === "string" && ENGINE.test(e)) : [];
};
function store(key, value) {
  try {
    if (value)
      localStorage.setItem(key, value);
    else
      localStorage.removeItem(key);
  } catch {}
}
function readHandoff() {
  try {
    const value = JSON.parse(sessionStorage.getItem(HANDOFF) ?? "null");
    return value && Date.now() - value.at < FRESH_MS ? value : undefined;
  } catch {
    return;
  }
}
function scrollPositions() {
  const out = {};
  for (const el of Array.from(document.querySelectorAll("[id]")))
    if (el.scrollTop > 0 && el.id.length <= 80)
      out[el.id] = Math.round(el.scrollTop);
  return out;
}
function veil(still, from, to) {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:${getComputedStyle(document.body).backgroundColor || "#090b0e"};opacity:${from}`;
  document.body.append(el);
  if (!still)
    el.animate([{ opacity: from }, { opacity: to }], { duration: 260, easing: "ease-out", fill: "forwards" });
  else
    el.style.opacity = String(to);
  return el;
}
var HOPS = "vela.handoff.hops";
var HOP_WINDOW_MS = 60000;
var MAX_HOPS = 2;
function recentHops() {
  try {
    const value = JSON.parse(sessionStorage.getItem(HOPS) ?? "[]");
    return Array.isArray(value) ? value.filter((t) => typeof t === "number" && Date.now() - t < HOP_WINDOW_MS) : [];
  } catch {
    return [];
  }
}
function leave(handle, from, to, still) {
  const earlier = readHandoff();
  if (earlier && earlier.from === to && earlier.to === from)
    return;
  const hops = recentHops();
  if (hops.length >= MAX_HOPS)
    return;
  try {
    sessionStorage.setItem(HOPS, JSON.stringify([...hops, Date.now()]));
  } catch {}
  handle.leaving = true;
  const record = { from, to, at: Date.now(), url: location.href, scroll: scrollPositions(), window: Math.round(scrollY) };
  try {
    sessionStorage.setItem(HANDOFF, JSON.stringify(record));
  } catch {}
  handle.overlay = veil(still, 0, 1);
  setTimeout(() => location.replace(location.href), still ? 0 : 280);
}
function arrive(handle, build, still) {
  const record = readHandoff();
  if (!record || record.to !== build || record.url !== location.href)
    return;
  handle.overlay = veil(true, 1, 1);
  const pending = new Map(Object.entries(record.scroll));
  const started = performance.now();
  const step = () => {
    if (handle.disposed)
      return;
    for (const [id, top] of pending) {
      const el = document.getElementById(id);
      if (el && el.scrollHeight - el.clientHeight >= top) {
        el.scrollTop = top;
        pending.delete(id);
      }
    }
    if (record.window && document.documentElement.scrollHeight - innerHeight >= record.window) {
      scrollTo(0, record.window);
      record.window = 0;
    }
    if ((pending.size || record.window) && performance.now() - started < 2000) {
      handle.restoring = requestAnimationFrame(step);
      return;
    }
    const overlay = handle.overlay;
    handle.overlay = undefined;
    if (!overlay)
      return;
    if (still)
      overlay.remove();
    else
      overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-out", fill: "forwards" }).finished.then(() => overlay.remove(), () => overlay.remove());
  };
  handle.restoring = requestAnimationFrame(step);
}
function apply3(handle, json, first) {
  if (handle.leaving || handle.disposed)
    return;
  const p = JSON.parse(json);
  const build = ENGINE.test(p.build ?? "") ? p.build : "";
  const still = p.still === true || p.still === "true";
  if (first && build)
    arrive(handle, build, still);
  if (p.settled !== true && p.settled !== "true")
    return;
  store(CHOSEN, ENGINE.test(p.chosen ?? "") ? p.chosen : "");
  if (ENGINE.test(p.fallback ?? ""))
    store(DEFAULT, p.fallback);
  const wanted = p.wanted ?? "";
  if (build && ENGINE.test(wanted) && wanted !== build && installed().includes(wanted))
    leave(handle, build, wanted, still);
}
function createEngine(json) {
  const handle = { engine: true, leaving: false, disposed: false };
  apply3(handle, json, true);
  return handle;
}
var setEngine = (handle, json) => apply3(handle, json, false);
function destroyEngine(handle) {
  handle.disposed = true;
  if (handle.restoring)
    cancelAnimationFrame(handle.restoring);
  if (!handle.leaving)
    handle.overlay?.remove();
}

// client/player/web-module.ts
var abi = 1;
var roster = {
  "vela-player": { snapshot: false },
  "vela-context": { snapshot: false },
  "vela-preview": { snapshot: false },
  "vela-install": { snapshot: false },
  "vela-theme": { snapshot: false },
  "vela-engine": { snapshot: false }
};
function create(tag, element, json, event) {
  if (tag === "vela-engine")
    return createEngine(json);
  if (tag === "vela-theme")
    return createTheme(json);
  if (tag === "vela-install")
    return createInstall(element, json, event);
  if (tag === "vela-preview")
    return createPreview(element, json, event);
  if (tag === "vela-context") {
    const handle = {
      context: true,
      disposed: false,
      lastNavigation: "",
      probe: "",
      revision: 0,
      abort: new AbortController,
      event
    };
    const props = JSON.parse(json);
    handle.probe = props.probe ?? "";
    if (handle.probe === "media") {
      handle.releaseTiming = mountPlaybackTiming();
      handle.releaseWarmup = mountCoreWarmup(handle.abort.signal);
    }
    navigateSecurely(handle, props);
    queueMicrotask(() => {
      publishContext(handle);
    });
    return handle;
  }
  if (tag !== "vela-player")
    throw new Error(`Unknown player view: ${tag}`);
  return createBrowserPlayerView(element, json, event);
}
function setProps(handle, json) {
  if ("leaving" in handle) {
    setEngine(handle, json);
    return;
  }
  if ("theme" in handle) {
    setTheme(handle, json);
    return;
  }
  if ("install" in handle) {
    handle.update(json);
    return;
  }
  if ("preview" in handle) {
    setPreview(handle, json);
    return;
  }
  if ("context" in handle) {
    navigateSecurely(handle, JSON.parse(json));
    return;
  }
  updateBrowserPlayerView(handle, json);
}
function destroy(handle) {
  if ("leaving" in handle) {
    destroyEngine(handle);
    return;
  }
  if ("theme" in handle) {
    destroyTheme(handle);
    return;
  }
  if ("install" in handle) {
    handle.dispose();
    return;
  }
  if ("preview" in handle) {
    destroyPreview(handle);
    return;
  }
  if ("context" in handle) {
    handle.disposed = true;
    handle.abort.abort();
    handle.releaseTiming?.();
    handle.releaseWarmup?.();
    return;
  }
  disposeBrowserPlayerView(handle);
}
function navigateSecurely(handle, props) {
  const target = props.secureNavigate;
  if (!target || handle.disposed || target === handle.lastNavigation)
    return;
  try {
    if (target.length > 8192)
      throw new Error("Invalid secure handoff");
    const url = new URL(target);
    const allowed = JSON.parse(props.secureOrigins || "[]");
    if (url.protocol !== "https:" || url.username || url.password || !["/vela", "/vela/"].includes(url.pathname) || !Array.isArray(allowed) || !allowed.some((origin) => typeof origin === "string" && origin === url.origin))
      throw new Error("Invalid secure handoff");
    handle.lastNavigation = target;
    queueMicrotask(() => {
      if (!handle.disposed)
        location.replace(url.href);
    });
  } catch {
    handle.event(8, JSON.stringify({ secureNavigation: "rejected" }));
  }
}
async function publishContext(handle) {
  const revision = ++handle.revision;
  try {
    const payload = handle.probe === "media" ? JSON.stringify(await mediaCapabilities(handle.abort.signal)) : handle.probe === "network" ? JSON.stringify({
      saveData: navigator.connection?.saveData === true
    }) : location.origin;
    if (!handle.disposed && revision === handle.revision)
      handle.event(8, payload);
  } catch {}
}
export {
  abi,
  create,
  destroy,
  roster,
  setProps
};

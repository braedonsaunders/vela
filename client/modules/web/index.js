// client/player/media-capabilities.ts
function mediaCapabilities() {
  const video = document.createElement("video");
  const supports = (mime) => video.canPlayType(mime) !== "";
  const MS = globalThis.ManagedMediaSource ?? globalThis.MediaSource;
  const videoFormats = [
    ["h264", 'video/mp4; codecs="avc1.42E01E"'],
    ["hevc", 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
    ["vp9", 'video/webm; codecs="vp9"'],
    ["av1", 'video/mp4; codecs="av01.0.05M.08"']
  ];
  const audioFormats = [["aac", 'audio/mp4; codecs="mp4a.40.2"'], ["opus", 'audio/webm; codecs="opus"'], ["ac3", 'audio/mp4; codecs="ac-3"'], ["eac3", 'audio/mp4; codecs="ec-3"']];
  return {
    containers: [supports("video/mp4") ? "mp4" : "", supports("video/webm") ? "webm" : ""].filter(Boolean),
    videoCodecs: videoFormats.filter(([, mime]) => supports(mime)).map(([name]) => name),
    audioCodecs: audioFormats.filter(([, mime]) => supports(mime)).map(([name]) => name),
    subtitleFormats: typeof VTTCue === "function" ? ["webvtt"] : [],
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
  if (video.src === url)
    return;
  const generation = ++handle.generation;
  video.src = url;
  video.play().catch(() => {
    if (!handle.disposed && handle.generation === generation) {
      video.style.opacity = "0";
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
  const handle = { preview: true, video, props: {}, event, visible: false, disposed: false, generation: 0, visibilityChanged: () => {}, observer: undefined };
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
  setPreview(handle, json);
  return handle;
}
function setPreview(handle, json) {
  const props = JSON.parse(json);
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

// client/player/abr.ts
class BandwidthEstimator {
  fast = 0;
  slow = 0;
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
  }
}

class AdaptiveBitrate {
  upSince = 0;
  manual = null;
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
    if (current && next.bandwidth > current.bandwidth) {
      if (dropRatio > 0.01) {
        this.upSince = 0;
        return current;
      }
      if (!this.upSince)
        this.upSince = now;
      if (buffer < 12 || now - this.upSince < 12000)
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

// client/player/pipeline.ts
function mediaSourceClass() {
  return globalThis.ManagedMediaSource ?? globalThis.MediaSource;
}

class PlaybackFault extends Error {
  kind;
  retryable;
  constructor(message, kind, retryable = false) {
    super(message);
    this.kind = kind;
    this.retryable = retryable;
  }
}
function bufferAhead(video) {
  for (let i = 0;i < video.buffered.length; i++)
    if (video.currentTime >= video.buffered.start(i) - 0.05 && video.currentTime < video.buffered.end(i))
      return video.buffered.end(i) - video.currentTime;
  return 0;
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

class SegmentPipeline {
  video;
  onRendition;
  bandwidth = new BandwidthEstimator;
  abr = new AdaptiveBitrate;
  current;
  lowDelay = false;
  liveWindowStart = null;
  maxLiveDrift = 45;
  publishedEdge = null;
  publishedStart = null;
  retrying = false;
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
  driftPenalty = 0;
  constructor(video, onRendition) {
    this.video = video;
    this.onRendition = onRendition;
  }
  dispose() {
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
  async fetchBytes(url, signal, progress) {
    const started = performance.now();
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), credentials: "same-origin" });
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
          this.driftPenalty = Math.min(12, this.driftPenalty + 3);
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
  async append(bytes, signal) {
    const buffer = this.buffer;
    try {
      await mutation(buffer, signal, () => buffer.appendBuffer(bytes));
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "QuotaExceededError")
        throw error;
      const end = this.video.currentTime - 10;
      if (end <= 0)
        throw new PlaybackFault("Insufficient media buffer quota", "source");
      await mutation(buffer, signal, () => buffer.remove(0, end));
      await mutation(buffer, signal, () => buffer.appendBuffer(bytes));
    }
  }
  async run(ladder, position, live, signal) {
    const MS = mediaSourceClass();
    if (!MS)
      throw new PlaybackFault("MediaSource unavailable", "source");
    const playable = ladder.filter((r) => MS.isTypeSupported(r.mime));
    if (!playable.length)
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
    let rendition = this.abr.choose(playable, undefined, 0, this.bandwidth.bps, 0, performance.now());
    this.current = rendition;
    this.onRendition(rendition);
    this.buffer = media.addSourceBuffer(rendition.mime);
    let list = await this.playlist(rendition, signal);
    if (live) {
      list.segments.forEach((s) => {
        s.start += this.liveWindowStart ?? 0;
      });
      this.published(list);
    }
    if (!live && list.ended)
      media.duration = list.segments.reduce((sum, s) => sum + s.duration, 0);
    let next = live ? (position > 0 ? list.segments.find((s) => s.start + s.duration > position) : undefined) ?? list.segments[Math.max(0, list.segments.length - (this.lowDelay ? 2 : 4))] : list.segments.find((s) => s.start + s.duration > position) ?? (list.ended && position === media.duration ? list.segments.at(-1) : undefined);
    if (!next)
      throw new PlaybackFault("Position outside source timeline", "source");
    let sequence = next.sequence, init = "", first = true;
    while (!signal.aborted) {
      const ahead = bufferAhead(this.video);
      const target = live ? this.lowDelay ? 6 : 18 + this.driftPenalty : 30;
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
      const choice = this.abr.choose(playable.filter((r) => r.mime === rendition.mime), rendition, ahead, this.bandwidth.bps, this.dropRatio, performance.now());
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
          return;
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
        await this.append(await this.bytes(next.init, signal), signal);
        init = next.init;
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
          const lower = [...playable].filter((r) => r.mime === rendition.mime && r.bandwidth < rendition.bandwidth).sort((a, b) => a.bandwidth - b.bandwidth)[0];
          if (lower && this.abr.abandon(rendition, lower, next.duration, received, elapsed, bufferAhead(this.video))) {
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
        rendition = abandon;
        list = await this.playlist(rendition, signal);
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
        if (drift > Math.max(this.maxLiveDrift, target + 6))
          this.video.currentTime = this.video.buffered.end(this.video.buffered.length - 1) - target;
        this.video.playbackRate = this.lowDelay && drift > 8 ? 1.03 : 1;
      }
    }
  }
}

// client/src/protocol/id.ts
function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  return Array.from(bytes, (b, i) => `${i === 4 || i === 6 || i === 8 || i === 10 ? "-" : ""}${b.toString(16).padStart(2, "0")}`).join("");
}

// client/player/engine.ts
class PlaybackEngine {
  video;
  emit;
  fullscreenContainer;
  controller = new SessionController;
  session;
  source;
  pipeline;
  status = "idle";
  backend = null;
  failure = null;
  audio = null;
  subtitle = null;
  timer;
  listeners = [];
  attempted = new Set;
  recovering = false;
  disposed = false;
  resumePosition = 0;
  pendingSwitch;
  lowDelayOverride;
  terminalMedia;
  localTransportIntent;
  wantsPlay = false;
  lowDelay = false;
  manualQuality = null;
  track;
  lastObservation = 0;
  constructor(video, emit, fullscreenContainer = video) {
    this.video = video;
    this.emit = emit;
    this.fullscreenContainer = fullscreenContainer;
    video.crossOrigin = "anonymous";
    video.playsInline = true;
    video.controls = false;
    video.preload = "auto";
    for (const [name, handler] of Object.entries({
      playing: () => {
        this.status = "playing";
        this.failure = null;
      },
      pause: () => {
        if (!["loading", "recovering", "failed", "ended"].includes(this.status))
          this.status = "paused";
      },
      waiting: () => {
        if (!["recovering", "ended", "failed"].includes(this.status))
          this.status = "buffering";
      },
      ended: () => {
        this.endPlayback();
      },
      error: () => {
        const e = video.error;
        if (!e || !this.session || this.disposed || ["failed", "ended"].includes(this.status))
          return;
        const kind = e.code === 2 ? "network" : e.code === 3 ? "decoder" : "source";
        this.recover(new PlaybackFault(e.message || `Media error ${e.code}`, kind), this.controller.token());
      }
    })) {
      const listener = () => {
        handler();
        this.publish();
      };
      video.addEventListener(name, listener);
      this.listeners.push(() => video.removeEventListener(name, listener));
    }
    this.timer = setInterval(() => this.publish(), 1000);
  }
  get observationAllowed() {
    return this.session?.serverState !== "ended";
  }
  snapshot() {
    const ranges = this.video.buffered, quality = this.video.getVideoPlaybackQuality?.();
    return {
      sessionId: this.session?.id ?? null,
      sourceGeneration: this.controller.source,
      seekGeneration: this.controller.seek,
      state: this.status,
      sourceId: this.source?.id ?? null,
      strategy: this.source?.strategy ?? null,
      backend: this.backend,
      renditionId: this.pipeline?.current?.id ?? null,
      capabilities: { pip: this.pipAvailable(), fullscreen: this.fullscreenAvailable(), audioSwitch: (this.session?.audioTracks.length ?? 0) > 1 && !!this.session?.audioTracks.every((t) => !!this.nativeAudio(t.id)) },
      lockedQuality: this.manualQuality,
      live: this.liveSnapshot(),
      position: this.terminalMedia?.position ?? (Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0),
      duration: this.terminalMedia?.duration ?? (Number.isFinite(this.video.duration) ? this.video.duration : null),
      playable: Array.from({ length: Math.min(ranges.length, 32) }, (_, i) => ({ start: ranges.start(i), end: ranges.end(i) })),
      throughputBps: this.pipeline?.bandwidth.bps ?? null,
      droppedFrames: quality?.droppedVideoFrames ?? null,
      totalFrames: quality?.totalVideoFrames ?? null,
      audioTrackId: this.audio,
      subtitleTrackId: this.subtitle,
      failure: this.failure
    };
  }
  catchUpTarget() {
    const ranges = this.backend === "mse" ? this.video.buffered : this.video.seekable;
    if (!this.session?.live || !ranges.length)
      return null;
    const index = ranges.length - 1, start = ranges.start(index), end = ranges.end(index);
    if (end - start < 0.25)
      return null;
    const target = Math.max(start + 0.05, end - (this.lowDelay ? 6 : 18));
    return target > this.video.currentTime + 0.25 ? Math.min(target, end - 0.1) : null;
  }
  liveSnapshot() {
    if (!this.session?.live)
      return null;
    const seekable = this.video.seekable;
    let edge = this.pipeline?.publishedEdge ?? null;
    let start = this.pipeline?.publishedStart ?? null;
    let source = edge === null ? null : "playlist";
    if (edge === null && seekable.length) {
      edge = seekable.end(seekable.length - 1);
      start = seekable.start(0);
      source = "seekable";
    }
    if (edge === null && Number.isFinite(this.session.liveEdge)) {
      edge = this.session.liveEdge;
      start = this.session.liveWindowStart ?? null;
      source = "server";
    }
    return {
      edgeSeconds: edge,
      windowStartSeconds: start,
      driftSeconds: edge === null ? null : Math.max(0, edge - this.video.currentTime),
      edgeSource: source,
      reconnecting: this.status === "recovering" || !!this.pipeline?.retrying,
      delivery: this.pipeline?.delivery ?? "unknown",
      canCatchUp: this.catchUpTarget() !== null
    };
  }
  publish() {
    if (this.disposed)
      return;
    const now = performance.now();
    if (now - this.lastObservation < 250)
      return;
    this.lastObservation = now;
    this.emit({ type: "snapshot", snapshot: this.snapshot() });
  }
  supported(source) {
    if (source.edition !== this.session?.edition)
      return false;
    if (source.delivery === "file")
      return !!this.video.canPlayType(source.mime);
    return !!this.video.canPlayType("application/vnd.apple.mpegurl") || !!source.renditions?.some((r) => mediaSourceClass()?.isTypeSupported(r.mime));
  }
  useNativeHls(source) {
    const native = !!this.video.canPlayType("application/vnd.apple.mpegurl");
    const segmented = !!source.renditions?.some((r) => mediaSourceClass()?.isTypeSupported(r.mime));
    const managed = "ManagedMediaSource" in globalThis;
    return native && (!segmented || navigator.vendor === "Apple Computer, Inc." && !managed);
  }
  candidates() {
    const priority = { direct: 0, remux: 1, transcode: 2 };
    return (this.session?.sources ?? []).filter((s) => this.supported(s)).sort((a, b) => priority[a.strategy] - priority[b.strategy]);
  }
  async load(session) {
    if (!this.timer)
      this.timer = setInterval(() => this.publish(), 1000);
    const pending = this.pendingSwitch;
    const handoff = pending && pending.sessionId === session.id && pending.sourceId === session.selectedSourceId && pending.source === session.sourceGeneration && pending.seek === session.seekGeneration;
    const position = handoff ? Math.max(pending.position, this.video.currentTime) : session.position ?? 0;
    const recovery = !!handoff && pending.recovery;
    this.pendingSwitch = undefined;
    const previousServerState = session.id === this.session?.id ? this.session.serverState : undefined;
    if (session.id !== this.session?.id) {
      this.lowDelayOverride = undefined;
      this.localTransportIntent = undefined;
      this.wantsPlay = session.serverState !== "paused" && session.serverState !== "ended";
    }
    this.controller.start(session.id, session.sourceGeneration, session.seekGeneration);
    this.resetMedia();
    this.session = session;
    if (session.serverState === "ended") {
      this.source = session.sources.find((s) => s.id === session.selectedSourceId);
      this.endPlayback(session.position ?? 0);
      return;
    }
    this.applyServerState(session.serverState, previousServerState, false);
    this.source = undefined;
    this.failure = null;
    this.attempted.clear();
    this.recovering = false;
    this.lowDelay = this.lowDelayOverride ?? session.lowDelay ?? false;
    this.audio = session.audioTrackId ?? null;
    this.subtitle = session.subtitleTrackId ?? null;
    const source = this.candidates().find((s) => s.id === session.selectedSourceId) ?? this.candidates().find((s) => !this.audio || s.audioTrackId === this.audio) ?? this.candidates()[0];
    if (!source) {
      this.fail({ kind: "unsupported", message: "No browser-compatible source for this edition", recoverable: false });
      return;
    }
    await this.activate(source, position, recovery, true);
  }
  updateSession(session) {
    if (session.id !== this.session?.id)
      throw new Error("Cannot update a different session");
    const previousState = this.session?.serverState;
    this.session = session;
    this.applyServerState(session.serverState, previousState);
    if (this.status === "ended")
      return;
    this.lowDelay = this.lowDelayOverride ?? session.lowDelay ?? this.lowDelay;
    if (this.pipeline) {
      this.pipeline.lowDelay = this.lowDelay;
      this.pipeline.maxLiveDrift = session.liveMaxDrift ?? 45;
    }
    if ((session.subtitleTrackId ?? null) !== this.subtitle) {
      this.subtitle = session.subtitleTrackId ?? null;
      this.applySubtitle();
    }
    if ((session.audioTrackId ?? null) !== this.audio) {
      const previous = this.audio;
      this.audio = session.audioTrackId ?? null;
      if (!this.applyNativeAudio()) {
        this.audio = previous;
        this.emit({ type: "error", failure: { kind: "action", message: "Audio change requires a new server source generation", recoverable: true } });
      }
    }
  }
  applyServerState(state, previous, touchVideo = true) {
    if (state === "ended") {
      this.endPlayback();
      return;
    }
    if (state !== "paused" && state !== "playing")
      return;
    if (this.localTransportIntent) {
      if (state === this.localTransportIntent)
        this.localTransportIntent = undefined;
      return;
    }
    if (state === previous)
      return;
    this.wantsPlay = state === "playing";
    if (!touchVideo)
      return;
    if (state === "paused") {
      this.video.pause();
      this.status = "paused";
      this.publish();
    } else if (this.video.paused)
      this.play();
  }
  endPlayback(position) {
    if (this.status === "ended" && this.terminalMedia)
      return;
    this.terminalMedia = { position: position ?? this.video.currentTime, duration: Number.isFinite(this.video.duration) ? this.video.duration : null };
    this.status = "ended";
    this.failure = null;
    this.wantsPlay = false;
    this.localTransportIntent = undefined;
    this.controller.cancel();
    this.pipeline?.dispose();
    this.pipeline = undefined;
    this.track?.remove();
    this.track = undefined;
    if (this.timer)
      clearInterval(this.timer);
    this.timer = undefined;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.lastObservation = -Infinity;
    this.publish();
  }
  resetMedia() {
    this.terminalMedia = undefined;
    this.video.pause();
    this.pipeline?.dispose();
    this.pipeline = undefined;
    this.track?.remove();
    this.track = undefined;
    this.video.removeAttribute("src");
    this.video.load();
    this.video.playbackRate = 1;
  }
  async activate(source, position, recovery = false, initial = false) {
    this.resumePosition = position;
    const token = this.controller.changeSource(!initial);
    this.resetMedia();
    this.source = source;
    this.attempted.add(source.id);
    this.status = recovery ? "recovering" : "loading";
    this.failure = null;
    this.publish();
    try {
      if (source.delivery === "hls" && !this.useNativeHls(source)) {
        this.backend = "mse";
        const pipeline = this.pipeline = new SegmentPipeline(this.video, () => this.publish());
        pipeline.lowDelay = this.lowDelay;
        pipeline.liveWindowStart = this.session?.liveWindowStart ?? null;
        pipeline.maxLiveDrift = this.session?.liveMaxDrift ?? 45;
        pipeline.abr.manual = this.manualQuality;
        pipeline.run(source.renditions ?? [], position, !!this.session?.live, token.signal).catch((e) => {
          if (this.controller.current(token))
            this.recover(e, token);
        });
      } else {
        this.backend = source.delivery === "file" ? "file" : "native-hls";
        this.video.disableRemotePlayback = false;
        this.video.src = source.url;
      }
      await this.metadata(token);
      cancelled(token.signal);
      if (this.backend !== "mse" && position > 0)
        this.video.currentTime = position;
      this.applySubtitle();
      this.applyNativeAudio();
      this.status = this.video.paused ? "paused" : this.video.readyState >= 3 ? "playing" : "buffering";
      if (this.wantsPlay)
        await this.play();
      this.publish();
    } catch (e) {
      if (this.controller.current(token))
        await this.recover(e, token);
    }
  }
  metadata(token) {
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
      }, 15000);
      const clean = () => {
        clearTimeout(timer);
        this.video.removeEventListener("loadedmetadata", done);
        this.video.removeEventListener("error", error);
        token.signal.removeEventListener("abort", abort);
      };
      this.video.addEventListener("loadedmetadata", done, { once: true });
      this.video.addEventListener("error", error, { once: true });
      token.signal.addEventListener("abort", abort, { once: true });
      if (this.video.readyState >= 1)
        done();
      else if (token.signal.aborted)
        abort();
    });
  }
  rejectCommand(message) {
    this.pendingSwitch = undefined;
    if (message)
      this.fail({ kind: "source", message, recoverable: false });
  }
  requestSeek(seconds) {
    this.emit({ type: "session-command", sessionId: this.session.id, command: {
      kind: "seek",
      positionSeconds: seconds,
      sourceGeneration: this.controller.source,
      seekGeneration: this.controller.seek,
      idempotencyKey: randomId()
    } });
  }
  requestSwitch(source, position, recovery = false) {
    const boundary = source.boundaries?.filter((at) => at <= position).sort((a, b) => b - a)[0];
    if (boundary === undefined)
      throw new Error("No independent switch boundary offered by server");
    this.pendingSwitch = { sessionId: this.session.id, sourceId: source.id, source: this.controller.source + 1, seek: this.controller.seek, position, recovery };
    this.emit({ type: "session-command", sessionId: this.session.id, command: {
      kind: "switch",
      pathId: source.id,
      atSeconds: boundary,
      sourceGeneration: this.controller.source,
      seekGeneration: this.controller.seek,
      idempotencyKey: randomId()
    } });
  }
  fail(failure) {
    this.controller.cancel();
    this.pipeline?.dispose();
    this.video.pause();
    this.failure = failure;
    this.status = "failed";
    this.emit({ type: "error", failure });
    this.publish();
  }
  async recover(error, token) {
    if (!this.controller.current(token) || this.recovering)
      return;
    this.recovering = true;
    const kind = error instanceof PlaybackFault ? error.kind : error instanceof TypeError || error instanceof DOMException && error.name === "TimeoutError" ? "network" : "source";
    const position = this.video.currentTime || this.resumePosition;
    this.status = "recovering";
    this.failure = { kind, message: error instanceof Error ? error.message : String(error), recoverable: true };
    this.publish();
    try {
      await delay(300, token.signal);
      const source = this.candidates().find((s) => !this.attempted.has(s.id) && s.recoveryAllowed !== false && s.timeline === this.source?.timeline && s.edition === this.source?.edition && (!this.audio || s.audioTrackId === this.audio));
      if (!source) {
        this.fail({ ...this.failure, recoverable: false });
        return;
      }
      this.recovering = false;
      if (this.session?.serverControlled)
        this.requestSwitch(source, position, true);
      else
        await this.activate(source, position, true);
    } catch (e) {
      if (this.controller.current(token))
        this.fail({ kind, message: String(e), recoverable: false });
    } finally {
      this.recovering = false;
    }
  }
  async play() {
    const token = this.controller.token();
    try {
      await this.video.play();
      if (this.controller.current(token)) {
        this.status = "playing";
        this.publish();
      }
    } catch (e) {
      if (!this.controller.current(token))
        return;
      this.emit({ type: "error", failure: { kind: "action", message: e instanceof Error ? e.message : String(e), recoverable: true } });
    }
  }
  nativeAudio(id) {
    const tracks = Array.from(this.video.audioTracks ?? []);
    const byId = tracks.find((t) => t.id === id);
    if (byId)
      return byId;
    const preference = this.session?.audioTracks.find((t) => t.id === id);
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
  applyNativeAudio() {
    const selected = this.audio ? this.nativeAudio(this.audio) : undefined;
    if (!selected)
      return false;
    for (const track of Array.from(this.video.audioTracks ?? []))
      track.enabled = track === selected;
    return true;
  }
  pipAvailable() {
    if (this.video.disablePictureInPicture || this.video.readyState < 2 || this.video.videoWidth <= 0 || this.status === "ended")
      return false;
    return !!document.pictureInPictureEnabled && !!this.video.requestPictureInPicture || !!this.video.webkitSetPresentationMode && !!this.video.webkitSupportsPresentationMode?.("picture-in-picture");
  }
  fullscreenAvailable() {
    return !!document.fullscreenEnabled && !!this.fullscreenContainer.requestFullscreen || !!this.video.webkitEnterFullscreen && this.video.webkitSupportsFullscreen !== false;
  }
  applySubtitle() {
    this.track?.remove();
    this.track = undefined;
    if (!this.subtitle)
      return;
    const selected = this.session?.subtitleTracks.find((t) => t.id === this.subtitle);
    if (!selected?.url)
      throw new Error("Selected subtitle has no WebVTT URL");
    const track = this.track = document.createElement("track");
    track.kind = "subtitles";
    track.label = selected.label;
    track.srclang = selected.language ?? "und";
    track.src = selected.url;
    track.default = true;
    track.addEventListener("load", () => {
      if (this.track === track)
        track.track.mode = "showing";
    }, { once: true });
    track.addEventListener("error", () => {
      if (this.track === track)
        this.emit({ type: "error", failure: { kind: "source", message: "Subtitle could not be loaded", recoverable: true } });
    }, { once: true });
    this.video.append(track);
    track.track.mode = "showing";
  }
  async command(command) {
    if (this.disposed)
      return;
    try {
      switch (command.type) {
        case "play":
          this.localTransportIntent = "playing";
          this.wantsPlay = true;
          await this.play();
          break;
        case "pause":
          this.localTransportIntent = "paused";
          this.wantsPlay = false;
          this.video.pause();
          break;
        case "retry":
          if (this.session)
            await this.load({ ...this.session, position: this.video.currentTime || this.resumePosition });
          break;
        case "switchPath": {
          const source = this.candidates().find((s) => s.id === command.pathId);
          if (!source || source.id === this.source?.id)
            break;
          if (source.recoveryAllowed === false)
            throw new Error("Source has no compatibility proof");
          if (this.session?.serverControlled)
            this.requestSwitch(source, this.video.currentTime);
          else
            await this.activate(source, this.video.currentTime);
          break;
        }
        case "seekBy": {
          if (!Number.isFinite(command.seconds))
            throw new Error("Invalid relative seek");
          const upper = Number.isFinite(this.video.duration) ? this.video.duration : Infinity;
          await this.command({ id: command.id, type: "seek", seconds: Math.max(0, Math.min(upper, this.video.currentTime + command.seconds)) });
          break;
        }
        case "seek": {
          if (!Number.isFinite(command.seconds) || command.seconds < 0 || Number.isFinite(this.video.duration) && command.seconds > this.video.duration)
            throw new Error("Seek outside media timeline");
          if (this.session?.serverControlled) {
            this.requestSeek(command.seconds);
            break;
          }
          this.controller.changeSeek();
          if (this.backend === "mse" && this.source)
            await this.activate(this.source, command.seconds, false, true);
          else
            this.video.currentTime = command.seconds;
          break;
        }
        case "catchUp": {
          const target = this.catchUpTarget();
          if (target === null)
            throw new Error("No newer usable live buffer or seekable range");
          await this.command({ id: command.id, type: "seek", seconds: target });
          break;
        }
        case "volume":
          if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1)
            throw new Error("Volume outside 0–1");
          this.video.volume = command.value;
          break;
        case "quality":
          if (this.backend !== "mse")
            throw new Error("Quality is controlled by the browser on this playback path");
          if (command.renditionId && !this.source?.renditions?.some((r) => r.id === command.renditionId))
            throw new Error("Unknown rendition");
          this.manualQuality = command.renditionId;
          if (this.pipeline)
            this.pipeline.abr.manual = command.renditionId;
          break;
        case "audio": {
          if (!this.session?.audioTracks.some((t) => t.id === command.trackId))
            throw new Error("Unknown audio track");
          const previous = this.audio;
          this.audio = command.trackId;
          if (this.applyNativeAudio())
            break;
          const source = this.candidates().find((s) => s.audioTrackId === command.trackId && s.timeline === this.source?.timeline);
          if (!source) {
            this.audio = previous;
            throw new Error("Audio selection requires a compatible server source");
          }
          await this.activate(source, this.video.currentTime);
          break;
        }
        case "subtitle":
          if (command.trackId && !this.session?.subtitleTracks.some((t) => t.id === command.trackId && t.url))
            throw new Error("Unknown WebVTT track");
          this.subtitle = command.trackId;
          this.applySubtitle();
          break;
        case "lowDelay":
          this.lowDelayOverride = command.enabled;
          this.lowDelay = command.enabled;
          if (this.pipeline)
            this.pipeline.lowDelay = command.enabled;
          if (!command.enabled)
            this.video.playbackRate = 1;
          break;
        case "pip":
          if (!this.pipAvailable())
            throw new Error("Picture-in-picture is unavailable");
          if (document.pictureInPictureElement === this.video)
            await document.exitPictureInPicture();
          else if (document.pictureInPictureEnabled && this.video.requestPictureInPicture)
            await this.video.requestPictureInPicture();
          else
            this.video.webkitSetPresentationMode?.("picture-in-picture");
          break;
        case "fullscreen":
          if (!this.fullscreenAvailable())
            throw new Error("Fullscreen is unavailable");
          if (document.fullscreenElement === this.fullscreenContainer)
            await document.exitFullscreen();
          else if (document.fullscreenEnabled && this.fullscreenContainer.requestFullscreen)
            await this.fullscreenContainer.requestFullscreen();
          else if (this.video.webkitDisplayingFullscreen)
            this.video.webkitExitFullscreen?.();
          else if (this.video.webkitEnterFullscreen)
            this.video.webkitEnterFullscreen();
          else
            throw new Error("Fullscreen is unavailable");
          break;
      }
    } catch (e) {
      this.emit({ type: "error", failure: { kind: "action", message: e instanceof Error ? e.message : String(e), recoverable: true } });
    }
    this.publish();
  }
  dispose() {
    this.disposed = true;
    this.controller.stop();
    clearInterval(this.timer);
    for (const remove of this.listeners)
      remove();
    this.listeners = [];
    this.resetMedia();
    this.session = undefined;
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
    live: !!plan.channelId,
    liveWindowStart: plan.live?.windowStartSeconds,
    liveEdge: plan.live?.liveEdgeSeconds,
    liveMaxDrift: plan.live?.maxDriftSeconds,
    lowDelay: plan.live?.mode === "low-delay",
    sourceGeneration: plan.sourceGeneration,
    seekGeneration: plan.seekGeneration,
    audioTrackId: plan.selectedAudioTrackId,
    subtitleTrackId: plan.selectedSubtitleTrackId ?? undefined,
    audioTracks: plan.audioTracks.map((t) => ({ id: t.id, label: t.name, language: t.language })),
    subtitleTracks: plan.subtitleTracks.filter((t) => t.codec.toLowerCase() === "webvtt" || t.codec.toLowerCase() === "vtt").map((t) => ({ id: t.id, label: t.name, language: t.language, url: t.url })),
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
      renditions: p.qualities.map((q) => ({
        id: q.id,
        url: q.url,
        bandwidth: q.bitrate,
        height: q.height,
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
    ...snapshot.audioTrackId === null ? {} : { audioTrackId: snapshot.audioTrackId },
    subtitleTrackId: snapshot.subtitleTrackId,
    ...snapshot.failure ? { error: { class: snapshot.failure.kind === "network" ? "transient" : snapshot.failure.kind === "decoder" ? "decoder" : "source", message: snapshot.failure.message } } : {}
  };
}

// client/player/web-module.ts
var abi = 1;
var roster = { "vela-player": { snapshot: false }, "vela-context": { snapshot: false }, "vela-preview": { snapshot: false }, "vela-install": { snapshot: false } };
function create(tag, element, json, event) {
  if (tag === "vela-install")
    return createInstall(element, json, event);
  if (tag === "vela-preview")
    return createPreview(element, json, event);
  if (tag === "vela-context") {
    const handle = { context: true, disposed: false };
    const props = JSON.parse(json);
    queueMicrotask(() => {
      if (!handle.disposed)
        event(8, props.probe === "media" ? JSON.stringify(mediaCapabilities()) : location.origin);
    });
    return handle;
  }
  if (tag !== "vela-player")
    throw new Error(`Unknown player view: ${tag}`);
  const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  const video = document.createElement("video");
  video.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;background:#000";
  root.replaceChildren(video);
  const handle = { engine: undefined, video, sessionJson: "", lastCommand: -1, planRevision: -1, planSession: "", sequence: 0, lastReport: 0, serverError: "", endedReport: "" };
  handle.engine = new PlaybackEngine(video, (value) => {
    event(8, JSON.stringify(value));
    const now = performance.now();
    if (value.type === "snapshot" && handle.engine.observationAllowed && now - handle.lastReport >= 1000) {
      const endedKey = `${value.snapshot.sessionId}:${value.snapshot.sourceGeneration}:${value.snapshot.seekGeneration}`;
      if (value.snapshot.state === "ended" && handle.endedReport === endedKey)
        return;
      if (value.snapshot.state === "ended")
        handle.endedReport = endedKey;
      const report = observation(value.snapshot, ++handle.sequence);
      if (report) {
        handle.lastReport = now;
        event(8, JSON.stringify({ type: "observation", sessionId: value.snapshot.sessionId, observation: report }));
      }
    }
  }, element.parentElement ?? element);
  try {
    setProps(handle, json);
  } catch (error) {
    handle.engine.dispose();
    video.remove();
    throw error;
  }
  return handle;
}
function setProps(handle, json) {
  if ("install" in handle) {
    handle.update(json);
    return;
  }
  if ("preview" in handle) {
    setPreview(handle, json);
    return;
  }
  if ("context" in handle)
    return;
  const props = JSON.parse(json);
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
      const decoded = decodeURIComponent(value), base = { id: command.id, type: command.type };
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
function destroy(handle) {
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
    return;
  }
  handle.engine.dispose();
  handle.video.remove();
}
export {
  abi,
  create,
  destroy,
  roster,
  setProps
};

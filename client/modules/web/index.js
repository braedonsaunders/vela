// client/player/timing.ts
var key = Symbol.for("vela.playback.timing");
var state = Reflect.get(globalThis, key) ?? { points: [], attempt: 0, mounted: 0, source: 0, firstSource: -1 };
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
  state.points.push({ attempt: state.attempt, source: state.source, stage, at: performance.now(), ...detail ? { detail } : {} });
  if (state.points.length > 200)
    state.points.shift();
}
function playbackTimings() {
  return state.points.map((point) => ({ ...point }));
}
var playIntent = (event) => {
  const target = event.composedPath().find((node) => node instanceof HTMLElement && node.hasAttribute("data-testid"));
  const id = target?.getAttribute("data-testid") ?? "";
  if (!id.startsWith("player-") && /(^|[-_])(play|watch)([-_]|$)/.test(id))
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
var QUALIFIED_ORIGINAL_AUDIO = ["aac", "ac3", "eac3", "truehd", "dts", "flac", "opus", "vorbis", "mp3", "alac", "mp2", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le"];

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
      const response = await fetch(new URL("assets.json", base), { signal: AbortSignal.timeout(1e4), credentials: "same-origin" });
      if (!response.ok)
        throw new Error(`Original runtime assets HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.version !== 1 || assetKey !== undefined && manifest.assetKey !== assetKey || !/^[a-f0-9]{16}$/.test(manifest.assetKey) || manifest.upstreamRevision !== "a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2")
        throw new Error("Original runtime asset identity mismatch");
      if (manifest.subtitleAssets && (!/^[a-f0-9]{16}$/.test(manifest.subtitleAssets.assetKey) || manifest.subtitleAssets.directory !== "libraries/subtitles/"))
        throw new Error("Invalid subtitle asset identity");
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
  return { module, assets: {
    baseURL: new URL("libraries/", base).href,
    assetKey: manifest.assetKey,
    audioDecoderURL: new URL("libraries/audio-decoders/", base).href,
    videoDecoderURL: new URL("libraries/video-decoders/", base).href,
    subtitleBaseURL: subtitles ? new URL(subtitles.directory, base).href : undefined
  } };
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
  const [adapter, manifest] = await abortable(Promise.all([
    abortable(gpu?.requestAdapter(), adapterSignal).catch(() => null),
    runtimeManifest(signal)
  ]), signal);
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
  return { ...declaration, videoDecoders, audioDecoders: declaration.audioDecoders.filter((codec) => QUALIFIED_ORIGINAL_AUDIO.includes(codec)) };
}

// client/player/media-capabilities.ts
var cached;
async function mediaCapabilities(signal) {
  const identity = capabilityIdentity();
  if (!cached || cached.identity !== identity) {
    const current = { identity, pending: Promise.resolve(null) };
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
  const audioFormats = [["aac", 'audio/mp4; codecs="mp4a.40.2"'], ["opus", 'audio/webm; codecs="opus"'], ["ac3", 'audio/mp4; codecs="ac-3"'], ["eac3", 'audio/mp4; codecs="ec-3"']];
  const [originalPlayback, availableSubtitles] = await Promise.all([originalPlaybackCapabilities(signal).catch(() => null), subtitleCapabilities(signal, true).catch(() => [])]);
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
    const face = new FontFace(name, `url("${url.href.replace(/["\\]/g, "")}")`, { weight: String(f.weight), style: f.style === "italic" ? "italic" : "normal", display: "swap", sizeAdjust: `${Math.min(150, Math.max(50, font.sizeAdjust ?? 100))}%` });
    document.fonts.add(face);
    face.load().catch(() => document.fonts.delete(face));
    return [face];
  });
}
function apply2(handle, json) {
  const props = JSON.parse(json);
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
function createTheme(json) {
  const sheet = document.createElement("style");
  sheet.setAttribute("data-vela-pack", "");
  document.head.append(sheet);
  const handle = { theme: true, sheet, fonts: [], json: "" };
  apply2(handle, json);
  return handle;
}
var setTheme = apply2;
function destroyTheme(handle) {
  for (const face of handle.fonts)
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
function leave(handle, from, to, still) {
  const earlier = readHandoff();
  if (earlier && earlier.from === to && earlier.to === from)
    return;
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

// client/player/universal/retry.ts
function decoderRetry(reason) {
  if (!reason.startsWith("Original decode: decode-failed") && !reason.startsWith("Original first-frame deadline"))
    return null;
  return { audio: true, video: true };
}

// client/player/universal/subtitles/types.ts
var defaultSubtitlePreferences = { subtitleSize: "medium", subtitleBackground: "shadow", subtitleColor: "white", subtitlePosition: "bottom", offsetSeconds: 0 };

// client/player/universal/subtitles/preferences.ts
var choices = { subtitleSize: ["small", "medium", "large", "xl"], subtitleBackground: ["none", "shadow", "box"], subtitleColor: ["white", "yellow"], subtitlePosition: ["bottom", "raised"] };
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

// client/player/model.ts
function codecKnown(rendition) {
  return rendition.codecStatus !== "pending" && /codecs="[^"]+"/.test(rendition.mime);
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
  lowDelay = false;
  expensiveSwitches = false;
  initialRenditionId;
  timelineOriginSeconds = 0;
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
  constructor(video, onRendition, refreshPlan) {
    this.video = video;
    this.onRendition = onRendition;
    this.refreshPlan = refreshPlan;
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
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), credentials: "same-origin" });
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
    let next = live ? (position > 0 ? list.segments.find((s) => s.start + s.duration > position) : undefined) ?? list.segments[Math.max(0, list.segments.length - (this.lowDelay ? 2 : 4))] : list.segments.find((s) => s.start + s.duration > position) ?? (list.ended && position === media.duration ? list.segments.at(-1) : undefined);
    if (!next)
      throw new PlaybackFault("Position outside source timeline", "source");
    let sequence = next.sequence, init = "", first = true;
    while (!signal.aborted) {
      await this.audio?.applySelection(list, signal);
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
        if (drift > Math.max(this.maxLiveDrift, target + 6))
          this.video.currentTime = this.video.buffered.end(this.video.buffered.length - 1) - target;
        this.video.playbackRate = this.lowDelay && drift > 8 ? 1.03 : 1;
      }
    }
  }
}

// client/player/native-hls.ts
async function nativeMediaPlaylist(url, signal, depth = 0) {
  if (depth > 1)
    throw new Error("Nested HLS masters are unsupported");
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), credentials: "same-origin" });
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
  return nativeMediaPlaylist(variant.href, signal, depth + 1);
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
  deliver;
  fullscreenContainer;
  ambient;
  controller = new SessionController;
  session;
  source;
  pipeline;
  startupFrameSeen = false;
  startupVideoCallback;
  original;
  originalJob;
  originalGeneration;
  overlay;
  overlayJob;
  overlayLoading;
  overlayEpoch = 0;
  subtitleStyle = readSubtitlePreferences();
  subtitleFailures = new Set;
  originalStartTimer;
  localDecoderRetries = new Set;
  originalClosing = Promise.resolve();
  status = "idle";
  backend = null;
  audioPreference;
  subtitlePreference;
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
  startupDeadlineMs = 45000;
  nativeOrigin = 0;
  pendingSeek;
  waitSince = 0;
  everPlayed = false;
  lastPosition = 0;
  lastAdvance = 0;
  wantsPlay = false;
  lowDelay = false;
  manualQuality = null;
  speed = 1;
  pendingTracks;
  track;
  lastObservation = 0;
  constructor(video, deliver, fullscreenContainer = video, ambient = false) {
    this.video = video;
    this.deliver = deliver;
    this.fullscreenContainer = fullscreenContainer;
    this.ambient = ambient;
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
    this.timer = setInterval(() => {
      this.checkWaiting();
      this.publish();
    }, 1000);
  }
  emit(event) {
    this.deliver(event.type === "error" ? {
      ...event,
      sessionId: this.session?.id ?? null,
      sourceGeneration: this.controller.source,
      seekGeneration: this.controller.seek
    } : event);
  }
  position() {
    return this.terminalMedia?.position ?? this.original?.position ?? (this.video.readyState >= 1 && Number.isFinite(this.video.currentTime) ? this.nativeOrigin + this.video.currentTime : this.resumePosition);
  }
  duration() {
    return this.terminalMedia?.duration ?? this.original?.readout.duration ?? (Number.isFinite(this.video.duration) ? this.nativeOrigin + this.video.duration : this.session?.duration ?? null);
  }
  frameMetrics() {
    const quality = this.video.getVideoPlaybackQuality?.();
    return { frames: this.original?.readout.frames ?? quality?.totalVideoFrames ?? null, dropped: this.original?.readout.dropped ?? quality?.droppedVideoFrames ?? null };
  }
  saveVolume() {
    if (this.ambient)
      return;
    try {
      localStorage.setItem("vela.player.volume", String(this.video.volume));
      localStorage.setItem("vela.player.muted", String(this.video.muted));
    } catch {}
  }
  checkWaiting() {
    if (this.pendingTracks && performance.now() - this.pendingTracks.startedAt > 15000) {
      this.pendingTracks = undefined;
      this.emit({ type: "error", failure: { kind: "action", message: "Track selection authorization timed out", recoverable: true } });
    }
    if (this.pendingSeek && !this.pendingSeek.authorized && performance.now() - this.pendingSeek.startedAt > 15000) {
      this.fail({ kind: "network", message: "Seek authorization timed out", recoverable: true });
      return;
    }
    if (this.pendingSwitch && performance.now() - this.pendingSwitch.startedAt > 15000) {
      this.pendingSwitch = undefined;
      this.fail({ kind: "network", message: "Source switch authorization timed out", recoverable: true });
      return;
    }
    if (!this.session || !this.source || !this.wantsPlay || ["failed", "ended", "recovering"].includes(this.status))
      return;
    const now = performance.now();
    if (this.position() > this.lastPosition + 0.02 && (this.original ? this.status === "playing" : !this.video.paused)) {
      this.everPlayed = true;
      this.lastAdvance = now;
      this.lastPosition = this.position();
      return;
    }
    const expired = !this.everPlayed ? now - this.waitSince > this.startupDeadlineMs : now - this.lastAdvance > 30000;
    if (expired)
      this.recover(new PlaybackFault(this.everPlayed ? "Playback stalled for 30 seconds" : `Playback did not start within ${this.startupDeadlineMs / 1000} seconds`, "network"), this.controller.token());
  }
  detachMedia() {
    for (const remove of this.listeners)
      remove();
    this.listeners = [];
  }
  bindMedia(token) {
    const { video } = this;
    this.detachMedia();
    for (const [name, handler] of Object.entries({
      volumechange: () => {
        this.saveVolume();
      },
      playing: () => {
        if (!this.video.paused && !this.video.error && this.video.readyState >= 3) {
          this.status = "playing";
          this.failure = null;
          if (this.pendingSeek?.authorized)
            this.pendingSeek = undefined;
        }
      },
      seeked: () => {
        if (this.pendingSeek?.authorized && !this.wantsPlay && this.video.readyState >= 2)
          this.pendingSeek = undefined;
      },
      pause: () => {
        if (!this.wantsPlay && !["loading", "recovering", "failed", "ended"].includes(this.status))
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
        if (!this.controller.current(token) || ["failed", "ended"].includes(this.status))
          return;
        const previous = this.status;
        const failure = this.failure;
        handler();
        if (previous !== this.status || failure !== this.failure)
          this.lastObservation = -Infinity;
        this.publish();
      };
      video.addEventListener(name, listener);
      this.listeners.push(() => video.removeEventListener(name, listener));
    }
  }
  get observationAllowed() {
    return this.session?.serverState !== "ended";
  }
  snapshot() {
    const ranges = this.video.buffered, quality = this.video.getVideoPlaybackQuality?.();
    const audioTrackIds = this.original ? this.original.audioTrackIds : this.session?.serverControlled ? this.session.audioTracks.map((t) => t.id) : this.backend === "mse" ? this.pipeline?.audioTracks ?? [] : this.session?.audioTracks.filter((t) => !!this.nativeAudio(t.id)).map((t) => t.id) ?? [];
    const subtitleTracks = this.overlay?.tracks.map((track) => ({
      id: track.id,
      label: track.label,
      language: track.language,
      codec: track.codec,
      streamIndex: track.streamIndex ?? undefined,
      forced: track.forced,
      delivery: track.delivery.kind === "external" ? undefined : track.delivery
    })) ?? this.session?.subtitleTracks.map(({ url, delivery, ...track }) => ({ ...track, delivery: delivery?.kind === "external" ? undefined : delivery })) ?? [];
    const burned = !!this.subtitle && this.session?.subtitleTracks.some((track) => track.id === this.subtitle && track.delivery?.kind === "burn-in") && !this.overlay?.tracks.some((track) => track.id === this.subtitle && track.delivery.kind === "embedded");
    const subtitleId = this.overlay && !burned ? this.overlay.selected : this.subtitle;
    const selectedSubtitle = this.overlay?.tracks.find((track) => track.id === subtitleId);
    const audioId = this.original?.readout.audioTrackId ?? this.pipeline?.audioTrackId ?? this.audio;
    return {
      sessionId: this.session?.id ?? null,
      sourceGeneration: this.controller.source,
      seekGeneration: this.controller.seek,
      state: this.pendingSeek ? "buffering" : this.status,
      sourceId: this.source?.id ?? null,
      strategy: this.source?.strategy ?? null,
      diagnostics: this.original ? { metadataDiscrepancies: this.original.readout.metadataDiscrepancies } : undefined,
      backend: this.backend,
      renditionId: this.pipeline?.current?.id ?? (this.backend === "native-hls" ? this.manualQuality ?? this.source?.initialRenditionId ?? null : null),
      qualityIds: this.pipeline?.qualityIds ?? [],
      capabilities: { pip: this.pipAvailable(), fullscreen: this.fullscreenAvailable(), audioSwitch: audioTrackIds.length > 1 },
      lockedQuality: this.manualQuality,
      audioTracks: this.original?.audioTracks ?? this.session?.audioTracks ?? [],
      subtitleTracks,
      renditions: this.source?.renditions?.map(({ url, ...rendition }) => rendition) ?? [],
      speed: this.speed,
      speeds: this.original && !this.original.setSpeed ? [] : [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      pendingSubtitleTrackId: this.pendingTracks?.subtitle ?? this.overlay?.pending ?? null,
      chapters: this.session?.chapters ?? [],
      subtitleError: this.overlay?.error ?? null,
      subtitleStyle: this.subtitleStyle,
      subtitleStyleAvailable: !!this.overlay && !burned && (!selectedSubtitle || ["srt", "webvtt", "tx3g"].includes(selectedSubtitle.codec)),
      subtitleReportingId: selectedSubtitle?.serverId ?? subtitleId,
      subtitleClientOnly: !!selectedSubtitle && !selectedSubtitle.serverId,
      audioClientOnly: !!audioId && !this.session?.audioTracks.some((track) => track.id === audioId),
      live: this.liveSnapshot(),
      seekTarget: this.pendingSeek?.position ?? null,
      waiting: !!this.pendingSeek || ["loading", "buffering", "recovering"].includes(this.status) || this.wantsPlay && this.video.seeking,
      volume: this.video.volume,
      muted: this.video.muted,
      preparation: ["loading", "buffering"].includes(this.status) && (this.original?.readout.frames ?? quality?.totalVideoFrames ?? 0) === 0 ? this.video.readyState < 1 ? "media-metadata" : this.video.paused ? "starting" : "initial-buffer" : null,
      position: this.position(),
      duration: this.duration(),
      playable: Array.from({ length: Math.min(ranges.length, 32) }, (_, i) => ({ start: this.nativeOrigin + ranges.start(i), end: this.nativeOrigin + ranges.end(i) })),
      throughputBps: this.pipeline?.bandwidth.bps ?? null,
      droppedFrames: this.terminalMedia?.dropped ?? this.original?.readout.dropped ?? quality?.droppedVideoFrames ?? null,
      totalFrames: this.terminalMedia?.frames ?? this.original?.readout.frames ?? quality?.totalVideoFrames ?? null,
      audioTrackIds,
      audioTrackId: audioId,
      pendingAudioTrackId: this.pendingTracks?.audio ?? this.original?.pendingAudioTrackId ?? this.pipeline?.pendingAudioTrackId ?? null,
      subtitleTrackId: subtitleId,
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
  publish(force = false) {
    if (this.disposed)
      return;
    if (this.pipeline?.audioTrackId)
      this.audio = this.pipeline.audioTrackId;
    if (this.original && !this.startupFrameSeen && this.original.readout.presentedFrames > 0) {
      this.startupFrameSeen = true;
      playbackMark("first-frame", "webgpu");
    }
    const now = performance.now();
    if (!force && now - this.lastObservation < 250)
      return;
    this.lastObservation = now;
    this.emit({ type: "snapshot", snapshot: this.snapshot() });
  }
  supported(source) {
    if (source.edition !== this.session?.edition)
      return false;
    if (source.delivery === "file")
      return source.original && canAttemptOriginal() || !!this.video.canPlayType(source.mime);
    return !!this.video.canPlayType("application/vnd.apple.mpegurl") || !!source.renditions?.some((r) => mediaSourceClass() && (!codecKnown(r) || mediaSourceClass().isTypeSupported(r.mime)));
  }
  useNativeHls(source) {
    const native = !!this.video.canPlayType("application/vnd.apple.mpegurl");
    const segmented = !!source.renditions?.some((r) => mediaSourceClass() && (!codecKnown(r) || mediaSourceClass().isTypeSupported(r.mime)));
    const pending = !!source.renditions?.some((r) => !codecKnown(r));
    const managed = "ManagedMediaSource" in globalThis;
    return native && (!segmented || navigator.vendor === "Apple Computer, Inc." && !managed && !pending);
  }
  candidates() {
    const priority = { direct: 0, remux: 1, transcode: 2 };
    return (this.session?.sources ?? []).filter((s) => this.supported(s)).sort((a, b) => priority[a.strategy] - priority[b.strategy]);
  }
  async load(session) {
    if (!this.timer)
      this.timer = setInterval(() => {
        this.checkWaiting();
        this.publish();
      }, 1000);
    if (session.id !== this.session?.id || session.sourceGeneration !== this.controller.source || session.seekGeneration !== this.controller.seek)
      this.localDecoderRetries.clear();
    const retained = session.sources.find((source) => source.id === session.selectedSourceId);
    if (retained && this.canRetainOriginal(session, retained)) {
      await this.seekRetainedOriginal(session, retained);
      return;
    }
    const pending = this.pendingSwitch;
    const handoff = pending && pending.sessionId === session.id && pending.sourceId === session.selectedSourceId && session.sourceGeneration !== undefined && session.seekGeneration !== undefined && session.sourceGeneration >= pending.source && session.sourceGeneration <= pending.source + 1 && session.seekGeneration >= pending.seek && session.seekGeneration <= pending.seek + 1 && (session.sourceGeneration > pending.source || session.seekGeneration > pending.seek);
    const position = handoff ? Math.max(pending.position, this.position()) : session.position ?? 0;
    const recovery = !!handoff && pending.recovery;
    this.pendingSwitch = undefined;
    if (session.id !== this.session?.id)
      this.pendingSeek = undefined;
    else if (this.pendingSeek && session.seekGeneration !== this.controller.seek)
      this.pendingSeek = { ...this.pendingSeek, position: session.position ?? this.pendingSeek.position, authorized: true };
    const previousServerState = session.id === this.session?.id ? this.session.serverState : undefined;
    if (session.id !== this.session?.id || session.selectedSourceId !== this.source?.id)
      this.manualQuality = null;
    if (session.id !== this.session?.id) {
      this.subtitleFailures.clear();
      this.subtitlePreference = undefined;
      this.audioPreference = undefined;
      this.lowDelayOverride = undefined;
      this.localTransportIntent = undefined;
      this.wantsPlay = session.serverState !== "paused" && session.serverState !== "ended";
    }
    this.controller.start(session.id, session.sourceGeneration, session.seekGeneration);
    this.resetMedia();
    this.session = session;
    this.pendingTracks = undefined;
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
    const preferred = this.audioPreference;
    const selected = session.sources.find((s) => s.id === session.selectedSourceId);
    this.audio = preferred && (selected?.audioRenditions?.some((a) => a.trackId === preferred) || selected?.original && session.audioTracks.some((track) => track.id === preferred)) ? preferred : session.audioTrackId ?? null;
    this.subtitle = session.subtitleTrackId ?? null;
    const source = this.candidates().find((s) => s.id === session.selectedSourceId) ?? this.candidates().find((s) => !this.audio || s.audioTrackId === this.audio) ?? this.candidates()[0];
    if (!source) {
      this.fail({ kind: "unsupported", message: "No browser-compatible source for this edition", recoverable: false });
      return;
    }
    await this.activate(source, position, recovery, true);
  }
  canRetainOriginal(session, source) {
    const previous = this.session, current = this.source, original = this.original;
    if (!previous || !current || !original?.retainsSource || !this.originalJob || this.originalJob.signal.aborted || session.serverState === "ended" || session.id !== previous.id || session.mediaId !== previous.mediaId || session.sourceGeneration !== this.controller.source || session.seekGeneration === this.controller.seek || !source.original || source.id !== current.id || source.url !== current.url || source.edition !== current.edition || source.timeline !== current.timeline || source.sourceRevision !== current.sourceRevision || source.timelineOriginSeconds !== current.timelineOriginSeconds || (session.subtitleTrackId ?? null) !== this.subtitle)
      return false;
    const identities = (tracks) => JSON.stringify(tracks.map((track) => [track.id, track.streamIndex]));
    if (identities(session.audioTracks) !== identities(previous.audioTracks))
      return false;
    const selected = this.audioPreference && session.audioTracks.some((track) => track.id === this.audioPreference) ? this.audioPreference : session.audioTrackId ?? null;
    return selected === original.readout.audioTrackId;
  }
  async seekRetainedOriginal(session, source) {
    const original = this.original;
    const previous = this.session?.serverState;
    const token = this.controller.start(session.id, session.sourceGeneration, session.seekGeneration);
    this.originalGeneration = token;
    this.session = session;
    this.source = source;
    this.pendingTracks = undefined;
    this.pendingSwitch = undefined;
    this.pendingSeek = { position: session.position ?? 0, startedAt: performance.now(), authorized: true };
    this.status = "buffering";
    this.failure = null;
    this.lastObservation = -Infinity;
    this.applyServerState(session.serverState, previous);
    this.publish();
    try {
      if (this.wantsPlay)
        original.resume();
      else
        original.pause();
      const seeking = original.seek(session.position ?? 0);
      if (this.overlay)
        this.overlay.seek(session.position ?? 0, ++this.overlayEpoch).catch(() => {});
      await seeking;
      if (!this.controller.current(token) || this.original !== original)
        return;
      this.pendingSeek = undefined;
      this.status = original.readout.state;
      this.lastObservation = -Infinity;
      this.publish();
    } catch (error) {
      if (this.controller.current(token) && this.original === original)
        await this.recover(error, token);
    }
  }
  updateSession(session) {
    if (session.id !== this.session?.id)
      throw new Error("Cannot update a different session");
    const previousState = this.session?.serverState;
    this.session = session;
    if (this.pendingTracks && (this.pendingTracks.audio === undefined || this.pendingTracks.audio === session.audioTrackId) && (this.pendingTracks.subtitle === undefined || this.pendingTracks.subtitle === (session.subtitleTrackId ?? null)))
      this.pendingTracks = undefined;
    const source = session.sources.find((s) => s.id === this.source?.id);
    if (source) {
      this.source = source;
      this.pipeline?.updateRenditions(source.renditions ?? []);
    }
    this.applyServerState(session.serverState, previousState);
    if (this.status === "ended")
      return;
    this.lowDelay = this.lowDelayOverride ?? session.lowDelay ?? this.lowDelay;
    if (this.pipeline) {
      this.pipeline.lowDelay = this.lowDelay;
      this.pipeline.maxLiveDrift = session.liveMaxDrift ?? 45;
    }
    if (this.subtitlePreference !== undefined && (session.subtitleTrackId ?? null) === this.subtitlePreference)
      this.subtitlePreference = undefined;
    if (this.subtitlePreference === undefined && (session.subtitleTrackId ?? null) !== this.subtitle) {
      this.subtitle = session.subtitleTrackId ?? null;
      this.applySubtitle();
    }
    if ((session.audioTrackId ?? null) !== this.audio) {
      if (this.original && this.audioPreference === this.audio && session.audioTracks.some((track) => track.id === this.audio))
        return;
      const previous = this.audio;
      const preferred = this.audioPreference;
      const selected = session.sources.find((s) => s.id === session.selectedSourceId);
      this.audio = preferred && selected?.audioRenditions?.some((a) => a.trackId === preferred) ? preferred : session.audioTrackId ?? null;
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
      this.original?.pause();
      this.video.pause();
      this.status = "paused";
      this.publish();
    } else if (this.video.paused)
      this.play();
  }
  endPlayback(position) {
    if (this.status === "ended" && this.terminalMedia)
      return;
    this.terminalMedia = { position: position ?? this.position(), duration: this.duration(), ...this.frameMetrics() };
    this.pendingSeek = undefined;
    this.releaseOriginal();
    this.detachMedia();
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
  releaseOriginal() {
    this.releaseOverlay();
    if (this.originalStartTimer)
      clearTimeout(this.originalStartTimer);
    this.originalStartTimer = undefined;
    const original = this.original;
    this.original = undefined;
    this.originalJob?.abort();
    this.originalJob = undefined;
    this.originalGeneration = undefined;
    if (original)
      this.originalClosing = original.dispose().catch(() => {});
  }
  resetMedia() {
    if (this.startupVideoCallback !== undefined)
      this.video.cancelVideoFrameCallback?.(this.startupVideoCallback);
    this.startupVideoCallback = undefined;
    if (this.originalStartTimer)
      clearTimeout(this.originalStartTimer);
    this.originalStartTimer = undefined;
    this.releaseOriginal();
    this.nativeOrigin = 0;
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
  async activate(source, position, recovery = false, initial = false, retry) {
    this.startupDeadlineMs = source.renditions?.some((r) => !codecKnown(r)) ? 60000 : 45000;
    this.resumePosition = position;
    this.waitSince = performance.now();
    this.lastAdvance = this.waitSince;
    this.lastPosition = position;
    this.everPlayed = false;
    const token = this.controller.changeSource(!initial);
    this.resetMedia();
    this.source = source;
    this.startupFrameSeen = false;
    playbackMark("source:open", source.delivery);
    this.startupVideoCallback = this.video.requestVideoFrameCallback?.(() => {
      if (this.controller.current(token)) {
        this.startupVideoCallback = undefined;
        if (!this.original && !this.startupFrameSeen) {
          this.startupFrameSeen = true;
          playbackMark("first-frame", this.backend === "mse" ? "mse" : "native");
        }
      }
    });
    this.bindMedia(token);
    this.attempted.add(source.id);
    this.status = recovery ? "recovering" : "loading";
    this.failure = null;
    this.lastObservation = -Infinity;
    this.publish();
    if (source.original && canAttemptOriginal()) {
      this.backend = "webgpu";
      this.startupDeadlineMs = 8000;
      this.originalStartTimer = setTimeout(() => {
        this.originalStartTimer = undefined;
        if (this.controller.current(token) && !(this.original?.readout.presentedFrames ?? 0))
          this.recover(new PlaybackFault("Original first-frame deadline exceeded (8 seconds)", "decoder"), token);
      }, 8000);
    }
    try {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3500);
        this.originalClosing.then(() => {
          clearTimeout(timer);
          resolve();
        }, () => {
          clearTimeout(timer);
          resolve();
        });
      });
      cancelled(token.signal);
      if (source.original && !this.session?.live && canAttemptOriginal()) {
        this.backend = "webgpu";
        this.startupDeadlineMs = 8000;
        const parent = this.video.parentElement;
        if (!(parent instanceof HTMLDivElement))
          throw new Error("Original renderer surface is missing");
        const job = this.originalJob = new AbortController;
        this.originalGeneration = token;
        const current = () => this.originalJob === job && !job.signal.aborted && !!this.originalGeneration && this.controller.current(this.originalGeneration);
        const original = await loadOriginalRuntime({
          surface: { container: parent, video: this.video },
          signal: job.signal,
          retry,
          onFailure: (reason) => {
            if (current())
              this.recover(new PlaybackFault(reason, "decoder"), this.originalGeneration);
          },
          onEvent: (event) => {
            if (!current() || !this.original)
              return;
            if (event.type === "waiting")
              this.status = "buffering";
            else if (event.type === "playing" || event.type === "statechange") {
              this.status = this.original.readout.state;
              if (this.status === "playing") {
                this.failure = null;
                if (this.pendingSeek?.authorized)
                  this.pendingSeek = undefined;
              }
            } else if (event.type === "ended") {
              this.endPlayback();
              return;
            }
            this.publish();
          }
        });
        cancelled(token.signal);
        this.original = original;
        if (!this.wantsPlay)
          original.pause();
        if (this.subtitle && !original.supportsSubtitles)
          throw new Error("Selected subtitles require a compatible fallback; original overlay is not ready");
        const info = source.originalVideo;
        await original.open({
          url: source.url,
          container: "",
          duration: this.session?.duration ?? null,
          position,
          video: { ...info, codec: info?.codec ?? "", width: info?.width ?? 0, height: info?.height ?? 0 },
          audio: (this.session?.audioTracks ?? []).map((t) => ({ id: t.id, label: t.label, codec: t.codec ?? "", channels: t.channels, language: t.language, streamIndex: t.streamIndex ?? -1 })),
          selectedAudioId: this.audio
        });
        if (original.setSpeed)
          await original.setSpeed(this.speed);
        if (original.supportsSubtitles)
          this.ensureOverlay().then(() => this.applySubtitle()).catch((error) => {
            if (current()) {
              const message = error instanceof Error ? error.message : "Subtitle discovery failed";
              if (this.subtitle)
                this.subtitleFailed({ trackId: this.subtitle, serverId: this.session?.subtitleTracks.find((track) => track.id === this.subtitle)?.id, code: "subtitle-unavailable", message });
              else
                this.emit({ type: "error", failure: { kind: "action", message, recoverable: true } });
            }
          });
        cancelled(token.signal);
        this.status = original.readout.state;
        if (this.pendingSeek?.authorized && this.status === "paused")
          this.pendingSeek = undefined;
        this.publish();
        return;
      }
      if (source.delivery === "hls" && !this.useNativeHls(source)) {
        this.backend = "mse";
        const pipeline = this.pipeline = new SegmentPipeline(this.video, () => this.publish(), () => {
          if (this.controller.current(token) && this.session)
            this.emit({ type: "session-refresh", sessionId: this.session.id });
        });
        pipeline.timelineOriginSeconds = source.timelineOriginSeconds ?? 0;
        pipeline.audioRenditions = source.audioRenditions ?? [];
        pipeline.initialAudioTrackId = this.audio;
        pipeline.expensiveSwitches = source.strategy === "transcode";
        pipeline.initialRenditionId = this.manualQuality ?? source.initialRenditionId;
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
        const pinned = source.renditions?.find((r) => r.id === this.manualQuality);
        const media = source.delivery === "hls" ? await nativeMediaPlaylist(pinned?.url ?? source.url, token.signal) : { url: source.url, duration: null };
        cancelled(token.signal);
        const legacyOffset = !this.session?.live && position > 0 && media.duration !== null && this.session?.duration !== undefined && Math.abs(media.duration + position - this.session.duration) <= 0.25;
        if (source.timelineOriginSeconds !== undefined && (!Number.isFinite(source.timelineOriginSeconds) || source.timelineOriginSeconds < 0))
          throw new Error("Invalid media timeline origin");
        this.nativeOrigin = source.delivery === "hls" ? source.timelineOriginSeconds ?? (legacyOffset ? position : 0) : 0;
        this.video.src = media.url;
      }
      await this.metadata(token);
      cancelled(token.signal);
      this.video.playbackRate = this.speed;
      if (this.backend !== "mse" && position > 0)
        this.video.currentTime = Math.max(0, position - this.nativeOrigin);
      this.applySubtitle();
      this.applyNativeAudio();
      this.status = this.wantsPlay ? "loading" : "paused";
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
      }, this.startupDeadlineMs);
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
    if (this.pendingTracks) {
      this.pendingTracks = undefined;
      if (message)
        this.emit({ type: "error", failure: { kind: "action", message, recoverable: true } });
      this.publish();
      return;
    }
    this.pendingSwitch = undefined;
    if (message)
      this.fail({ kind: "source", message, recoverable: false });
  }
  requestTracks(tracks) {
    if (!this.session?.serverControlled)
      throw new Error("Server track selection is unavailable");
    if (this.pendingTracks)
      throw new Error("A track selection is already pending");
    this.pendingTracks = { ...tracks, startedAt: performance.now() };
    this.emit({ type: "session-command", sessionId: this.session.id, command: {
      kind: "tracks",
      sourceGeneration: this.controller.source,
      seekGeneration: this.controller.seek,
      idempotencyKey: randomId(),
      ...tracks.audio === undefined ? {} : { audioTrackId: tracks.audio },
      ...tracks.subtitle === undefined ? {} : { subtitleTrackId: tracks.subtitle }
    } });
  }
  requestSeek(seconds) {
    this.pendingSeek = { position: seconds, startedAt: performance.now(), authorized: false };
    this.status = "buffering";
    this.original?.pause();
    this.video.pause();
    this.lastObservation = -Infinity;
    this.publish();
    this.emit({ type: "session-command", sessionId: this.session.id, command: {
      kind: "seek",
      positionSeconds: seconds,
      sourceGeneration: this.controller.source,
      seekGeneration: this.controller.seek,
      idempotencyKey: randomId()
    } });
  }
  requestSwitch(source, position, recovery = false) {
    const boundary = "onDemand" in source ? position : source.boundaries?.filter((at) => at <= position).sort((a, b) => b - a)[0];
    if (boundary === undefined)
      throw new Error("No independent switch boundary offered by server");
    this.pendingSwitch = { startedAt: performance.now(), sessionId: this.session.id, sourceId: source.id, source: this.controller.source, seek: this.controller.seek, position, recovery };
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
    const position = this.position();
    const duration = this.duration();
    const metrics = this.frameMetrics();
    this.pendingSeek = undefined;
    this.failure = failure;
    this.status = "failed";
    this.controller.cancel();
    this.detachMedia();
    this.resetMedia();
    this.terminalMedia = { position, duration, ...metrics };
    this.emit({ type: "error", failure });
    this.lastObservation = -Infinity;
    this.publish();
  }
  async recover(error, token) {
    if (!this.controller.current(token) || this.recovering)
      return;
    this.recovering = true;
    const kind = error instanceof PlaybackFault ? error.kind : error instanceof TypeError || error instanceof DOMException && error.name === "TimeoutError" ? "network" : "source";
    const position = this.position();
    const failure = { kind, message: error instanceof Error ? error.message : String(error), recoverable: true };
    if (this.originalStartTimer)
      clearTimeout(this.originalStartTimer);
    this.originalStartTimer = undefined;
    playbackMark("source:failed");
    this.status = "recovering";
    this.failure = failure;
    this.publish(true);
    try {
      const retry = this.backend === "webgpu" && (!failure.message.startsWith("Original first-frame deadline") || this.original?.readout.decoderReady) ? decoderRetry(failure.message) : null;
      if (retry && this.source?.original && !this.localDecoderRetries.has(this.source.id)) {
        this.localDecoderRetries.add(this.source.id);
        this.recovering = false;
        await this.activate(this.source, position, true, true, retry);
        return;
      }
      this.resumePosition = position;
      this.releaseOriginal();
      await delay(300, token.signal);
      if (!this.video.error && this.video.readyState >= 3 && (!this.video.paused || !this.wantsPlay)) {
        this.status = this.video.paused ? "paused" : "playing";
        this.failure = null;
        this.lastObservation = -Infinity;
        this.publish();
        return;
      }
      const source = this.candidates().find((s) => !this.attempted.has(s.id) && s.recoveryAllowed !== false && s.timeline === this.source?.timeline && s.edition === this.source?.edition && (!this.audio || s.audioTrackId === this.audio));
      if (!source) {
        const pending = this.session?.onDemandSources?.find((s) => !this.attempted.has(s.id));
        if (pending && this.session?.serverControlled) {
          this.attempted.add(pending.id);
          this.requestSwitch(pending, position, true);
          return;
        }
        this.fail({ ...failure, recoverable: false });
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
    if (this.original) {
      this.original.resume();
      return;
    }
    const token = this.controller.token();
    try {
      await this.video.play();
      if (this.controller.current(token)) {
        if (["failed", "ended"].includes(this.status) || this.video.error)
          return;
        this.status = "playing";
        this.failure = null;
        if (this.pendingSeek?.authorized)
          this.pendingSeek = undefined;
        this.lastObservation = -Infinity;
        this.publish();
      }
    } catch (e) {
      if (!this.controller.current(token))
        return;
      if (e instanceof DOMException && e.name === "NotAllowedError" && !this.video.muted) {
        this.video.muted = true;
        try {
          await this.video.play();
          if (!this.controller.current(token))
            return;
          this.status = "playing";
          this.failure = null;
          if (this.pendingSeek?.authorized)
            this.pendingSeek = undefined;
          this.lastObservation = -Infinity;
          this.publish();
          return;
        } catch (retryError) {
          e = retryError;
        }
      }
      if (this.controller.current(token))
        this.fail({ kind: "action", message: e instanceof Error ? e.message : String(e), recoverable: true });
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
    if (this.backend === "webgpu")
      return !!document.fullscreenEnabled && !!this.fullscreenContainer.requestFullscreen;
    return !!document.fullscreenEnabled && !!this.fullscreenContainer.requestFullscreen || !!this.video.webkitEnterFullscreen && this.video.webkitSupportsFullscreen !== false;
  }
  releaseOverlay() {
    this.overlayJob?.abort();
    this.overlayJob = undefined;
    this.overlay?.dispose();
    this.overlay = undefined;
    this.overlayLoading = undefined;
    this.overlayEpoch++;
  }
  async ensureOverlay() {
    if (this.overlay)
      return this.overlay;
    if (this.overlayLoading)
      return this.overlayLoading;
    const source = this.source, session = this.session;
    const surface = this.video.parentElement;
    if (!source || !session || !(surface instanceof HTMLDivElement))
      throw new Error("Subtitle source is unavailable");
    const job = this.overlayJob = new AbortController;
    const original = this.original;
    const current = () => this.overlayJob === job && !job.signal.aborted && !this.disposed;
    const loading = (async () => {
      const overlay = await loadSubtitleSession({
        surface,
        reader: original?.supportsSubtitles ? original.byteReader : undefined,
        source: { url: source.url, container: original?.sourceContainer ?? source.delivery, sessionId: session.id, sourceGeneration: this.controller.source, seekGeneration: this.controller.seek },
        epoch: ++this.overlayEpoch,
        clock: () => this.position(),
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
          const width = this.video.videoWidth || video?.width || rect.width, height = this.video.videoHeight || video?.height || rect.height;
          const scale = Math.min(rect.width / width, rect.height / height), y = (rect.height - height * scale) / 2;
          const button = this.fullscreenContainer.querySelector('[data-testid="player-toggle"]');
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
            this.publish(true);
        },
        onState: () => {
          if (current())
            this.publish(true);
        },
        onFailure: (failure) => {
          if (current())
            this.subtitleFailed(failure);
        }
      });
      if (!current()) {
        overlay.dispose();
        throw new DOMException("Subtitle source retired", "AbortError");
      }
      this.overlay = overlay;
      overlay.setPreferences(this.subtitleStyle);
      await overlay.discover();
      job.signal.throwIfAborted();
      return overlay;
    })();
    this.overlayLoading = loading;
    try {
      return await loading;
    } catch (error) {
      if (current())
        this.releaseOverlay();
      throw error;
    }
  }
  subtitleFailed(failure) {
    const serverId = failure.serverId;
    const key = `${this.session?.id}:${this.source?.sourceRevision ?? this.source?.timeline}:${failure.trackId}`;
    if (serverId && this.session?.serverControlled && this.overlay?.tracks.some((track) => track.id === failure.trackId && track.delivery.kind === "embedded") && this.session.subtitleTracks.some((track) => track.id === serverId) && !this.subtitleFailures.has(key) && !this.pendingTracks && !this.pendingSwitch && !this.recovering && !["failed", "ended"].includes(this.status)) {
      this.subtitleFailures.add(key);
      this.requestTracks({ subtitle: serverId });
    } else
      this.emit({ type: "error", failure: { kind: "action", message: failure.message, recoverable: true } });
  }
  applySubtitle() {
    this.track?.remove();
    this.track = undefined;
    if (this.overlay) {
      const selected = this.overlay.tracks.find((track) => track.id === this.subtitle);
      if (selected?.delivery.kind === "burn-in") {
        this.overlay.select(null);
        return;
      }
      this.overlay.select(this.subtitle).catch(() => {});
      return;
    }
    if (!this.subtitle)
      return;
    const selected = this.session?.subtitleTracks.find((t) => t.id === this.subtitle);
    if (selected?.delivery?.kind === "burn-in")
      return;
    const source = this.source, id = this.subtitle;
    this.ensureOverlay().then(() => {
      if (source === this.source && id === this.subtitle)
        this.applySubtitle();
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError" || source !== this.source || id !== this.subtitle)
        return;
      try {
        this.applyLegacySubtitle();
      } catch (error) {
        this.emit({ type: "error", failure: { kind: "action", message: error instanceof Error ? error.message : "Subtitle unavailable", recoverable: true } });
      }
    });
  }
  applyLegacySubtitle() {
    if (this.disposed || !this.subtitle || this.track)
      return;
    const selected = this.session?.subtitleTracks.find((track) => track.id === this.subtitle);
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
          this.original?.pause();
          this.video.pause();
          break;
        case "retry":
          if (this.session)
            await this.load({ ...this.session, position: this.terminalMedia?.position ?? this.position() });
          break;
        case "switchPath": {
          const source = this.candidates().find((s) => s.id === command.pathId) ?? this.session?.onDemandSources?.find((s) => s.id === command.pathId);
          if (!source || source.id === this.source?.id)
            break;
          if (this.session?.serverControlled)
            this.requestSwitch({ id: source.id, onDemand: true }, this.position());
          else if (!("onDemand" in source) && source.recoveryAllowed !== false)
            await this.activate(source, this.position());
          break;
        }
        case "seekBy": {
          if (!Number.isFinite(command.seconds))
            throw new Error("Invalid relative seek");
          const upper = this.duration() ?? Infinity;
          await this.command({ id: command.id, type: "seek", seconds: Math.max(0, Math.min(upper, (this.pendingSeek?.position ?? this.position()) + command.seconds)) });
          break;
        }
        case "seek": {
          if (!Number.isFinite(command.seconds) || command.seconds < 0 || this.duration() !== null && command.seconds > this.duration())
            throw new Error("Seek outside media timeline");
          if (this.session?.serverControlled) {
            this.requestSeek(command.seconds);
            break;
          }
          this.controller.changeSeek();
          if (this.backend === "mse" && this.source)
            await this.activate(this.source, command.seconds, false, true);
          else
            this.video.currentTime = Math.max(0, command.seconds - this.nativeOrigin);
          break;
        }
        case "catchUp": {
          const target = this.catchUpTarget();
          if (target === null)
            throw new Error("No newer usable live buffer or seekable range");
          await this.command({ id: command.id, type: "seek", seconds: target });
          break;
        }
        case "mute":
          this.video.muted = command.muted ?? !this.video.muted;
          this.original?.setMuted(this.video.muted);
          this.saveVolume();
          this.lastObservation = -Infinity;
          break;
        case "volume":
          if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1)
            throw new Error("Volume outside 0–1");
          this.video.volume = command.value;
          this.original?.setVolume(command.value);
          if (command.value > 0)
            this.video.muted = false;
          this.original?.setMuted(this.video.muted);
          this.saveVolume();
          this.lastObservation = -Infinity;
          break;
        case "speed":
          if (!Number.isFinite(command.value) || command.value < 0.5 || command.value > 2)
            throw new Error("Playback speed must be between 0.5 and 2");
          if (this.original) {
            if (!this.original.setSpeed)
              throw new Error("Playback speed requires an updated runtime");
            await this.original.setSpeed(command.value);
          } else
            this.video.playbackRate = command.value;
          this.speed = command.value;
          break;
        case "subtitleStyle":
          this.subtitleStyle = updateSubtitlePreference(this.subtitleStyle, command.value);
          this.overlay?.setPreferences(this.subtitleStyle);
          break;
        case "quality": {
          if (command.renditionId?.startsWith("path:")) {
            await this.command({ id: command.id, type: "switchPath", pathId: command.renditionId.slice(5) });
            break;
          }
          const chosen = this.source?.renditions?.find((r) => r.id === command.renditionId);
          if (command.renditionId && !chosen)
            throw new Error("Unknown quality rendition");
          if (this.source?.delivery !== "hls") {
            if (command.renditionId)
              throw new Error("Original quality is fixed");
            break;
          }
          this.manualQuality = command.renditionId;
          if (this.pipeline && (!chosen || this.pipeline.qualityIds.includes(chosen.id)))
            this.pipeline.abr.manual = command.renditionId;
          else if (this.source)
            await this.activate(this.source, this.position(), false, true);
          break;
        }
        case "audio": {
          if (!(this.original?.audioTrackIds ?? this.session?.audioTracks.map((track) => track.id) ?? []).includes(command.trackId))
            throw new Error("Unknown audio track");
          if (this.original) {
            const original = this.original;
            await original.selectAudio(command.trackId);
            if (this.original !== original)
              return;
            this.audio = command.trackId;
            this.audioPreference = command.trackId;
            break;
          }
          if (this.pipeline?.audioTracks.includes(command.trackId)) {
            this.audioPreference = command.trackId;
            try {
              await this.pipeline.selectAudio(command.trackId);
            } catch (error) {
              if (this.audioPreference === command.trackId)
                this.audioPreference = this.audio ?? undefined;
              throw error;
            }
            break;
          }
          if (this.session?.serverControlled && !this.nativeAudio(command.trackId)) {
            this.requestTracks({ audio: command.trackId });
            break;
          }
          const previous = this.audio;
          this.audio = command.trackId;
          if (this.applyNativeAudio())
            break;
          const source = this.candidates().find((s) => s.audioTrackId === command.trackId && s.timeline === this.source?.timeline);
          if (!source) {
            this.audio = previous;
            throw new Error("Audio selection requires a compatible server source");
          }
          await this.activate(source, this.position());
          break;
        }
        case "subtitle": {
          if (this.original?.supportsSubtitles) {
            const overlay = await this.ensureOverlay();
            const local = overlay.tracks.find((track) => track.id === command.trackId);
            if (command.trackId === null || local?.delivery.kind !== "burn-in" && !!local) {
              this.subtitlePreference = command.trackId;
              this.subtitle = command.trackId;
              await overlay.select(command.trackId);
              break;
            }
          }
          const selected = command.trackId ? this.session?.subtitleTracks.find((t) => t.id === command.trackId) : null;
          if (command.trackId && !selected)
            throw new Error("Unknown subtitle track");
          const current = this.session?.subtitleTracks.find((t) => t.id === this.subtitle);
          if (selected?.delivery?.kind === "burn-in" || current?.delivery?.kind === "burn-in") {
            this.requestTracks({ subtitle: command.trackId });
            break;
          }
          if (this.original && command.trackId && this.session?.serverControlled) {
            this.requestTracks({ subtitle: command.trackId });
            break;
          }
          if (this.original && command.trackId)
            throw new Error("This source has no installed subtitle renderer");
          if (command.trackId && !this.session?.subtitleTracks.some((t) => t.id === command.trackId && t.url))
            throw new Error("Unknown WebVTT track");
          this.subtitlePreference = command.trackId;
          this.subtitle = command.trackId;
          this.applySubtitle();
          break;
        }
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
      if (e instanceof DOMException && e.name === "AbortError")
        return;
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
    duration: plan.durationSeconds,
    live: !!plan.channelId,
    liveWindowStart: plan.live?.windowStartSeconds,
    liveEdge: plan.live?.liveEdgeSeconds,
    liveMaxDrift: plan.live?.maxDriftSeconds,
    lowDelay: plan.live?.mode === "low-delay",
    sourceGeneration: plan.sourceGeneration,
    seekGeneration: plan.seekGeneration,
    audioTrackId: plan.selectedAudioTrackId,
    subtitleTrackId: plan.selectedSubtitleTrackId ?? undefined,
    chapters: plan.chapters,
    audioTracks: plan.audioTracks.map((t) => ({ id: t.id, label: t.name, language: t.language, codec: t.codec, channels: t.channels, streamIndex: t.streamIndex })),
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
    ...snapshot.failure ? { error: { class: snapshot.failure.kind === "network" ? "transient" : snapshot.failure.kind === "decoder" ? "decoder" : "source", message: snapshot.failure.message } } : {}
  };
}

// client/player/web-module.ts
var abi = 1;
var roster = { "vela-player": { snapshot: false }, "vela-context": { snapshot: false }, "vela-preview": { snapshot: false }, "vela-install": { snapshot: false }, "vela-theme": { snapshot: false }, "vela-engine": { snapshot: false } };
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
    const handle = { context: true, disposed: false, lastNavigation: "", probe: "", revision: 0, abort: new AbortController, event };
    const props = JSON.parse(json);
    handle.probe = props.probe ?? "";
    if (handle.probe === "media")
      handle.releaseTiming = mountPlaybackTiming();
    navigateSecurely(handle, props);
    queueMicrotask(() => {
      publishContext(handle);
    });
    return handle;
  }
  if (tag !== "vela-player")
    throw new Error(`Unknown player view: ${tag}`);
  const ambient = JSON.parse(json).ambient === "true";
  const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  const video = document.createElement("video");
  video.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none";
  const surface = document.createElement("div");
  surface.style.cssText = "position:relative;width:100%;height:100%;isolation:isolate;z-index:0;pointer-events:none";
  const style = document.createElement("style");
  style.textContent = ".webgpuPlayerCanvas{position:absolute;display:block;z-index:1;opacity:0;pointer-events:none}.webgpuPlayerCanvas-visible{opacity:1}";
  surface.append(video);
  root.replaceChildren(style, surface);
  const handle = { engine: undefined, video, sessionJson: "", lastCommand: -1, planRevision: -1, planSession: "", sequence: 0, lastReport: 0, serverError: "", endedReport: "", reportedFailure: "", reportedTracks: "" };
  handle.engine = new PlaybackEngine(video, (value) => {
    event(8, JSON.stringify(value));
    const now = performance.now();
    const failureKey = value.type === "snapshot" && value.snapshot.failure ? `${value.snapshot.sessionId}:${value.snapshot.sourceGeneration}:${value.snapshot.seekGeneration}:${value.snapshot.sourceId}:${value.snapshot.failure.kind}:${value.snapshot.failure.message}` : "";
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
      const endedKey = `${value.snapshot.sessionId}:${value.snapshot.sourceGeneration}:${value.snapshot.seekGeneration}`;
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
  }, element.parentElement ?? element, ambient);
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
    return;
  }
  handle.engine.dispose();
  handle.video.remove();
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
    const payload = handle.probe === "media" ? JSON.stringify(await mediaCapabilities(handle.abort.signal)) : handle.probe === "network" ? JSON.stringify({ saveData: navigator.connection?.saveData === true }) : location.origin;
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

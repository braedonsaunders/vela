'use strict';
function acceptPlan(previous, next) {
  return !!next && (previous?.sessionId !== next.sessionId ||
    (next.sourceGeneration >= previous.sourceGeneration && next.seekGeneration >= previous.seekGeneration));
}
function physicalBounds(content, rect, scale) {
  return { x: Math.round((content.x + rect.x) * scale), y: Math.round((content.y + rect.y) * scale),
    width: Math.max(0, Math.round(rect.width * scale)), height: Math.max(0, Math.round(rect.height * scale)) };
}
function playbackRate(plan, requested) {
  return plan?.channelId || plan?.live || plan?.livePolicy ? 1 : Math.max(.25,Math.min(4,Number.isFinite(requested) ? requested : 1));
}
module.exports = { acceptPlan, physicalBounds, playbackRate };

// HDMI ELD (/proc/asound/cardN/eld#D.P): the sink's own list of audio formats, from its EDID.
const ELD_CODECS = { 0x2: 'ac3', 0x7: 'dts', 0xa: 'eac3', 0xb: 'dts-hd', 0xc: 'truehd' };
function parseEld(text) {
  const field = name => (new RegExp(`^${name}\\s+(.+)$`, 'm').exec(text) || [])[1];
  if (field('monitor_present') !== '1' || field('eld_valid') !== '1') return null;
  const result = { name: field('monitor_name') || '', passthrough: [], maxChannels: 2, maxSampleRate: 0 };
  for (const match of text.matchAll(/^sad(\d+)_coding_type\s+\[0x([0-9a-f]+)\]/gim)) {
    const type = parseInt(match[2], 16), index = match[1];
    if (type === 1) {
      const channels = Number((new RegExp(`^sad${index}_channels\\s+(\\d+)`, 'm').exec(text) || [])[1]) || 2;
      const rates = ((new RegExp(`^sad${index}_rates\\s+\\[[^\\]]*\\]\\s*(.*)$`, 'm').exec(text) || [])[1] || '').split(/\s+/).map(Number).filter(Boolean);
      result.maxChannels = Math.max(result.maxChannels, channels);
      result.maxSampleRate = Math.max(result.maxSampleRate, ...rates, 0);
    } else if (ELD_CODECS[type] && !result.passthrough.includes(ELD_CODECS[type])) result.passthrough.push(ELD_CODECS[type]);
  }
  return result;
}

const PASSTHROUGH = ['ac3', 'eac3', 'dts', 'dts-hd', 'truehd'];
/** playback.json (same fields as Windows): passthrough "auto" | "off" | [...], exclusive, audioDevice. */
function playbackSettings(value) {
  const settings = { passthrough: PASSTHROUGH, exclusive: false, audioDevice: '' };
  if (!value || typeof value !== 'object') return settings;
  if (value.passthrough === 'off') settings.passthrough = [];
  else if (Array.isArray(value.passthrough)) settings.passthrough = PASSTHROUGH.filter(codec => value.passthrough.includes(codec));
  if (value.exclusive === true) settings.exclusive = true;
  if (typeof value.audioDevice === 'string' && /^(alsa|pulse|pipewire)\/[\w:=,.@\- ]{1,200}$/.test(value.audioDevice)) settings.audioDevice = value.audioDevice;
  return settings;
}

/** mpv's audio options for these settings. A direct ALSA device is exclusive and bit-perfect by nature. */
function audioOptions(settings, sink) {
  const direct = settings.audioDevice.startsWith('alsa/');
  const wanted = sink && direct ? settings.passthrough.filter(codec => sink.passthrough.includes(codec)) : settings.passthrough;
  return { 'audio-device': settings.audioDevice || 'auto', 'audio-spdif': wanted.join(','),
    'audio-exclusive': settings.exclusive || direct, 'audio-channels': direct ? 'auto' : 'auto-safe' };
}

/** The page's subtitle preferences as mpv sub-* properties; styled ASS keeps its look. */
function subtitleProperties(appearance) {
  if (!appearance || typeof appearance !== 'object') return [];
  const box = appearance.subtitleBackground === 'box', none = appearance.subtitleBackground === 'none';
  const properties = [
    ['sub-scale', { small: 0.8, large: 1.25, xl: 1.5 }[appearance.subtitleSize] || 1],
    ['sub-color', appearance.subtitleColor === 'yellow' ? '#FFFFE14D' : '#FFFFFFFF'],
    ['sub-pos', appearance.subtitlePosition === 'raised' ? 88 : 100],
    ['sub-border-style', box ? 'background-box' : 'outline-and-shadow'],
    ['sub-shadow-offset', box || none ? 0 : 1.5],
  ];
  if (box) properties.push(['sub-back-color', '#B0000000']);
  else properties.push(['sub-border-size', none ? 1.5 : 2.5]);
  if (Number.isFinite(appearance.offsetSeconds)) properties.push(['sub-delay', appearance.offsetSeconds]);
  return properties;
}
module.exports.parseEld = parseEld;
module.exports.playbackSettings = playbackSettings;
module.exports.audioOptions = audioOptions;
module.exports.subtitleProperties = subtitleProperties;

// Live timeshift: the same rules as the web player (modules/vela-player/web/engine/live-behind.ts,
// host/live.ts) and the Apple player (ios/PlayerState.swift LiveTimeline). Live stays at rate 1 and
// is never moved by the host on its own; only the viewer's seek, catchUp and play commands move it.

/** A live channel, or a Start over plan (`live.mode: 'startOver'`, a growing EVENT playlist from 0). */
function isLive(plan) { return !!plan && (plan.channelId != null || plan.live != null); }
function isStartOver(plan) { return plan?.live?.mode === 'startOver'; }

/**
 * mpv's demuxer cache for a plan, set before its loadfile. On-demand keeps 400 MiB ahead and 100 MiB
 * behind. Live has a smaller budget of 320 MiB in all: 192 MiB ahead and 128 MiB behind. At the edge
 * little is ahead, and mpv's buffer donation lets the back buffer use the unused forward part, so the
 * timeshift window mpv can seek in (`demuxer-cache-state` seekable-ranges) reaches about 5 minutes at
 * 8 Mbit/s, 10 at 4 Mbit/s. The forward part is how far a pause or a rewind can fall behind while mpv
 * keeps reading the stream (about 3 minutes at 8 Mbit/s); past that the reader waits, and a server
 * whose playlist dropped those segments meanwhile continues from its oldest one. Start over reads its EVENT playlist from its first segment
 * (FFmpeg otherwise joins three segments from the end), so position 0 is the programme's start.
 */
const LIVE_FORWARD_BYTES = '192MiB', LIVE_BACK_BYTES = '128MiB';
function demuxerOptions(plan) {
  const live = isLive(plan);
  return [
    ['demuxer-max-bytes', live ? LIVE_FORWARD_BYTES : '400MiB'],
    ['demuxer-max-back-bytes', live ? LIVE_BACK_BYTES : '100MiB'],
    ['demuxer-lavf-o', isStartOver(plan) ? 'live_start_index=0' : ''],
  ];
}

/** How far behind the edge live normally plays: the plan's target (else 6 s), and never closer than the
 * three segments FFmpeg joins behind the newest one, or the viewer would be told of a lag that is normal. */
function liveLatency(plan, targetDuration) {
  const wanted = plan?.livePolicy?.targetLatencySeconds;
  const base = Number.isFinite(wanted) && wanted > 0 ? wanted : 6;
  return Number.isFinite(targetDuration) && targetDuration > 0 ? Math.max(base, 3 * targetDuration) : base;
}

/**
 * The live window on the axis of the reported position (mpv time-pos + the path's timeline origin):
 * { start, edge, latency, segment, source } or null while unknown. A channel's window is what mpv holds
 * and can seek in: the newest of its cached seekable ranges. Start over's starts at the programme's
 * start; its edge is the plan's, grown in real time since the plan arrived, or the cache's when newer.
 */
function liveWindow({ plan, cacheState, origin = 0, receivedAt, now, targetDuration }) {
  if (!isLive(plan)) return null;
  const latency = liveLatency(plan, targetDuration);
  const segment = Number.isFinite(targetDuration) && targetDuration > 0 ? targetDuration : 2;
  const ranges = (Array.isArray(cacheState?.['seekable-ranges']) ? cacheState['seekable-ranges'] : [])
    .filter(r => Number.isFinite(r?.start) && Number.isFinite(r?.end) && r.end >= r.start);
  const newest = ranges.reduce((best, r) => !best || r.end > best.end ? r : best, null);
  if (isStartOver(plan)) {
    const planned = Number.isFinite(plan.live.liveEdgeSeconds) ? plan.live.liveEdgeSeconds + Math.max(0, now - receivedAt) / 1000 : null;
    const cached = newest ? newest.end + origin : null;
    if (planned === null && cached === null) return null;
    const server = cached === null || (planned !== null && planned >= cached);
    const start = Number.isFinite(plan.live.windowStartSeconds) ? plan.live.windowStartSeconds : 0;
    return { start, edge: server ? planned : cached, latency, segment, source: server ? 'server' : 'seekable' };
  }
  if (!newest) return null;
  return { start: newest.start + origin, edge: newest.end + origin, latency, segment, source: 'seekable' };
}

/** Seconds playback trails its usual live position, or null when that cannot be told (no edge, or a
 * position before the window: where the player is about to be put). */
function liveLag(window, position) {
  if (window?.edge == null || !Number.isFinite(position)) return null;
  if (window.start != null && position < window.start - 1) return null;
  return Math.max(0, window.edge - window.latency - position);
}
/** Behind live enough to tell the viewer: at least 10 s (or two segments), held until back within 3 s. */
function behindLive(lag, wasBehind, segment) {
  if (lag === null) return false;
  return wasBehind ? lag > 3 : lag >= Math.max(10, 2 * segment);
}
/** Where catching up lands: the edge less the latency, inside the window; null when not ahead of `position`. */
function catchUpTarget(window, position) {
  if (window?.edge == null) return null;
  let target = window.edge - window.latency;
  if (window.start != null) {
    if (window.edge - window.start < 0.25) return null;
    target = Math.max(window.start + 0.05, target);
  }
  return target > position + 0.25 ? Math.min(target, window.edge - 0.1) : null;
}
/** A seek target held inside the window, a second short of the edge; null without a window to seek in. */
function clampLiveSeek(window, seconds) {
  if (!Number.isFinite(seconds) || window?.start == null || window?.edge == null || window.edge < window.start) return null;
  return Math.min(Math.max(seconds, window.start), Math.max(window.start, window.edge - 1));
}
/** Where a paused live stream resumes when the window slid past its position: a little inside its start. */
function resumeTarget(window, position) {
  if (window?.start == null || window?.edge == null || !(position < window.start)) return null;
  return window.start + Math.min(5, Math.max(0, window.edge - 1 - window.start));
}
/** The snapshot's model.ts LiveSnapshot, and the behind-live verdict to hold for the next one. */
function liveSnapshot(window, position, wasBehind, reconnecting) {
  const lag = window ? liveLag(window, position) : null;
  const behind = !!window && behindLive(lag, wasBehind, window.segment) && catchUpTarget(window, position) !== null;
  return { behind, live: { edgeSeconds: window?.edge ?? null, windowStartSeconds: window?.start ?? null, driftSeconds: behind ? lag : 0,
    edgeSource: window?.source ?? null, reconnecting, delivery: window?.edge != null && !reconnecting ? 'available' : 'unknown', canCatchUp: behind } };
}
Object.assign(module.exports, { isLive, isStartOver, demuxerOptions, liveLatency, liveWindow, liveLag, behindLive, catchUpTarget, clampLiveSeek, resumeTarget, liveSnapshot });

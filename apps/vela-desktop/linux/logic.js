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

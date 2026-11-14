import { originalPlaybackCapabilities } from './universal/loader';
/** Browser-declared format support, not a hardware or real-time decode promise. */
export async function mediaCapabilities(signal: AbortSignal) {
  try { localStorage.removeItem('vela.player.beta'); } catch {}
  const video = document.createElement('video');
  const supports = (mime: string) => video.canPlayType(mime) !== '';
  const MS = (globalThis as typeof globalThis & { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource ?? globalThis.MediaSource;
  const videoFormats = [
    ['h264', 'video/mp4; codecs="avc1.42E01E"'], ['hevc', 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
    ['vp9', 'video/webm; codecs="vp9"'], ['av1', 'video/mp4; codecs="av01.0.05M.08"'],
  ];
  const audioFormats = [['aac', 'audio/mp4; codecs="mp4a.40.2"'], ['opus', 'audio/webm; codecs="opus"'], ['ac3', 'audio/mp4; codecs="ac-3"'], ['eac3', 'audio/mp4; codecs="ec-3"']];
  const originalPlayback = await originalPlaybackCapabilities(signal).catch(() => null);
  return {
    ...(originalPlayback ? {originalPlayback} : {}),
    containers: [supports('video/mp4') ? 'mp4' : '', supports('video/webm') ? 'webm' : ''].filter(Boolean),
    videoCodecs: videoFormats.filter(([name,mime]) => name === 'h264' && supports(mime)).map(([name]) => name),
    audioCodecs: audioFormats.filter(([, mime]) => supports(mime)).map(([name]) => name),
    subtitleFormats: typeof VTTCue === 'function' ? ['webvtt'] : [],
    hls: supports('application/vnd.apple.mpegurl'),
    mse: !!MS && videoFormats.some(([, mime]) => MS.isTypeSupported(mime)),
  };
}

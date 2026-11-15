import {abortable} from './core/async';
import {playbackMark} from './timing';
import { originalPlaybackCapabilities,subtitleCapabilities,capabilityIdentity } from './universal/loader';
/** Browser-declared format support, not a hardware or real-time decode promise. */
let cached:{identity:string;pending:Promise<Awaited<ReturnType<typeof probe>>>}|undefined;
/** Root mount runs this ahead of Play; a view remount reuses the immutable result. */
export async function mediaCapabilities(signal:AbortSignal){
  const identity=capabilityIdentity();
  if(!cached||cached.identity!==identity){
    const current={identity,pending:Promise.resolve(null as unknown as Awaited<ReturnType<typeof probe>>)};
    playbackMark('probe:start');
    current.pending=probe(AbortSignal.timeout(12000)).then(value=>{playbackMark('probe:ready');return value;}).catch(error=>{if(cached===current)cached=undefined;throw error;});
    cached=current;void current.pending.catch(()=>{});
  }else playbackMark('probe:cached');
  return structuredClone(await abortable(cached.pending,signal));
}
async function probe(signal:AbortSignal){
  try { localStorage.removeItem('vela.player.beta'); } catch {}
  const video = document.createElement('video');
  const supports = (mime: string) => video.canPlayType(mime) !== '';
  const MS = (globalThis as typeof globalThis & { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource ?? globalThis.MediaSource;
  const videoFormats = [
    ['h264', 'video/mp4; codecs="avc1.42E01E"'], ['hevc', 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
    ['vp9', 'video/webm; codecs="vp9"'], ['av1', 'video/mp4; codecs="av01.0.05M.08"'],
  ];
  const audioFormats = [['aac', 'audio/mp4; codecs="mp4a.40.2"'], ['opus', 'audio/webm; codecs="opus"'], ['ac3', 'audio/mp4; codecs="ac-3"'], ['eac3', 'audio/mp4; codecs="ec-3"']];
  const [originalPlayback,availableSubtitles]=await Promise.all([originalPlaybackCapabilities(signal).catch(()=>null),subtitleCapabilities(signal,true).catch(()=>[])]);
  const subtitles=originalPlayback?availableSubtitles:availableSubtitles.filter(format=>['webvtt','ether-vtt-window'].includes(format));
  return {
    ...(originalPlayback ? {originalPlayback} : {}),
    containers: [supports('video/mp4') ? 'mp4' : '', supports('video/webm') ? 'webm' : ''].filter(Boolean),
    videoCodecs: videoFormats.filter(([name,mime]) => name === 'h264' && supports(mime)).map(([name]) => name),
    audioCodecs: audioFormats.filter(([, mime]) => supports(mime)).map(([name]) => name),
    subtitleFormats:[...new Set([...(typeof VTTCue==='function'?['webvtt']:[]),...subtitles])],
    hls: supports('application/vnd.apple.mpegurl'),
    mse: !!MS && videoFormats.some(([, mime]) => MS.isTypeSupported(mime)),
  };
}

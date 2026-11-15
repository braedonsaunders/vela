/** Trusted host-only hero trailer. No playback session or observation telemetry. */
import {MediaAccess} from './media-auth';
export interface PreviewHandle {
  media:MediaAccess;requestAbort:AbortController;sourceURL:string;
  preview: true; video: HTMLVideoElement; props: Record<string, string>;
  observer: IntersectionObserver; visible: boolean; disposed: boolean; generation: number;
  expiryTimer?: ReturnType<typeof setTimeout>; visibilityChanged: () => void;
  event: (kind: number, payload: string) => void;
}
function apply(handle: PreviewHandle) {
  const video = handle.video;
  if (handle.expiryTimer) clearTimeout(handle.expiryTimer);
  const remaining = Number(handle.props.expiresAt) - Date.now();
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const allowed = handle.props.active === 'true' && handle.props.still !== 'true' && !connection?.saveData && handle.visible && document.visibilityState === 'visible' && Number.isFinite(remaining) && remaining > 0;
  if (!allowed || !handle.props.url) {
    handle.generation++;handle.requestAbort.abort();handle.requestAbort=new AbortController();handle.sourceURL=''; video.pause(); video.style.opacity = '0';
    if (video.hasAttribute('src')) { video.removeAttribute('src'); video.load(); handle.event(8, 'paused'); }
    return;
  }
  handle.expiryTimer = setTimeout(() => apply(handle), Math.min(remaining + 1, 2147483647));
  const url = new URL(handle.props.url, document.baseURI).href;
  if (handle.sourceURL === url) return;
  handle.requestAbort.abort();handle.requestAbort=new AbortController();handle.sourceURL=url;
  const generation = ++handle.generation;
  void handle.media.nativeURL(url,handle.requestAbort.signal).then(attached=>{
    if(handle.disposed||handle.generation!==generation)return;video.src=attached;return video.play();
  }).catch(() => {if (!handle.disposed && handle.generation === generation) { video.style.opacity = '0';handle.sourceURL=''; handle.event(8, 'refused'); }});
}
export function createPreview(element: HTMLElement, json: string, event: PreviewHandle['event']): PreviewHandle {
  const video = document.createElement('video'); video.muted = true; video.loop = true; video.playsInline = true; video.controls = false; video.preload = 'none';
  video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;pointer-events:none';
  const handle: PreviewHandle = { media:new MediaAccess(request=>event(8,JSON.stringify(request))),requestAbort:new AbortController(),sourceURL:'',preview: true, video, props: {}, event, visible: false, disposed: false, generation: 0, visibilityChanged: () => {}, observer: undefined! };
  video.addEventListener('canplay', () => { if (!handle.disposed && video.hasAttribute('src')) event(8, 'ready'); });
  video.addEventListener('playing', () => {
    if (handle.disposed || handle.props.active !== 'true' || !handle.visible || !video.hasAttribute('src')) return;
    video.style.opacity = '1'; event(8, 'playing');
  });
  video.addEventListener('error', () => { if (!handle.disposed && video.hasAttribute('src')) { video.style.opacity = '0'; event(8, 'refused'); } });
  handle.visibilityChanged = () => apply(handle); document.addEventListener('visibilitychange', handle.visibilityChanged);
  element.replaceChildren(video);
  handle.observer = new IntersectionObserver(entries => { handle.visible = entries.some(e => e.isIntersecting); apply(handle); });
  handle.observer.observe(element);
  try{setPreview(handle,json);}catch(error){destroyPreview(handle);throw error;}return handle;
}
export function setPreview(handle: PreviewHandle, json: string) {
  const props = JSON.parse(json) as Record<string, string>;
  try{if(handle.media.update(props.mediaAuth??'')){handle.generation++;handle.sourceURL='';handle.requestAbort.abort();handle.video.pause();handle.video.removeAttribute('src');handle.video.load();}}
  catch(error){handle.generation++;handle.requestAbort.abort();handle.video.pause();handle.video.removeAttribute('src');handle.video.load();throw error;}
  handle.media.accept(props.nativeMedia??'');
  if (props.url && !['http:', 'https:'].includes(new URL(props.url, document.baseURI).protocol)) throw new Error('Unsupported preview URL protocol');
  handle.props = props; handle.video.style.transition = props.still === 'true' ? 'none' : 'opacity 360ms ease'; apply(handle);
}
export function destroyPreview(handle: PreviewHandle) {
  if (handle.expiryTimer) clearTimeout(handle.expiryTimer); document.removeEventListener('visibilitychange', handle.visibilityChanged);
  handle.disposed = true; handle.generation++; handle.observer.disconnect(); handle.video.pause(); handle.video.removeAttribute('src'); handle.video.load(); handle.video.remove();
  handle.requestAbort.abort();handle.media.dispose();handle.sourceURL='';handle.props={};
}

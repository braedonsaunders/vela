import type { HostContext } from './state';

const heldPictures = new WeakMap<HostContext, () => void>();

export function releaseSeekPicture(context: HostContext): void {
  heldPictures.get(context)?.();
}

export function holdSeekPicture(context: HostContext): void {
  releaseSeekPicture(context);
  const video = context.surface.video;
  const parent = video.parentElement;
  if (!parent) return;
  const rendered = context.media.runtime ? parent.querySelector('canvas') : null;
  const source = rendered ?? video;
  const width = rendered?.width ?? video.videoWidth;
  const height = rendered?.height ?? video.videoHeight;
  if (!width || !height || (!rendered && video.readyState < 2)) return;
  const picture = document.createElement('canvas');
  picture.width = width;
  picture.height = height;
  try { picture.getContext('2d')?.drawImage(source, 0, 0); } catch { return; }
  Object.assign(picture.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    objectFit: video.style.objectFit || 'contain', pointerEvents: 'none', zIndex: '1',
  });
  parent.append(picture);
  const firstFrame = () => {
    if (!context.media.runtime && video.readyState >= 2 && !video.seeking) release();
  };
  const release = () => {
    clearTimeout(timeout);
    picture.remove();
    video.removeEventListener('loadeddata', firstFrame);
    video.removeEventListener('seeked', firstFrame);
    heldPictures.delete(context);
  };
  const timeout = setTimeout(release, 12_000);
  heldPictures.set(context, release);
  video.addEventListener('loadeddata', firstFrame);
  video.addEventListener('seeked', firstFrame);
}

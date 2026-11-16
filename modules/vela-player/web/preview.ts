// A trailer preview on the web (docs/architecture.md): a muted <video> in the view's DOM
// node. It plays only while active, on screen, with the page visible, without save-data and before
// the grant expires; otherwise the element drops its source, which releases the decoder. It never
// retries an expired grant. Commands are limited to play and pause.
import type { Command, Failure, MediaAccess, PreviewSource, Snapshot } from '@vela/player-api';
import { parseMediaAuthorization, permittedMediaURL } from './engine/media-auth';
import { previewSnapshot, type PreviewState } from './preview-snapshot';

export interface PreviewProps {
  preview: PreviewSource;
  active?: boolean;
  command?: Command;
  onSnapshot?: (snapshot: Snapshot) => void;
  onError?: (failure: Failure) => void;
}

export interface WebPreview {
  update(props: PreviewProps): void;
  dispose(): void;
}

function previewVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.controls = false;
  video.preload = 'none';
  video.tabIndex = -1;
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none';
  return video;
}

function saveData(): boolean {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

/** The URL the element may load: inside the access scope; with headers, only through its native URL. */
async function attachableURL(source: PreviewSource, access: MediaAccess | null): Promise<string> {
  const base = access?.origin ?? location.href;
  if (!access) return permittedMediaURL(new URL(source.url, base)).href;
  const scope = parseMediaAuthorization(
    JSON.stringify({ handle: 'preview', origin: access.origin, pathPrefix: access.pathPrefix, headers: {} }),
  );
  const url = permittedMediaURL(new URL(source.url, base), scope);
  const headers = await access.headers();
  if (Object.keys(headers).length === 0) return url.href;
  if (!access.nativeURL) throw new Error('This server needs credentials a preview element cannot send');
  return access.nativeURL(url.href);
}

export function createWebPreview(
  element: HTMLElement,
  initial: PreviewProps,
  access: () => MediaAccess | null,
): WebPreview {
  let props = initial;
  let visible = false;
  let disposed = false;
  let loaded = '';
  let generation = 0;
  let state: PreviewState | null = null;
  let scope = access();
  let lastCommand = -1;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const video = previewVideo();
  element.append(video);

  const report = (next: PreviewState) => {
    if (next === state) return;
    state = next;
    props.onSnapshot?.(previewSnapshot(state));
  };

  const release = () => {
    generation++;
    loaded = '';
    state = null;
    video.pause();
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
  };

  const fail = (message: string) => {
    release();
    report('failed');
    props.onError?.({ kind: 'source', message, recoverable: false });
  };

  const apply = () => {
    if (disposed) return;
    clearTimeout(expiry);
    const remaining = Date.parse(props.preview.expiresAt) - Date.now();
    const allowed =
      props.active !== false && visible && document.visibilityState === 'visible' && !saveData() && remaining > 0;
    video.loop = props.preview.loop === true;
    if (!allowed) {
      release();
      return;
    }
    expiry = setTimeout(apply, Math.min(remaining + 1, 2_147_483_647));
    const key = `${props.preview.url}\n${props.preview.expiresAt}`;
    if (loaded === key && scope === access()) return;
    scope = access();
    release();
    loaded = key;
    const current = ++generation;
    report('loading');
    attachableURL(props.preview, access())
      .then((url) => {
        if (disposed || current !== generation) return;
        video.src = url;
        return video.play();
      })
      .catch((error: unknown) => {
        if (disposed || current !== generation) return;
        fail(error instanceof Error ? error.message : 'The preview could not start');
      });
  };

  const applyCommand = (command: Command | undefined) => {
    if (!command || command.id <= lastCommand) return;
    lastCommand = command.id;
    if (command.type === 'pause') video.pause();
    else if (command.type === 'play' && video.hasAttribute('src')) void video.play().catch(() => {});
  };

  video.addEventListener('playing', () => report('playing'));
  video.addEventListener('ended', () => report('ended'));
  video.addEventListener('error', () => {
    if (video.hasAttribute('src')) fail('The preview source failed');
  });
  const observer = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    apply();
  });
  observer.observe(element);
  document.addEventListener('visibilitychange', apply);
  applyCommand(props.command);

  return {
    update(next) {
      if (disposed) return;
      props = next;
      apply();
      applyCommand(next.command);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(expiry);
      observer.disconnect();
      document.removeEventListener('visibilitychange', apply);
      release();
      video.remove();
    },
  };
}

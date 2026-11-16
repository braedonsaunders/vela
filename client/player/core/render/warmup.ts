import type { OriginalRuntimeOptions } from '../../universal/loader';
import { VideoPackages } from '../../universal/video/packages';
import { CoreVideoPresenter } from './video-presenter';

type Surface = OriginalRuntimeOptions['surface'];
type Assets = OriginalRuntimeOptions['assets'];
interface Resources {
  key: string;
  presenter: CoreVideoPresenter;
  packages: VideoPackages;
  abort: AbortController;
  ready: Promise<void>;
  settled: boolean;
  claimed: boolean;
  healthy: boolean;
  warmAttempted: boolean;
  warmed: boolean;
  timer?: ReturnType<typeof setTimeout>;
  detach?: () => void;
}
let idle: Resources | undefined;
let active = 0;
const emptySurface = (): Surface => ({
  container: document.createElement('div'),
  video: document.createElement('video'),
});
function retire(value: Resources) {
  if (idle === value) idle = undefined;
  clearTimeout(value.timer);
  value.detach?.();
  value.abort.abort();
  value.presenter.dispose();
}
function keep(value: Resources) {
  if (document.hidden || !value.healthy || value.abort.signal.aborted || (idle && idle !== value)) {
    retire(value);
    return;
  }
  value.presenter.park();
  value.claimed = false;
  idle = value;
  value.timer = setTimeout(() => {
    if (idle === value) retire(value);
  }, 120000);
}
function create(assets: Assets): Resources {
  const abort = new AbortController();
  const value: Resources = {
    key: assets.assetKey,
    abort,
    presenter: new CoreVideoPresenter(emptySurface(), () => {
      value.healthy = false;
    }),
    packages: new VideoPackages(assets.videoDecoderURL),
    ready: Promise.resolve(),
    settled: false,
    claimed: false,
    healthy: true,
    warmAttempted: false,
    warmed: false,
  };
  return value;
}
/** One idle device, with bounded package/pipeline caches and no media source. */
export async function prewarmCoreVideo(assets: Assets, signal: AbortSignal): Promise<boolean | undefined> {
  if (
    active ||
    document.hidden ||
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ||
    signal.aborted
  )
    return undefined;
  if (idle && (!idle.healthy || idle.abort.signal.aborted || idle.key !== assets.assetKey)) retire(idle);
  if (idle && (idle.warmAttempted || !idle.settled)) {
    const current = idle;
    await current.ready;
    return current.warmed;
  }
  const value = idle ?? create(assets);
  idle = value;
  value.settled = false;
  value.warmAttempted = true;
  value.detach?.();
  const cancel = () => {
    if (!value.claimed) retire(value);
  };
  signal.addEventListener('abort', cancel, { once: true });
  value.detach = () => signal.removeEventListener('abort', cancel);
  value.ready = value.presenter
    .prewarm(
      value.packages,
      AbortSignal.any([value.abort.signal, AbortSignal.timeout(15000)]),
      () => value.claimed,
    )
    .then((complete) => {
      value.warmed = complete;
      if (!complete && value.claimed) value.warmAttempted = false;
    })
    .catch(() => {
      value.warmed = false;
      if (!value.abort.signal.aborted) {
        value.presenter.reset();
        value.healthy = true;
      }
    })
    .then(() => {
      value.settled = true;
      if (!value.claimed && !value.abort.signal.aborted) keep(value);
    });
  await value.ready;
  return value.claimed ? undefined : value.warmed;
}
export function acquireCoreVideo(assets: Assets, surface: Surface, onFailure: (error: Error) => void) {
  if (idle && (!idle.healthy || idle.abort.signal.aborted)) retire(idle);
  let value = idle?.key === assets.assetKey ? idle : undefined;
  if (value) {
    idle = undefined;
    clearTimeout(value.timer);
    value.detach?.();
    value.detach = undefined;
  } else {
    value = create(assets);
    value.settled = true;
  }
  const owned = value;
  owned.claimed = true;
  active++;
  let released = false;
  const ready = owned.ready.then(() => {
    if (released || owned.abort.signal.aborted) throw new DOMException('Warm renderer retired', 'AbortError');
    owned.presenter.bind(surface, (error) => {
      owned.healthy = false;
      onFailure(error);
    });
  });
  void ready.catch(() => {});
  return {
    presenter: owned.presenter,
    packages: owned.packages,
    ready,
    release() {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      if (!owned.settled) retire(owned);
      else keep(owned);
    },
  };
}
function retireIdle() {
  if (idle) retire(idle);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', retireIdle);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) retireIdle();
  });
}

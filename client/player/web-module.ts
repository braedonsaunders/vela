import {
  createBrowserPlayerView,
  updateBrowserPlayerView,
  disposeBrowserPlayerView,
  type BrowserPlayerView,
} from './browser-view';
import { mountPlaybackTiming } from './timing';
import { mediaCapabilities } from './media-capabilities';
import { mountCoreWarmup } from './universal/loader';
import { createInstall, type InstallHandle } from './install';
import { createPreview, setPreview, destroyPreview, type PreviewHandle } from './preview';
import { createTheme, setTheme, destroyTheme, type ThemeHandle } from './theme';
import { createEngine, setEngine, destroyEngine, type EngineHandle } from './engine-handoff';
export const abi = 1;
export const roster = {
  'vela-player': { snapshot: false },
  'vela-context': { snapshot: false },
  'vela-preview': { snapshot: false },
  'vela-install': { snapshot: false },
  'vela-theme': { snapshot: false },
  'vela-engine': { snapshot: false },
};
interface ContextHandle {
  releaseTiming?: () => void;
  releaseWarmup?: () => void;
  context: true;
  disposed: boolean;
  lastNavigation: string;
  probe: string;
  revision: number;
  abort: AbortController;
  event: (kind: number, payload: string) => void;
}
export function create(
  tag: string,
  element: HTMLElement,
  json: string,
  event: (kind: number, payload: string) => void,
): BrowserPlayerView | ContextHandle | PreviewHandle | InstallHandle | ThemeHandle | EngineHandle {
  if (tag === 'vela-engine') return createEngine(json);
  if (tag === 'vela-theme') return createTheme(json);
  if (tag === 'vela-install') return createInstall(element, json, event);
  if (tag === 'vela-preview') return createPreview(element, json, event);
  if (tag === 'vela-context') {
    const handle: ContextHandle = {
      context: true,
      disposed: false,
      lastNavigation: '',
      probe: '',
      revision: 0,
      abort: new AbortController(),
      event,
    };
    const props = JSON.parse(json) as Record<string, string>;
    handle.probe = props.probe ?? '';
    if (handle.probe === 'media') {
      handle.releaseTiming = mountPlaybackTiming();
      handle.releaseWarmup = mountCoreWarmup(handle.abort.signal);
    }
    navigateSecurely(handle, props);
    queueMicrotask(() => {
      void publishContext(handle);
    });
    return handle;
  }
  if (tag !== 'vela-player') throw new Error(`Unknown player view: ${tag}`);
  return createBrowserPlayerView(element, json, event);
}
export function setProps(
  handle: BrowserPlayerView | ContextHandle | PreviewHandle | InstallHandle | ThemeHandle | EngineHandle,
  json: string,
) {
  if ('leaving' in handle) {
    setEngine(handle, json);
    return;
  }
  if ('theme' in handle) {
    setTheme(handle, json);
    return;
  }
  if ('install' in handle) {
    handle.update(json);
    return;
  }
  if ('preview' in handle) {
    setPreview(handle, json);
    return;
  }
  if ('context' in handle) {
    navigateSecurely(handle, JSON.parse(json) as Record<string, string>);
    return;
  }
  updateBrowserPlayerView(handle, json);
}
export function destroy(
  handle: BrowserPlayerView | ContextHandle | PreviewHandle | InstallHandle | ThemeHandle | EngineHandle,
) {
  if ('leaving' in handle) {
    destroyEngine(handle);
    return;
  }
  if ('theme' in handle) {
    destroyTheme(handle);
    return;
  }
  if ('install' in handle) {
    handle.dispose();
    return;
  }
  if ('preview' in handle) {
    destroyPreview(handle);
    return;
  }
  if ('context' in handle) {
    handle.disposed = true;
    handle.abort.abort();
    handle.releaseTiming?.();
    handle.releaseWarmup?.();
    return;
  }
  disposeBrowserPlayerView(handle);
}
/** The data realm issues the one-time code and validates the server identity;
 * the host enforces the advertised HTTPS destination and never logs the code. */
function navigateSecurely(handle: ContextHandle, props: Record<string, string>) {
  const target = props.secureNavigate;
  if (!target || handle.disposed || target === handle.lastNavigation) return;
  try {
    if (target.length > 8192) throw new Error('Invalid secure handoff');
    const url = new URL(target);
    const allowed = JSON.parse(props.secureOrigins || '[]') as unknown;
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !['/vela', '/vela/'].includes(url.pathname) ||
      !Array.isArray(allowed) ||
      !allowed.some((origin) => typeof origin === 'string' && origin === url.origin)
    )
      throw new Error('Invalid secure handoff');
    handle.lastNavigation = target;
    queueMicrotask(() => {
      if (!handle.disposed) location.replace(url.href);
    });
  } catch {
    handle.event(8, JSON.stringify({ secureNavigation: 'rejected' }));
  }
}
async function publishContext(handle: ContextHandle) {
  const revision = ++handle.revision;
  try {
    const payload =
      handle.probe === 'media'
        ? JSON.stringify(await mediaCapabilities(handle.abort.signal))
        : handle.probe === 'network'
          ? JSON.stringify({
              saveData:
                (
                  navigator as Navigator & {
                    connection?: {
                      saveData?: boolean;
                    };
                  }
                ).connection?.saveData === true,
            })
          : location.origin;
    if (!handle.disposed && revision === handle.revision) handle.event(8, payload);
  } catch {
    /* Destroyed/superseded probes do not publish stale capabilities. */
  }
}

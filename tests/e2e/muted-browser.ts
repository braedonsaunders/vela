import { surfaceOf, web } from '@e2e-dev/web';

const surfaces = new Set<NonNullable<ReturnType<typeof surfaceOf>>>();

/** Use Playwright for context-wide controls the e2e browser fixture doesn't expose. */
export function runningBrowserPage(origin: string) {
  for (const surface of surfaces) {
    try {
      if (new URL(surface.page().url()).origin === origin) return surface.page();
    } catch {
      // This engine has no active page in the current worker.
    }
  }
  throw new Error('No active browser context for the mock app');
}

export function mutePageMedia() {
  const media = HTMLMediaElement.prototype;
  const muted = Object.getOwnPropertyDescriptor(media, 'muted');
  const volume = Object.getOwnPropertyDescriptor(media, 'volume');
  Object.defineProperty(media, 'muted', {
    configurable: true,
    get() { return true; },
    set() { muted?.set?.call(this, true); },
  });
  Object.defineProperty(media, 'volume', {
    configurable: true,
    get() { return 0; },
    set() { volume?.set?.call(this, 0); },
  });
}

export function mutedBrowser(browser: 'chromium' | 'webkit', options: { allowSoftwareVisualizer?: boolean } = {}) {
  const engine = web({
    browser,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    // The e2e runner disables service workers whenever it injects headers.
    // The mock proxy supplies the same headers while keeping the worker enabled.
    ...(options.allowSoftwareVisualizer ? { locale: 'en-US' } : {
      headers: { 'X-Vela-Language': 'en', 'X-Vela-Screen-Renderer': '19' },
    }),
    initScripts: [mutePageMedia, ...(options.allowSoftwareVisualizer ? [() => {
      // Headless CI exposes WebGL through a software adapter. Exercise the actual scene renderer,
      // picker, persistence and fallback, but do not treat its frame timings as production data.
      const getContext = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        writable: true,
        value(this: HTMLCanvasElement, id: string, attributes?: WebGLContextAttributes) {
          return getContext.call(this, id, id === 'webgl2'
            ? { ...attributes, failIfMajorPerformanceCaveat: false } : attributes);
        },
      });
      const context = globalThis.WebGL2RenderingContext;
      if (!context) return;
      // The visualizer uses this fence only to benchmark its first frame.
      // Keep drawing real frames without applying the device budget to a shared runner.
      context.prototype.fenceSync = () => null;
      const getParameter = context.prototype.getParameter;
      context.prototype.getParameter = function(parameter: number) {
        const debug = this.getExtension('WEBGL_debug_renderer_info');
        if (debug && parameter === debug.UNMASKED_RENDERER_WEBGL) return 'Vela e2e WebGL adapter';
        return getParameter.call(this, parameter);
      };
    }] : [])],
  });
  const surface = surfaceOf(engine);
  if (surface) surfaces.add(surface);
  return engine;
}

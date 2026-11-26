import { web } from '@e2e-dev/web';

export function mutedBrowser(browser: 'chromium' | 'webkit', options: { allowSoftwareVisualizer?: boolean } = {}) {
  return web({
    browser,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    headers: {
      'X-Vela-Language': 'en',
      'X-Vela-Screen-Renderer': '19',
    },
    initScripts: [() => {
      const media = HTMLMediaElement.prototype;
      const events: unknown[] = [];
      Object.assign(window, { velaMediaDiagnostics: events });
      const note = (event: string, video: HTMLMediaElement, error?: unknown) => {
        events.push([Math.round(performance.now()), event, video.currentTime, video.paused, video.readyState,
          navigator.userActivation?.isActive, error instanceof Error ? [error.name, error.message] : error]);
        if (events.length > 150) events.shift();
      };
      const play = media.play;
      media.play = function() {
        note('play()', this);
        const result = play.call(this);
        void result.then(() => note('resolved', this), error => note('rejected', this, error));
        return result;
      };
      const pause = media.pause;
      media.pause = function() {
        note('pause()', this);
        pause.call(this);
      };
      const createElement = document.createElement;
      document.createElement = function(...args: Parameters<typeof document.createElement>) {
        const element = createElement.apply(this, args);
        if (element instanceof HTMLVideoElement) {
          for (const name of ['loadedmetadata', 'loadeddata', 'play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended', 'error']) {
            element.addEventListener(name, () => note(name, element, element.error?.message));
          }
        }
        return element;
      } as typeof document.createElement;
      for (const name of ['keydown', 'keyup', 'pointerdown', 'click']) {
        document.addEventListener(name, event => {
          const target = (event.target as Element)?.closest('[data-testid="player-toggle"]');
          if (target) events.push([Math.round(performance.now()), name, target.getAttribute('aria-label'), navigator.userActivation?.isActive]);
        }, true);
      }
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
    }, ...(options.allowSoftwareVisualizer ? [() => {
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
}

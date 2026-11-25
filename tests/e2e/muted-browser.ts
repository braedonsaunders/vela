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
      const context = globalThis.WebGL2RenderingContext;
      if (!context) return;
      const getParameter = context.prototype.getParameter;
      context.prototype.getParameter = function(parameter: number) {
        const debug = this.getExtension('WEBGL_debug_renderer_info');
        if (debug && parameter === debug.UNMASKED_RENDERER_WEBGL) return 'Vela e2e WebGL adapter';
        return getParameter.call(this, parameter);
      };
    }] : [])],
  });
}

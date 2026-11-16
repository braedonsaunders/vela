export interface BrowserSurface {
  root: ShadowRoot;
  video: HTMLVideoElement;
  dispose(): void;
}

/** Media owns pixels; chrome and all pointer targets stay in the app. */
export function createBrowserSurface(element: HTMLElement): BrowserSurface {
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  const video = document.createElement('video');
  video.style.cssText =
    'display:block;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none';
  const surface = document.createElement('div');
  surface.style.cssText =
    'position:relative;width:100%;height:100%;isolation:isolate;z-index:0;pointer-events:none';
  // A shadow root does not isolate z-order. Contain the canvas's local z-index
  // below sibling player chrome; media owns no pointer targets or controls.
  const style = document.createElement('style');
  style.textContent =
    '.webgpuPlayerCanvas{position:absolute;display:block;z-index:1;opacity:0;pointer-events:none}' +
    '.webgpuPlayerCanvas-visible{opacity:1}';
  surface.append(video);
  root.replaceChildren(style, surface);
  return {
    root,
    video,
    dispose() {
      root.replaceChildren();
    },
  };
}

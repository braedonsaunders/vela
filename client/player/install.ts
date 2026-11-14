interface PwaState { installable: boolean; installed: boolean; updateAvailable: boolean; offline: boolean }
interface PwaRuntime { readonly state: PwaState; subscribe(fn: () => void): () => void; install(): Promise<boolean>; applyUpdate(): boolean }
export interface InstallHandle { install: true; button: HTMLButtonElement; update: (json: string) => void; dispose: () => void }
/** Native button preserves the browser's trusted gesture for install/update prompts. */
export function createInstall(element: HTMLElement, json: string, event: (kind: number, payload: string) => void): InstallHandle {
  let runtime = (window as Window & { velaPwa?: PwaRuntime }).velaPwa;
  const button = document.createElement('button'); button.type = 'button';
  button.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:20px;padding:8px 14px;cursor:pointer';
  element.replaceChildren(button);
  let disposed = false, action = 'install', label = ''; 
  const update = () => {
    if (disposed) return;
    button.hidden = action === 'update' ? !runtime?.state.updateAvailable : !runtime?.state.installable;
    // Exact's author button styles can override the UA [hidden] display rule.
    button.style.display = button.hidden ? 'none' : 'inline-block';
    button.textContent = label || (action === 'update' ? 'Update ready, reload' : 'Install Vela');
    button.setAttribute('aria-label', button.textContent);
    if (runtime) event(8, JSON.stringify(runtime.state));
  };
  const setProps = (json: string) => { const props = JSON.parse(json) as Record<string, string>; action = props.pwaAction === 'update' ? 'update' : 'install'; label = props.buttonLabel ?? ''; update(); };
  let unsubscribe = runtime?.subscribe(update);
  const appeared = () => {
    const next = (window as Window & { velaPwa?: PwaRuntime }).velaPwa;
    if (next === runtime || disposed) return;
    unsubscribe?.(); runtime = next; unsubscribe = runtime?.subscribe(update); update();
  };
  window.addEventListener('vela:pwa-state', appeared);
  const clicked = () => {
    if (!runtime) return;
    if (action === 'update') runtime.applyUpdate();
    else void runtime.install().then(() => update(), () => update());
  };
  button.addEventListener('click', clicked); setProps(json); queueMicrotask(update);
  return { install: true, button, update: setProps, dispose() { disposed = true; window.removeEventListener('vela:pwa-state', appeared); unsubscribe?.(); button.removeEventListener('click', clicked); button.remove(); } };
}

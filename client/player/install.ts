interface PwaState { installable: boolean; installed: boolean; updateAvailable: boolean; offline: boolean }
interface PwaRuntime { readonly state: PwaState; subscribe(fn: () => void): () => void; install(): Promise<boolean> }
export interface InstallHandle { install: true; button: HTMLButtonElement; dispose: () => void }
/** Native button preserves the browser's trusted gesture for the install prompt. */
export function createInstall(element: HTMLElement, event: (kind: number, payload: string) => void): InstallHandle {
  const runtime = (window as Window & { velaPwa?: PwaRuntime }).velaPwa;
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Install Vela'; button.setAttribute('aria-label', 'Install Vela');
  button.style.cssText = 'font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:20px;padding:8px 14px;cursor:pointer';
  element.replaceChildren(button);
  let disposed = false;
  const update = () => { if (!disposed) { button.hidden = !runtime?.state.installable; if (runtime) event(8, JSON.stringify(runtime.state)); } };
  const unsubscribe = runtime?.subscribe(update);
  const clicked = () => { if (runtime) void runtime.install().then(() => update(), () => update()); };
  button.addEventListener('click', clicked); queueMicrotask(update);
  return { install: true, button, dispose() { disposed = true; unsubscribe?.(); button.removeEventListener('click', clicked); button.remove(); } };
}

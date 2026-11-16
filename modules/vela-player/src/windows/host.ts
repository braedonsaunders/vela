import type { VelaPlayerProps, WebPlayerHost } from '@vela/player-api';
import { listen, send } from './bridge';
import { windowsSnapshot } from './snapshot';

let sequence = 0;

/** The native video is drawn behind the WebView: clear the backgrounds of the player's node and
 * every ancestor so the page's chrome lies over the picture, and put them back on dispose. */
function seeThrough(node: HTMLElement): () => void {
  const saved: [HTMLElement, string, string, string, string][] = [];
  for (let element: HTMLElement | null = node; element; element = element.parentElement) {
    const style = element.style;
    saved.push([element, style.getPropertyValue('background-color'), style.getPropertyPriority('background-color'),
      style.getPropertyValue('background-image'), style.getPropertyPriority('background-image')]);
    style.setProperty('background-color', 'transparent', 'important');
    style.setProperty('background-image', 'none', 'important');
  }
  return () => {
    for (const [element, color, colorPriority, image, imagePriority] of saved) {
      element.style.setProperty('background-color', color, colorPriority);
      element.style.setProperty('background-image', image, imagePriority);
    }
  };
}

/** Fullscreen is the page's: the host fills the screen while the document holds a fullscreen element. */
function toggleFullscreen() {
  const done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  void done.catch(() => { /* Refused without a user gesture; the next press tries again. */ });
}

function serializable(props: VelaPlayerProps) {
  const command = props.command?.type === 'fullscreen' ? undefined : props.command;
  return { plan: props.plan, command, active: props.active, metadata: props.metadata, serverError: props.serverError };
}
export function createWindowsPlayerHost(node: HTMLElement, initial: VelaPlayerProps): WebPlayerHost {
  const id = `windows-player-${++sequence}`;
  let props = initial;
  const restore = seeThrough(node);
  let fullscreenId = initial.command?.type === 'fullscreen' ? initial.command.id : 0;
  const unsubscribe = listen(message => {
    if (message.kind !== 'event' || message.id !== id) return;
    switch (message.event) {
      case 'snapshot': props.onSnapshot?.(windowsSnapshot(message.value, props)); break;
      case 'error': props.onError?.(message.value as Parameters<NonNullable<VelaPlayerProps['onError']>>[0]); break;
      case 'command': props.onCommand?.(message.value as Parameters<NonNullable<VelaPlayerProps['onCommand']>>[0]); break;
      case 'observation': props.onObservation?.(message.value as Parameters<NonNullable<VelaPlayerProps['onObservation']>>[0]); break;
      case 'session-command': props.onSessionCommand?.(message.value as Parameters<NonNullable<VelaPlayerProps['onSessionCommand']>>[0]); break;
      case 'session-refresh': props.onSessionRefresh?.(message.value as Parameters<NonNullable<VelaPlayerProps['onSessionRefresh']>>[0]); break;
      case 'close': if (window.history.length > 1) window.history.back(); else window.location.assign('/vela'); break;
    }
  });
  send({ kind: 'mount', id, props: serializable(props) });
  return {
    update(next) {
      props = next;
      if (next.command?.type === 'fullscreen' && next.command.id > fullscreenId) {
        fullscreenId = next.command.id;
        toggleFullscreen();
      }
      send({ kind: 'update', id, props: serializable(props) });
    },
    dispose() {
      unsubscribe();
      restore();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      send({ kind: 'dispose', id });
    },
  };
}

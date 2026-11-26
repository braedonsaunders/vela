import type { VelaPlayerProps, WebPlayerHost } from '@vela/player-api';
import { readSubtitlePreferences, updateSubtitlePreference } from '../../web/engine/universal/subtitles/preferences';
import type { SubtitlePreferences } from '../../web/engine/universal/subtitles/types';
import { desktopMediaAuthorization, isDesktopNativeHost, listen, send } from './bridge';
import { snapshotMatchesPlan, windowsSnapshot } from './snapshot';

let sequence = 0;

/** The native video is drawn behind the WebView: clear the backgrounds of the player's node and
 * every ancestor so the page's chrome lies over the picture, and put them back on dispose. */
function seeThrough(node: HTMLElement): () => void {
  const saved: [HTMLElement, string, string, string, string][] = [];
  const backdrop = document.createElement('style');
  backdrop.textContent = ':fullscreen::backdrop { background: transparent !important; }';
  document.head.appendChild(backdrop);
  for (let element: HTMLElement | null = node; element; element = element.parentElement) {
    const style = element.style;
    saved.push([element, style.getPropertyValue('background-color'), style.getPropertyPriority('background-color'),
      style.getPropertyValue('background-image'), style.getPropertyPriority('background-image')]);
    style.setProperty('background-color', 'transparent', 'important');
    style.setProperty('background-image', 'none', 'important');
  }
  return () => {
    backdrop.remove();
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

/** Subtitle appearance is the page's preference (shared with the browser engine); libmpv draws it. */
function serializable(props: VelaPlayerProps, subtitles: SubtitlePreferences) {
  const command = props.command?.type === 'fullscreen' || props.command?.type === 'subtitleStyle' ? undefined : props.command;
  return { plan: props.plan ?? null, command, active: props.active, metadata: props.metadata, serverError: props.serverError, subtitleAppearance: subtitles };
}
export function createWindowsPlayerHost(node: HTMLElement, initial: VelaPlayerProps, fallback?: (props: VelaPlayerProps) => WebPlayerHost): WebPlayerHost {
  const id = `windows-player-${++sequence}`;
  let props = initial;
  let subtitles = readSubtitlePreferences();
  let styleId = 0;
  const restore = seeThrough(node);
  let browser: WebPlayerHost | undefined;
  let revision = 0;
  const publishCaptionInsets = () => {
    const { width, height } = node.getBoundingClientRect();
    if (!width || !height) return;
    const insets = props.captionInsets;
    // mpv's text margins are symmetric, in units of a 720px reference height.
    // Align toward the unoccluded side when the column is narrower on one edge.
    const left = insets?.left ?? 0, right = insets?.right ?? 0;
    const margin = Math.min(width * 0.46, Math.max(left, right)) * 720 / height;
    send({ kind: 'caption-insets', id, insets: insets ?? {}, mpv: {
      align: right > left ? 'left' : left > right ? 'right' : 'center',
      margin: Math.max(19, Math.ceil(margin)),
      lift: Math.min(100, (insets?.bottom ?? 0) * 100 / height),
    } });
  };
  const publish = (kind: 'mount' | 'update') => {
    const version = ++revision;
    const next = props;
    if (!isDesktopNativeHost()) {
      send({ kind, id, props: serializable(next, subtitles) });
      mounted = true;
      publishCaptionInsets();
      return;
    }
    void desktopMediaAuthorization(next).then(attachment => {
      if (disposed || browser || version !== revision || !attachment) return;
      send({ kind: mounted ? 'update' : 'mount', id, props: { ...serializable(next, subtitles), ...attachment } });
      mounted = true;
      bounds();
    });
  };
  let mounted = false;
  let disposed = false;
  const bounds = () => {
    if (disposed || browser) return;
    if (isDesktopNativeHost()) {
      const rect = node.getBoundingClientRect();
      send({ kind: 'bounds', id, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scaleFactor: window.devicePixelRatio } });
    }
    if (mounted) publishCaptionInsets();
  };
  const observer = new ResizeObserver(bounds);
  observer.observe(node);
  window.addEventListener('resize', bounds);
  window.addEventListener('scroll', bounds, true);
  document.addEventListener('fullscreenchange', bounds);
  let fullscreenId = initial.command?.type === 'fullscreen' ? initial.command.id : 0;
  const unsubscribe = listen(message => {
    if (message.kind !== 'event' || message.id !== id) return;
    if (browser || disposed) return;
    switch (message.event) {
      case 'fallback':
        if (fallback) {
          send({ kind: 'dispose', id });
          restore();
          browser = fallback(props);
        }
        break;
      case 'snapshot': if (snapshotMatchesPlan(message.value, props)) props.onSnapshot?.(windowsSnapshot(message.value, props, subtitles)); break;
      case 'error': props.onError?.(message.value as Parameters<NonNullable<VelaPlayerProps['onError']>>[0]); break;
      case 'command': props.onCommand?.(message.value as Parameters<NonNullable<VelaPlayerProps['onCommand']>>[0]); break;
      case 'observation': props.onObservation?.(message.value as Parameters<NonNullable<VelaPlayerProps['onObservation']>>[0]); break;
      case 'session-command': props.onSessionCommand?.(message.value as Parameters<NonNullable<VelaPlayerProps['onSessionCommand']>>[0]); break;
      case 'session-refresh': props.onSessionRefresh?.(message.value as Parameters<NonNullable<VelaPlayerProps['onSessionRefresh']>>[0]); break;
      case 'close': if (window.history.length > 1) window.history.back(); else window.location.assign('/vela'); break;
    }
  });
  publish('mount');
  bounds();
  return {
    update(next) {
      const captionOnly = next.captionInsets !== props.captionInsets &&
        next.plan === props.plan && next.command === props.command &&
        next.active === props.active && next.serverError === props.serverError && next.metadata === props.metadata;
      props = next;
      if (browser) { browser.update(next); return; }
      if (captionOnly) { publishCaptionInsets(); return; }
      if (next.command?.type === 'fullscreen' && next.command.id > fullscreenId) {
        fullscreenId = next.command.id;
        toggleFullscreen();
      }
      const command = next.command;
      if (command?.type === 'subtitleStyle' && command.id > styleId) {
        styleId = command.id;
        try {
          subtitles = updateSubtitlePreference(subtitles, command.value);
          next.onCommand?.({ id: command.id, ok: true });
        } catch (error) {
          next.onCommand?.({ id: command.id, ok: false, failure: { kind: 'action', message: error instanceof Error ? error.message : 'Invalid subtitle style', recoverable: true } });
        }
      }
      publish('update');
    },
    dispose() {
      disposed = true;
      browser?.dispose();
      observer.disconnect();
      window.removeEventListener('resize', bounds);
      window.removeEventListener('scroll', bounds, true);
      document.removeEventListener('fullscreenchange', bounds);
      unsubscribe();
      restore();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      send({ kind: 'dispose', id });
    },
  };
}

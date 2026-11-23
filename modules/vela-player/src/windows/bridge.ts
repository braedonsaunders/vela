import type { MediaAccess, PlayerCapabilities, VelaPlayerProps } from '@vela/player-api';
import { mpvCapabilities, type MpvProbe } from './mpv-format';

type Message = { kind: string; [key: string]: unknown };
type WebView = { postMessage(message: unknown): void; addEventListener(type: 'message', listener: (event: MessageEvent) => void): void; removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void };
function transport(): WebView | undefined {
  if (typeof window === 'undefined') return;
  const host = window as unknown as { __VELA_NATIVE_PLAYER__?: WebView & { version: number }; __VELA_WINDOWS__?: { version: number }; chrome?: { webview?: WebView } };
  if (host.__VELA_NATIVE_PLAYER__?.version === 1) return host.__VELA_NATIVE_PLAYER__;
  return host.__VELA_WINDOWS__?.version === 1 ? host.chrome?.webview : undefined;
}
export const isDesktopNativeHost = () => typeof window !== 'undefined' && !!(window as unknown as { __VELA_NATIVE_PLAYER__?: unknown }).__VELA_NATIVE_PLAYER__;
export const isWindowsHost = () => !!transport();
export function send(message: Message) { transport()?.postMessage(message); }
export function listen(listener: (message: Message) => void): () => void {
  const bridge = transport();
  const receive = (event: MessageEvent) => {
    if (event.data && typeof event.data === 'object' && typeof event.data.kind === 'string') listener(event.data);
  };
  bridge?.addEventListener('message', receive);
  return () => bridge?.removeEventListener('message', receive);
}
let sequence = 0;
export function windowsCapabilities(): Promise<PlayerCapabilities> {
  const requestId = `capabilities-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Windows player capabilities timed out')); }, 10000);
    const unsubscribe = listen(message => {
      if (message.kind !== 'capabilities' || message.requestId !== requestId) return;
      clearTimeout(timer); unsubscribe();
      if (message.error) reject(new Error('Native player capabilities unavailable'));
      // A libmpv host reports what it measured (display, audio endpoint, GPU); the lists are composed here.
      else {
        const value = message.value as PlayerCapabilities & { mpv?: MpvProbe };
        resolve(value?.mpv ? mpvCapabilities(value.mpv) : value);
      }
    });
    send({ kind: 'capabilities', requestId });
  });
}
let accessRevision = 0;
let authorization: { access: MediaAccess; generation: number; ready: Promise<boolean> } | null = null;

/** Private adapter attachment; native code validates scope again before use. */
export async function desktopMediaAuthorization(props: VelaPlayerProps) {
  const current = authorization;
  const generation = accessRevision;
  const plan = props.plan;
  if (!plan) return {};
  const planId = `${plan.sessionId}:${plan.sourceGeneration}:${plan.seekGeneration}:${plan.revision}:${plan.selectedPathId}`;
  try {
    const headers = await current?.ready;
    if (generation !== accessRevision) return null;
    const path = plan.paths.find(path => path.id === plan.selectedPathId);
    if (headers && path?.transport === 'hls' && path.readiness === 'ready' && path.url) {
      if (!current?.access.nativeURL) throw new Error('Native authorization unavailable');
      const authorized = await current.access.nativeURL(path.url);
      if (generation !== accessRevision) return null;
      return { nativeMedia: { planId, source: path.url, authorized, generation }, mediaAuthorization: { planId, generation, ok: true } };
    }
    return { mediaAuthorization: { planId, generation, ok: true } };
  } catch {
    return generation === accessRevision ? { mediaAuthorization: { planId, generation, ok: false } } : null;
  }
}
export function setWindowsMediaAccess(access: MediaAccess | null): void {
  const revision = ++accessRevision;
  if (!isWindowsHost()) return;
  authorization = null;
  send({ kind: 'media-access', origin: null, pathPrefix: null, headers: {}, generation: revision });
  if (!access) return;
  const ready = access.headers().then(headers => {
    if (revision === accessRevision) send({ kind: 'media-access', origin: access.origin, pathPrefix: access.pathPrefix, headers, generation: revision });
    return Object.keys(headers).length > 0;
  });
  authorization = { access, generation: revision, ready };
  void ready.catch(() => { /* Keep native credentials revoked on failure. */ });
}

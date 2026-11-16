import type { MediaAccess, PlayerCapabilities } from '@vela/player-api';

type Message = { kind: string; [key: string]: unknown };
type WebView = { postMessage(message: unknown): void; addEventListener(type: 'message', listener: (event: MessageEvent) => void): void; removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void };
function transport(): WebView | undefined {
  if (typeof window === 'undefined') return;
  const host = window as unknown as { __VELA_WINDOWS__?: { version: number }; chrome?: { webview?: WebView } };
  return host.__VELA_WINDOWS__?.version === 1 ? host.chrome?.webview : undefined;
}
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
      clearTimeout(timer); unsubscribe(); resolve(message.value as PlayerCapabilities);
    });
    send({ kind: 'capabilities', requestId });
  });
}
let accessRevision = 0;
export function setWindowsMediaAccess(access: MediaAccess | null): void {
  const revision = ++accessRevision;
  if (!isWindowsHost()) return;
  send({ kind: 'media-access', origin: null, pathPrefix: null, headers: {} });
  if (!access) return;
  void access.headers().then(headers => {
    if (revision === accessRevision) send({ kind: 'media-access', origin: access.origin, pathPrefix: access.pathPrefix, headers });
  }).catch(() => { /* Keep the native credential scope cleared on failure. */ });
}

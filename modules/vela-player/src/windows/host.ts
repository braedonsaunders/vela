import type { VelaPlayerProps, WebPlayerHost } from '@vela/player-api';
import { listen, send } from './bridge';

let sequence = 0;
function serializable(props: VelaPlayerProps) {
  return { plan: props.plan, command: props.command, active: props.active, metadata: props.metadata, serverError: props.serverError };
}
export function createWindowsPlayerHost(_node: HTMLElement, initial: VelaPlayerProps): WebPlayerHost {
  const id = `windows-player-${++sequence}`;
  let props = initial;
  const unsubscribe = listen(message => {
    if (message.kind !== 'event' || message.id !== id) return;
    switch (message.event) {
      case 'snapshot': props.onSnapshot?.(message.value as Parameters<NonNullable<VelaPlayerProps['onSnapshot']>>[0]); break;
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
    update(next) { props = next; send({ kind: 'update', id, props: serializable(props) }); },
    dispose() { unsubscribe(); send({ kind: 'dispose', id }); },
  };
}

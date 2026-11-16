// TV remote events (react-native-tvos): the Siri Remote and Android TV D-pad. Off TV the hook
// does nothing, and the web build never reaches the TV module.
import { Platform, useTVEventHandler, type TVRemoteEvent } from 'react-native';

export type RemoteEvent = TVRemoteEvent;

const none = (_handler: (event: RemoteEvent) => void) => undefined;

/** Every remote press while the component is mounted (focus moves included). */
export const useRemote: (handler: (event: RemoteEvent) => void) => void =
  Platform.isTV && typeof useTVEventHandler === 'function' ? useTVEventHandler : none;

/** A press, not its release: tvOS and Android TV report key-down 0 and key-up 1 (or no action). */
export function pressed(event: RemoteEvent): boolean {
  return Number(event.eventKeyAction ?? -1) !== 1;
}

// TV remote events (react-native-tvos): the Siri Remote and Android TV D-pad. Off TV the hook
// does nothing, and the web build never reaches the TV module.
import { useEffect, useRef } from 'react';
import { DeviceEventEmitter, Platform, useTVEventHandler, type TVRemoteEvent } from 'react-native';

/** Android TV adds what had native focus as the press arrived (android-tv-keys.js): a testID,
 * "" for a view without one, or "none". */
export type RemoteEvent = TVRemoteEvent & { focus?: string };

const none = (_handler: (event: RemoteEvent) => void) => undefined;

function useAndroidRemote(handler: (event: RemoteEvent) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('velaAndroidTVKey', event => latest.current(event));
    return () => subscription.remove();
  }, []);
}

/** Android activity capture survives native focus consumption; tvOS uses its navigation emitter. */
export const useRemote: (handler: (event: RemoteEvent) => void) => void =
  !Platform.isTV ? none : Platform.OS === 'android' ? useAndroidRemote : useTVEventHandler;

/** A completed press, counted once. tvOS reports a button tap when it ends (key-up, 1). Android
 * TV sends key-up, and key-down (0) as well only for a long press or when key-down events are
 * turned on, so a key-down never counts. Swipes carry no key action. */
export function pressed(event: RemoteEvent): boolean {
  return Number(event.eventKeyAction ?? -1) !== 0;
}

/** The viewer touched the remote: a press or a swipe, not a focus change the app made. */
export function fromViewer(event: RemoteEvent): boolean {
  return event.eventType !== 'focus' && event.eventType !== 'blur';
}

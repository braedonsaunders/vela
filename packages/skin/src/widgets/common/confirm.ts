// A destructive confirmation that works on every client: the system alert natively (touch and
// D-pad), and the page's own dialog on the web and in the desktop shells, where React Native's
// Alert does nothing.
import { Alert, Platform } from 'react-native';

export function confirmAction(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return Promise.resolve(false);
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  return new Promise(resolve => Alert.alert(title, message || undefined, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: action, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

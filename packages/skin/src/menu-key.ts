// Back on a remote while something closable is open. Android and Android TV send Back to
// BackHandler always. tvOS sends its Menu button to the app (and so to BackHandler) only while
// the menu key is enabled; otherwise Menu leaves the screen. Each open menu, drawer or player
// menu holds the key while it is open, and the key goes back to the system when none is.
import { BackHandler, Platform, TVEventControl } from 'react-native';

let holders = 0;

/** While held, Back (Menu on tvOS) runs `onBack` first; it answers whether it handled the press. */
export function holdBack(onBack: () => boolean): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
  if (Platform.isTV && Platform.OS === 'ios' && holders++ === 0) TVEventControl?.enableTVMenuKey();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscription.remove();
    if (Platform.isTV && Platform.OS === 'ios' && --holders === 0) TVEventControl?.disableTVMenuKey();
  };
}

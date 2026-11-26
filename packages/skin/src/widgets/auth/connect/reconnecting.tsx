// The stored session could not be restored yet: the app keeps trying by itself, says why and
// when it tries next, and Retry asks the server right away. After repeated failures it also
// offers Sign in again, so a session the server cannot restore is never a dead end.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Pill, Waiting, Words } from '../../common/controls';
import type { SessionAuth } from '../signed-out';
import { offersSignInAgain, reconnectNote } from './reconnect-note';

export function Reconnecting({ name, auth, busy, onRetry, onDownloads, onSignInAgain }: { name: string; auth: SessionAuth; busy: boolean; onRetry(): void; onDownloads?(): void; onSignInAgain?(): void }) {
  const [now, setNow] = useState(Date.now);
  const counting = !!auth.retryAt && !auth.restoring && !busy;
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting, auth.retryAt]);
  const note = reconnectNote(auth, now, busy);
  return <View style={{ gap: 12 }}>
    <Waiting>{`Reconnecting to ${name}…`}</Waiting>
    {auth.error ? <Words rows={{ 'font-size': '13px', color: '$ui.inkSecondary' }}>{auth.error}</Words> : null}
    {note ? <Words rows={{ 'font-size': '13px', color: '$ui.inkQuiet' }} testID="reconnect-note">{note}</Words> : null}
    <Pill label="Retry" testID="reconnect-retry" height={44} disabled={busy} onPress={onRetry} />
    {onDownloads ? <Pill label="Open Downloads" testID="reconnect-downloads" height={44} onPress={onDownloads} /> : null}
    {onSignInAgain && offersSignInAgain(auth) ? <Pill label="Sign in again" testID="reconnect-sign-in" height={44} disabled={busy} onPress={onSignInAgain} /> : null}
  </View>;
}

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
  const centred = { textAlign: 'center' as const };
  return <View style={{ gap: 12 }}>
    {auth.viewerId ? (
      <Words rows={{ 'font-size': '16px', color: '$ui.inkSecondary' }} style={centred} testID="reconnect-note">{note || 'Your server is unavailable.'}</Words>
    ) : <>
      {auth.error ? <Words rows={{ 'font-size': '15px', color: '$ui.inkSecondary' }} style={centred}>{auth.error}</Words> : null}
      {note ? <Words rows={{ 'font-size': '14px', color: '$ui.inkQuiet' }} style={centred} testID="reconnect-note">{note}</Words> : <Waiting>{`Reconnecting to ${name}…`}</Waiting>}
    </>}
    <View style={{ height: 8 }} />
    {onDownloads ? <Pill primary label="Open Downloads" testID="reconnect-downloads" height={52} onPress={onDownloads} /> : null}
    <Pill primary={!!auth.viewerId && !onDownloads} label="Retry" testID="reconnect-retry" height={52} disabled={busy} onPress={onRetry} />
    {onSignInAgain && offersSignInAgain(auth) ? <Pill label="Sign in again" testID="reconnect-sign-in" height={50} disabled={busy} onPress={onSignInAgain} /> : null}
  </View>;
}

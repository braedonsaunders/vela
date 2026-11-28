// The stored session could not be restored yet: the app keeps trying by itself, says why and
// when it tries next, and Retry asks the server right away. After repeated failures it also
// offers Sign in again. The server chooser is available immediately.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Pill, Waiting, Words } from '../../common/controls';
import type { SessionAuth } from '../signed-out';
import { reconnectActions, reconnectNote } from './reconnect-note';

export function Reconnecting({ name, auth, busy, onChooseServer, onRetry, onDownloads, onSignInAgain }: { name: string; auth: SessionAuth; busy: boolean; onChooseServer(): void; onRetry(): void; onDownloads?(): void; onSignInAgain?(): void }) {
  const [now, setNow] = useState(Date.now);
  const counting = !!auth.retryAt && !auth.restoring && !busy;
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting, auth.retryAt]);
  const note = reconnectNote(auth, now, busy);
  const handlers = { choose: onChooseServer, downloads: onDownloads, retry: onRetry, signInAgain: onSignInAgain };
  return <View style={{ gap: auth.viewerId ? 10 : 12 }}>
    {auth.viewerId ? (
      <Words rows={{ 'font-size': '14px', color: '$ui.inkSecondary' }} testID="reconnect-note">{note || 'Your server is unavailable.'}</Words>
    ) : <>
      <Waiting>{`Reconnecting to ${name}…`}</Waiting>
      {auth.error ? <Words rows={{ 'font-size': '13px', color: '$ui.inkSecondary' }}>{auth.error}</Words> : null}
      {note ? <Words rows={{ 'font-size': '13px', color: '$ui.inkQuiet' }} testID="reconnect-note">{note}</Words> : null}
    </>}
    {reconnectActions(auth, handlers).map(({ action, label, testID, onPress }) =>
      <Pill key={action} label={label} testID={testID} height={44}
        primary={action === 'downloads' || (action === 'retry' && !!auth.viewerId && !onDownloads)}
        disabled={busy && action !== 'downloads'} onPress={onPress} />)}
  </View>;
}

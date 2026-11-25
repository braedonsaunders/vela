// A Top Shelf item on Apple TV (modules/vela-top-shelf): vela://resume/<title>?owner=<viewer>.
// It resumes the title (the server's resume point) only for the server and viewer whose shelf it
// came from; another signed-in viewer lands on their Home. A signed-out session is sent to sign in
// by the app's gate first, and returns here without the owner, so it lands on Home too.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useVelaState } from '@vela/core/react';
import { topShelfLinkAction, topShelfOwner } from '@vela/top-shelf';

export default function Resume() {
  const { id = '', owner } = useLocalSearchParams<{ id: string; owner?: string }>();
  const phase = useVelaState(state => state.auth.phase);
  const current = useVelaState(state => topShelfOwner(state.auth.serverId, state.auth.viewerId));
  const action = topShelfLinkAction(phase, current, owner);
  useEffect(() => {
    if (action === 'wait') return;
    if (action === 'resume' && id) router.replace({ pathname: '/watch/[id]', params: { id } });
    else router.replace('/');
  }, [action, id]);
  return null;
}

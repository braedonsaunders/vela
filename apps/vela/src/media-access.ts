// The player host's media authorization has one owner: the signed-in session. It is installed once
// per auth revision (sign-in, a server switch) whether or not the server has Live TV, and cleared
// only when that session ends. Films, live channels, guide previews, multiview tiles and trailer
// previews all read the same grant, so closing one of them never takes media access from the rest
// (#36: closing a film used to clear the grant the live guide had installed).
import { useEffect } from 'react';
import type { Vela as Store } from '@vela/core';
import { VelaPlayer } from '@vela/player';

export function useMediaAccess(store: Store, session: number | null): void {
  useEffect(() => {
    if (session === null) return;
    let current = true;
    store.playback.mediaAccess().then(
      grant => { if (current) VelaPlayer.setMediaAccess(grant); },
      () => undefined,
    );
    return () => {
      current = false;
      VelaPlayer.setMediaAccess(null);
    };
  }, [store, session]);
}

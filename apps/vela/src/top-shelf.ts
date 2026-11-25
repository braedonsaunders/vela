// Apple TV's Top Shelf follows Home's Continue Watching row for the signed-in viewer
// (modules/vela-top-shelf): written when it changes, cleared on sign-out and for a new viewer.
// Nothing happens where there is no Top Shelf (topShelfWriter is null there).
import { useEffect } from 'react';
import type { VelaState } from '@vela/core';
import { TopShelfSync, topShelfOwner, topShelfWriter } from '@vela/top-shelf';

const sync = topShelfWriter
  ? new TopShelfSync(topShelfWriter, error => console.warn('Vela Top Shelf update incomplete', error))
  : null;

export function useTopShelf(auth: VelaState['auth'], home: VelaState['home']): void {
  const rows = home.value?.rows;
  useEffect(() => {
    sync?.update({ phase: auth.phase, owner: topShelfOwner(auth.serverId, auth.viewerId), revision: auth.revision, rows });
  }, [auth.phase, auth.serverId, auth.viewerId, auth.revision, rows]);
}

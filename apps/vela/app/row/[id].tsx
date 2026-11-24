import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useVela, useVelaState } from '@vela/core/react';
import { libraryCardArtwork } from '@vela/core';
import type { SkinHost } from '@vela/skin';
import { DocumentScreen } from '../../src/screen';

/** Reuse the active skin's collection grid, including its scroll continuation and Back. */
export default function RowPage() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const store = useVela();
  const current = useVelaState(state => state.rows[id]);
  useEffect(() => {
    if (id && (!current || (current.load === 'ready' && current.value?.continuation === 'more' && !current.value.nextCursor))) void store.rows.load(id);
  }, [id, current, store]);
  const row = current?.value;
  // The row's card (round draws square here), else landscape for episodes and resumes, else poster.
  const shape = (row?.card === 'round' ? 'square' : row?.card) ?? (row?.items.length && row.items.every(item => item.kind === 'episode' || (item.progressSeconds > 0 && !item.played)) ? 'landscape' : 'poster');
  const page = (host: SkinHost): SkinHost => ({ ...host,
    env: { ...host.env, load: current?.load === 'failed' ? 'failed' : row ? 'ready' : 'loading',
      collection: { kind: 'row', model: row ? { name: row.name, items: row.items.map(card => libraryCardArtwork(card, shape)), more: !!row.nextCursor, complete: row.continuation === 'exhausted' } : undefined, moreLoading: current?.load === 'loading', card: shape },
    },
    dispatch: (action, arg) => {
      if (action === 'collectionMore') { if (current?.load !== 'failed') void store.rows.load(id, true); return; }
      if (action === 'retry') { void store.rows.load(id, !!row); return; }
      host.dispatch(action, arg);
    },
  });
  return <DocumentScreen route="collection" entry={id} page={page} />;
}

import { useMemo } from 'react';
import { router } from '../router';
import type { SkinHost } from '@vela/skin';
import { builtinHref, builtinScreenId } from '@vela/skin/src/resolve/builtin';
import { ScreenView } from '@vela/skin/src/screen/host';
import { useAppScreenActions } from '../screen-actions';

type ReadPage = 'book' | 'series' | 'reader';

const setParams = (params: Record<string, string>) => router.setParams(params);

export function ReadDocument({ page, id, library, host, active, back }: {
  page: ReadPage;
  id: string;
  library?: string;
  host: SkinHost;
  active: boolean;
  back(): void;
}) {
  const target = useMemo(() => ({ kind: 'screen' as const, id: builtinScreenId('read'), page }), [page]);
  const params = useMemo(() => ({ id, library: library ?? '' }), [id, library]);
  const actions = useAppScreenActions({ host, back, setParams });
  return <ScreenView target={target} href={builtinHref('read', page)} params={params} host={host} active={active} actions={actions} route={false} />;
}

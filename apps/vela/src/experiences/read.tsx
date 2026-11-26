// Read supplies the experience shell and its home document. The slot still uses the
// shared library route vocabulary. The Watch migration replaces that projection.
import { router } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import type { SkinHost } from '@vela/skin';
import { ExperienceView } from '@vela/skin/src/screen/experience';
import { HOME_PLACE, type ExperiencePlace } from '@vela/skin/src/screen/experience-route';
import type { LibraryParams } from '../browse/library-query';
import { DocumentScreen } from '../screen';
import { useAppScreenActions } from '../screen-actions';
import { useLibraryRoutePage } from './watch';

const goHome = () => router.replace('/');
const setParams = (params: Record<string, string>) => router.setParams(params);

export function ReadLibrary({ id, params }: { id: string; params: LibraryParams }) {
  const page = useLibraryRoutePage(id, params);
  const wrap = useCallback((content: ReactNode, host: SkinHost, active: boolean) => (
    <ReadLibraryExperience id={id} content={content} host={host} active={active} />
  ), [id]);
  return <DocumentScreen route="library" entry={id} page={page} sharedShell wrap={wrap} />;
}

function ReadLibraryExperience({ id, content, host, active }: { id: string; content: ReactNode; host: SkinHost; active: boolean }) {
  const actions = useAppScreenActions({ host, back: goHome, setParams });
  const go = useCallback(({ page, params }: ExperiencePlace, options?: { replace?: boolean }) => {
    const entry = params.id;
    if (entry && (page === 'book' || page === 'series' || page === 'reader')) {
      const pathname = page === 'reader' ? '/read/[id]' : '/title/[id]';
      const target = { pathname, params: { id: entry, library: id } } as const;
      if (options?.replace) router.replace(target); else router.push(target);
    } else if (page === 'home') {
      router.setParams(params);
    }
  }, [id]);
  return <ExperienceView experience="read" libraryId={id} place={HOME_PLACE} go={go} host={host} active={active} actions={actions} content={content} />;
}

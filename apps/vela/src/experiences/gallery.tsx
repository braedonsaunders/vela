import { router } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import type { SkinHost } from '@vela/skin';
import { ExperienceView } from '@vela/skin/src/screen/experience';
import { HOME_PLACE, type ExperiencePlace } from '@vela/skin/src/screen/experience-route';
import type { LibraryParams } from '../browse/library-query';
import { useLibraryRoutePage } from '../browse/library-route-page';
import { openMediaTitle } from '../media/actions';
import { DocumentScreen } from '../screen';
import { useAppScreenActions } from '../screen-actions';

const goHome = () => router.replace('/');
const setParams = (params: Record<string, string>) => router.setParams(params);
const LIBRARY_PLACE: ExperiencePlace = { page: 'library', params: {} };

export function GalleryLibrary({ id, params }: { id: string; params: LibraryParams }) {
  const page = useLibraryRoutePage(id, params);
  const place = params.view === 'library' ? LIBRARY_PLACE : HOME_PLACE;
  const wrap = useCallback((content: ReactNode, host: SkinHost, active: boolean) => (
    <GalleryLibraryExperience id={id} place={place} content={content} host={host} active={active} />
  ), [id, place]);
  return <DocumentScreen route="library" entry={id} page={page} sharedShell wrap={wrap} />;
}

function GalleryLibraryExperience({ id, place, content, host, active }: {
  id: string;
  place: ExperiencePlace;
  content: ReactNode;
  host: SkinHost;
  active: boolean;
}) {
  const actions = useAppScreenActions({ host, back: goHome, setParams });
  const go = useCallback(({ page, params }: ExperiencePlace) => {
    if (page === 'photo' && params.id) openMediaTitle(params.id, 'photo', id);
    if (page === 'home' || page === 'library') router.setParams({ view: page === 'home' ? 'recommended' : 'library', ...params });
  }, [id]);
  return <ExperienceView experience="gallery" libraryId={id} place={place} go={go} host={host} active={active} actions={actions} content={content} />;
}

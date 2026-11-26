// The host of an experience (docs/experiences.md): a library whose experience Vela builds in (`listen`)
// draws as its built-in documents. The shell (`vela:<experience>/shell`, a document per form factor,
// stays mounted) draws the page in view at its `children` slot; the page (`vela:<experience>/<page>`)
// is the one the address names (`?m=`, screen/experience-route.ts). A page's `navigate` to another
// page of the same experience moves the address; the rest leaves as any screen's actions do. Each
// page keeps its scroll by its key. The active skin's overrides of the experience apply to both
// (resolveScreenDocument). The app shows this only where the experience has a shell.
import { useCallback, useMemo, type MutableRefObject, type ReactNode } from 'react';
import { View } from 'react-native';
import type { SkinHost } from '../host';
import { headerInsetOf } from '../resolve/inherit';
import { useMediaLook } from '../widgets/media/parts';
import { builtinDocument, builtinHref, builtinScreenId } from '../resolve/builtin';
import { ScreenView, type ScreenAppActions, type ScreenDestination, type ScreenStateHandle } from './host';
import { HOME_PLACE, placeKey, type ExperiencePlace } from './experience-route';

export interface ExperienceViewProps {
  experience: string;
  /** The library shown (the `library` param of the shell and every page). */
  libraryId: string;
  /** The page in view (from the address: placeOfAddress). */
  place: ExperiencePlace;
  /** Move to another page of the experience (the app writes the address: addressOfPlace). */
  go(place: ExperiencePlace, options?: { replace?: boolean }): void;
  host: SkinHost;
  active: boolean;
  actions: ScreenAppActions;
  /** Inline experience over content whose hosting route already supplies the header and scroll. */
  content?: ReactNode;
  /** A bounded page supplies this at its children slot and owns its own scrolling. */
  pageHeader?: ReactNode;
  /** Drawn when the experience has no shell (or the page none and no home): the app's fallback. */
  missing?: ReactNode;
  /** The shell document's local state for app code: `shell.current?.toggle('queue', { clear: ['sound'] })`. */
  shell?: MutableRefObject<ScreenStateHandle | null>;
}

/** Whether Vela builds this experience in (it has a shell document). */
export const hasExperience = (experience: string): boolean => !!builtinDocument(builtinHref(experience, 'shell'));

/** The place drawn: the one asked for, or home when the experience has no such page. */
export function drawnPlace(experience: string, place: ExperiencePlace): ExperiencePlace {
  return builtinDocument(builtinHref(experience, place.page)) ? place : HOME_PLACE;
}

export function ExperienceView({ experience, libraryId, place: asked, go, host, active, actions, content, pageHeader, missing = null, shell }: ExperienceViewProps) {
  const screen = builtinScreenId(experience);
  const place = drawnPlace(experience, asked);
  const key = placeKey(place);
  // A navigate within the experience is a new address; setParams replaces the page's.
  const navigate = useCallback((to: ScreenDestination) => {
    if (to.kind === 'page' && (!to.screen || to.screen === screen)) {
      go({ page: to.page || 'home', params: Object.fromEntries(Object.entries(to.params).filter(([name, v]) => name !== 'library' && typeof v === 'string')) });
      return;
    }
    actions.navigate(to);
  }, [actions, go, screen]);
  const pageActions = useMemo<ScreenAppActions>(() => ({
    ...actions, navigate,
    setParams: params => go({ page: place.page, params: Object.fromEntries(Object.entries(params).filter(([name]) => name !== 'library')) }, { replace: true }),
  }), [actions, navigate, go, place.page]);
  const shellParams = useMemo(() => ({ library: libraryId }), [libraryId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pageParams = useMemo(() => ({ ...place.params, library: libraryId }), [key, libraryId]);
  const shellTarget = useMemo(() => ({ kind: 'screen' as const, id: screen, page: 'shell' }), [screen]);
  const pageTarget = useMemo(() => ({ kind: 'screen' as const, id: screen, page: place.page }), [screen, place.page]);
  const inline = content !== undefined;
  const pageChildren = inline ? content : pageHeader;
  const pageHost = useMemo(() => pageChildren === undefined ? host : { ...host, children: pageChildren }, [pageChildren, host]);
  const page = (
    <ScreenView key={key} target={pageTarget} href={builtinHref(experience, place.page)} params={pageParams} host={pageHost} active={active} route={!inline && pageHeader === undefined}
      actions={pageActions} scrollKey={pageHeader === undefined ? `${experience}:${libraryId}:${key}` : undefined} />
  );
  // The shell draws the page where its document puts the `children` slot.
  const shellHost = useMemo<SkinHost>(() => ({ ...host, children: page }), [host, page]);
  // The shell starts below the skin's navigation, wherever the skin draws it (overlay or in flow): the
  // inset is the host's, so every experience's shell gets it; the shell document adds its own space.
  const m = useMediaLook();
  const inset = host.doc.document.traits?.headerInset ?? headerInsetOf(host.doc.document.slots?.shell);
  if (!hasExperience(experience)) return <>{missing}</>;
  const shellView = <ScreenView target={shellTarget} href={builtinHref(experience, 'shell')} params={shellParams} host={shellHost} active={active} actions={pageActions} route={false} handle={shell} />;
  if (inline) return shellView;
  return (
    <View pointerEvents="box-none" style={[{ flex: 1 }, m.box({ 'padding-top': m.small ? inset.small : inset.wide })]} testID="experience-shell">
      {shellView}
    </View>
  );
}

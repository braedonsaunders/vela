// Plugin screens (Sports) as top-level sections. Bootstrap navigation lists them; the shell draws
// each as a destination after Live TV, in every document's own navigation, with the id
// `screen:<id>`, so a document's ordinary `library {dest.id}` press opens the screen.
import type { Destination, ScreenNav } from '@vela/core';

const PREFIX = 'screen:';

export const screenDestinationId = (id: string) => `${PREFIX}${id}`;

/** The plugin screen a destination id names, or '' for a library. */
export function screenOf(destinationId: string | undefined): string {
  return destinationId?.startsWith(PREFIX) ? destinationId.slice(PREFIX.length) : '';
}

/** The libraries with the plugin screens after Live TV (at the end when there is no Live TV). */
export function withScreens(libraries: Destination[], screens: readonly ScreenNav[] | undefined): Destination[] {
  if (!screens?.length) return libraries;
  const entries: Destination[] = screens.map(screen => ({ id: screenDestinationId(screen.id), name: screen.title, kind: 'screen', dateDisplay: 'date', backdrop: '' }));
  const live = libraries.findIndex(library => library.kind === 'live');
  const at = live < 0 ? libraries.length : live + 1;
  return [...libraries.slice(0, at), ...entries, ...libraries.slice(at)];
}

/** The web address of a plugin screen. */
export const screenPath = (id: string) => `/screen/${encodeURIComponent(id)}`;

/** A fully qualified landing page address belongs to the section navigator. */
export function screenLandingHref(entry: ScreenNav | undefined, page: string, params: Record<string, string>) {
  if (!entry || page !== (entry.page || 'index')) return null;
  return { pathname: '/screen/[id]' as const, params: { ...params, id: entry.id } };
}

// The shell's navigation (env.navigation): the server's libraries in the viewer's order without
// the ones they hid (core's library-order.ts), with the plugin screens after Live TV. Search, the
// guide and whether Live TV is a library read every library (env.libraries).
import { arrangeLibraries, viewerLibraryOrder, type Destination, type VelaState } from '@vela/core';
import { withScreens } from './plugin-screens';

/** Manage libraries is offered to a signed-in viewer with a viewer id, which their choices are kept
 * under: the serverSwitcher widget's entry and skins' own rows (env.canManageLibraries) read this.
 * Offline the session keeps its viewer id but offers neither. */
export function canManageLibraries(auth: Pick<VelaState['auth'], 'phase' | 'viewerId'>): boolean {
  return auth.phase === 'signed-in' && !!auth.viewerId;
}

export function navigationOf(state: VelaState): Destination[] {
  return withScreens(arrangeLibraries(state.libraries.value ?? [], viewerLibraryOrder(state)), state.home.value?.screens);
}

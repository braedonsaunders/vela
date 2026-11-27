// The shell's navigation (env.navigation): the server's libraries in the viewer's order without
// the ones they hid (core's library-order.ts), with the plugin screens after Live TV. Search, the
// guide and whether Live TV is a library read every library (env.libraries).
import { arrangeLibraries, viewerLibraryOrder, type Destination, type VelaState } from '@vela/core';
import { withScreens } from './plugin-screens';

export function navigationOf(state: VelaState): Destination[] {
  return withScreens(arrangeLibraries(state.libraries.value ?? [], viewerLibraryOrder(state)), state.home.value?.screens);
}

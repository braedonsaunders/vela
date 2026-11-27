// The viewer's order and hidden libraries for the navigation, stored on this device and scoped to
// `(serverId, viewerId)`. Changes apply to the active server and viewer, and a removed server's
// preferences are pruned.
import {
  libraryOrderKey,
  moveLibrary,
  removeServerLibraryOrders,
  setLibraryHidden,
  storedLibraryOrders,
  type LibraryOrder,
  type LibraryOrderMap,
} from '../library-order';
import type { Session } from './session';
import type { StateBox } from './state';
import type { VelaState } from './index';

export type LibraryOrdersState = LibraryOrderMap;

export const initialLibraryOrders: LibraryOrdersState = {};

/** The active viewer's preference on the active server, if they have one. */
export function viewerLibraryOrder(state: Pick<VelaState, 'auth' | 'libraryOrders'>): LibraryOrder | undefined {
  const { serverId, viewerId } = state.auth;
  return serverId && viewerId ? state.libraryOrders[libraryOrderKey(serverId, viewerId)] : undefined;
}

export class LibraryOrders {
  constructor(
    private readonly box: StateBox<VelaState>,
    session: Session,
  ) {
    session.onForget(serverId => this.removeServer(serverId));
  }

  /** Hydrate stored preferences once at launch, keeping any change made before hydration. */
  load(stored: unknown): void {
    const loaded = storedLibraryOrders(stored);
    this.box.update('libraryOrders', current => ({ ...loaded, ...current }));
  }

  moveUp(id: string): void {
    this.change(preference => moveLibrary(this.box.get().libraries.value ?? [], preference, id, -1));
  }

  moveDown(id: string): void {
    this.change(preference => moveLibrary(this.box.get().libraries.value ?? [], preference, id, 1));
  }

  setHidden(id: string, hidden: boolean): void {
    this.change(preference => setLibraryHidden(this.box.get().libraries.value ?? [], preference, id, hidden));
  }

  /** Back to the server's order with every library shown, for the active viewer only. */
  reset(): void {
    const key = this.key();
    if (!key) return;
    this.box.update('libraryOrders', current => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  removeServer(serverId: string): void {
    if (!serverId) return;
    this.box.update('libraryOrders', current => removeServerLibraryOrders(current, serverId));
  }

  private key(): string {
    const { serverId, viewerId } = this.box.get().auth;
    return serverId && viewerId ? libraryOrderKey(serverId, viewerId) : '';
  }

  private change(next: (preference: LibraryOrder | undefined) => LibraryOrder): void {
    const key = this.key();
    if (!key) return;
    this.box.update('libraryOrders', current => {
      const preference = next(current[key]);
      const unchanged = preference === current[key] || (!current[key] && !preference.order.length && !preference.hidden.length);
      return unchanged ? current : { ...current, [key]: preference };
    });
  }
}

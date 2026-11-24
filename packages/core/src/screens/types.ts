// The seam between core's screen data (store, adapter, stream: packages/core/src/screens) and the
// skin's screen resolver and blocks (packages/skin/src/screen): one page's or surface's data as the
// renderer reads it. docs/plugin-screens.md: Data, records and live updates.
import type { RecordEntry, SurfaceContext } from '../wire';

export interface ScreenPageState {
  /** The document's href (immutable) and the page's canonical key (screen/page?params). */
  href: string;
  key: string;
  /** Page params as chosen (they change before the dependent sources answer). */
  params: Record<string, string>;
  /** Source values as Ether answered; objects may be `{ $record: key }` references. */
  sources: Record<string, unknown>;
  /** Sources re-reading now (their previous value stays) and sources that failed (error code). */
  pending: Record<string, boolean>;
  errors: Record<string, string>;
  /** The first read: loading until it answers, failed when it could not. */
  load: 'loading' | 'ready' | 'failed';
  /** Surfaces: what the host is showing. */
  context?: SurfaceContext;
  rev: number;
}

/** The shared record pool: every page and surface reads the same `event:`/`entity:`/`item:`/`channel:`/`p:` records. */
export type RecordPool = Record<string, RecordEntry>;

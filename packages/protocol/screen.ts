// Plugin screens and surfaces (docs/plugin-screens.md): documents a plugin ships, Ether validates,
// localises and serves, and Vela draws in the active skin. The node language is skin.ts's; this
// file holds the document envelope and the wire around it (data, records, stream, actions,
// bootstrap contributions). Ether's JSON Schema (plugin-screen.v1.json) is generated from here.
import type { ID, Timestamp } from './types';
import type { MotionPreset, Node, Template } from './skin';

/** Where a document is drawn (docs/plugin-screens.md: Surfaces). */
export type Presentation = 'section' | 'page' | 'playerOverlay' | 'toast' | 'homeRow' | 'titlePanel';

/** Ether-owned: a page parameter. Values travel as `p.<name>` on data reads. */
export interface ParamSpec {
  type: 'string' | 'enum' | 'date' | 'ref' | 'int' | 'bool';
  default?: string;
  max?: number;
  enum?: string[];
}

/** Ether-owned: a named data source. Vela reads only `lazy` and the served `deps`. */
export interface SourceSpec {
  from: string;
  lazy?: boolean;
  /** Served by Ether: the page params this source's arguments read (a change re-reads it). */
  deps?: string[];
  [argument: string]: unknown;
}

export interface ScreenDocument {
  schema: 1;
  kind: 'screen';
  /** The lowest RENDERER_VERSION that draws this document (19 or more). */
  renderer: number;
  /** Blocks and kit templates the document cannot do without, by name. */
  requires?: string[];
  /** Plugin-scoped screen (or surface) id and the page within it. */
  screen: ID;
  page: ID;
  version: string;
  title: Template;
  presentation: Presentation;
  params?: Record<string, ParamSpec>;
  sources: Record<string, SourceSpec>;
  /** Served by Ether from the manifest: the plugin actions this page may call. */
  actions?: Record<string, { confirm?: string }>;
  /** One locale, already chosen by Ether. A string may hold holes. */
  strings?: Record<string, string>;
  /** `$name` in style values: `$ui.*`, numbers, and min()/max()/color-mix() over them. */
  tokens?: Record<string, string>;
  /** At most 8 literal colours, `$palette.<name>`, for ink drawn on data colours. */
  palette?: Record<string, string>;
  templates?: Record<string, Node>;
  motion?: Record<string, MotionPreset>;
  /** As skin keyframes, plus `color` to a `$ui` token. */
  keyframes?: Record<string, Record<string, { opacity?: number; translate?: string; scale?: number; rotate?: number; color?: string }>>;
  tree: Node;
  loading?: Node;
  failure?: Node;
  /** Re-read the non-lazy sources this often while shown (seconds, at least 60). */
  refresh?: number;
  focus?: { initial?: Template };
}

/** Document limits, enforced by Ether on validation and by Vela on load. */
export const SCREEN_LIMITS = {
  documentBytes: 256 * 1024,
  nodes: 4000,
  depth: 32,
  stringLength: 4096,
  arrayItems: 500,
  sourceBytes: 256 * 1024,
  responseBytes: 1024 * 1024,
  paletteColours: 8,
  actionArgs: 8,
  actionArgLength: 512,
} as const;

// Data

/** A reference to a shared record in a source: `{ "$record": "event:…" }`. */
export interface RecordRef { $record: string }
/** Ether's `$link` envelope after rewriting: the only hrefs `openLink` accepts. */
export interface LinkValue { href: string; host: string }
export interface RecordEntry<T = unknown> { rev: number; value: T }
export interface SourceError { code: string; retry?: boolean }

/** GET /screens/{id}/pages/{page}/data?sources=&p.<param>=&tz= */
export interface ScreenData {
  rev: number;
  sources: Record<string, unknown>;
  records: Record<string, RecordEntry>;
  errors?: Record<string, SourceError>;
  live?: { topic: string };
}

/** /live/stream?topic=&since= `event: records`. */
export interface StreamRecords { records: Record<string, RecordEntry> }
/** /live/stream `event: source`: a whole-source replace, owned by a screen page or by a surface
 * (exactly one of the two). One stream carries at most 4 topics: ?topic=A&topic=B&since=<lowest page
 * rev>&tz=&alerts=1 (a 5th answers 400 too_many_topics). */
export type StreamSource =
  | { screen: ID; page: ID; surface?: undefined; source: string; rev: number; value: unknown }
  | { surface: ID; screen?: undefined; page?: undefined; source: string; rev: number; value: unknown };

// Actions

/** Vela-native navigation, also the `navigate` of an action answer (#/$defs/NavigateAction). */
export interface NavigateAction {
  action: 'navigate';
  args: { page?: ID; screen?: ID; route?: 'title' | 'live' | 'guide' | 'search' | 'home' | 'library'; id?: string; [param: string]: string | undefined };
}

/** POST /screens/{id}/actions/{action} */
/** An action argument as its declared type wants it: text, a whole number, true/false or a list of texts. */
export type ScreenActionArg = string | number | boolean | string[];
export interface ScreenActionRequest { page: ID; params: Record<string, string>; args: Record<string, ScreenActionArg>; context?: Record<string, string>; /** The viewer's IANA zone. */ tz?: string }
export interface ScreenActionAnswer {
  records?: Record<string, RecordEntry>;
  sources?: Record<string, unknown>;
  refresh?: string[];
  /** Plain text, at most 200 characters. */
  toast?: string;
  navigate?: NavigateAction;
}

// Bootstrap

export interface ScreenDocumentRef { href: string; renderer: number }

/** A surface a client may show (bootstrap `surfaces`, filtered, capped and ordered by Ether). `when` is
 * evaluated by Vela locally. Routes: GET /surfaces/{id}/document, GET /surfaces/{id}/data?p.event=&p.channel=
 * &p.title=&p.kind=&p.alert.ref=&tz= (404: draw nothing), POST /surfaces/{id}/actions/{action}.
 * `id` is "<pluginShort>.<id>". */
export interface SurfaceContribution {
  id: ID;
  presentation: Exclude<Presentation, 'section' | 'page'>;
  /** playerOverlay only. */
  anchor?: 'topLeft' | 'topRight' | 'bottom';
  when?: SurfaceWhen;
  /** playerOverlay only: always shown, only with the chrome, or a viewer switch in the player menu. */
  visibility?: 'always' | 'chrome' | 'toggle';
  /** A player-menu switch (required on every player overlay). `enabled` is the viewer's remembered
   *  choice; PUT /surfaces/{id}/setting {enabled} (204) changes it, per viewer. */
  setting?: { id: string; label: string; default: boolean; enabled?: boolean };
  /** toast only: seconds on screen, 8..30. */
  ttl?: number;
  document: ScreenDocumentRef;
}

export interface SurfaceWhen {
  /** The playing live channel's event belongs to this feed (fully qualified, as the session's liveEvent.feed). */
  event?: { feed: string };
  kind?: 'channel' | 'programme' | 'title';
  alert?: { plugin: string };
  titleKind?: string;
}

/** The host context a surface document reads as `{context.<name>}`. Sent to Ether as p.event, p.channel,
 * p.title, p.kind and p.alert.ref only; chrome, pictureTime and delayed stay on the client. */
export interface SurfaceContext {
  channel?: string;
  event?: string;
  title?: string;
  kind?: 'channel' | 'programme' | 'title';
  chrome?: boolean;
  /** Wall-clock time of the frame on screen (behind live when timeshifted). */
  pictureTime?: Timestamp;
  delayed?: boolean;
  alert?: { id: ID; kind: string; title: string; body: string; at: Timestamp; ref?: string; plugin?: string };
}

/** /live/stream `event: alert` (alerts=1), the frame a toast surface draws. */
export interface AlertFrame { id: ID; kind: string; title: string; body: string; at: Timestamp; ref?: string; plugin?: string; surface?: ID }

/** A Home row that is a surface (bootstrap and home rows), placed after the first row: id `surface:<pluginID>:<id>` (`surface:org.ether.sports:tonight`), surface the surface id (`sports.tonight`). */
export interface SurfaceRow { kind: 'surface'; id: ID; surface: ID }

/** The navigation entry of a plugin screen (bootstrap `navigation`). */
export interface ScreenNavigationEntry { kind: 'screen'; id: ID; title: string; icon?: string; page: ID; document: ScreenDocumentRef }

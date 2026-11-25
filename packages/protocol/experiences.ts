// Experiences (docs/experiences.md): built-in page documents, the skin overrides merged over
// them, and the published slot list plugins fill with slot surfaces. The node language is
// skin.ts's and the document envelope screen.ts's; this file holds what belongs to experiences.
import type { FormFactor, Node, PartStyle, Platform } from './skin';

/** An experience id: `watch`, `listen`, `read`, `gallery`, `live`, or any slug a later plugin
 * defines (`^[a-z][a-z0-9-]{0,31}$`). A client draws an id it does not know as `watch`. */
export type ExperienceId = string;

/** The experiences Vela builds in (reserved names). */
export const BUILT_IN_EXPERIENCES = ['watch', 'listen', 'read', 'gallery', 'live'] as const;

export const EXPERIENCE_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** The address of a built-in page document: `vela:<experience>/<page>` (`vela:listen/album`). Core
 * opens it as the screen `vela.<experience>`, page `<page>`; it is never fetched. */
export const builtinHref = (experience: ExperienceId, page: string): string => `vela:${experience}/${page}`;

export function parseBuiltinHref(href: string): { experience: ExperienceId; page: string } | undefined {
  const m = /^vela:([a-z][a-z0-9-]{0,31})\/([A-Za-z][\w-]{0,63})$/.exec(href);
  return m ? { experience: m[1]!, page: m[2]! } : undefined;
}

/** A skin's replacement of a whole built-in page: a tree, or a tree with variants. The page keeps
 * the built-in document's sources, params, actions and strings. */
export interface PageOverride {
  tree: Node;
  /** Whole-tree replacements by form factor and by platform (a platform wins over a form). */
  forms?: Partial<Record<FormFactor, Node>>;
  platforms?: Partial<Record<Platform, Node>>;
  loading?: Node;
  failure?: Node;
}

/** A skin's overrides of one experience (`SkinDocument.experiences.<id>`), merged over the built-in
 * documents at resolve time; whatever is left out stays Vela's. */
export interface ExperienceOverride {
  /** Pages drawn whole, by page id (`album`, `nowPlaying`). */
  pages?: Record<string, Node | PageOverride>;
  /** Templates by name, merged over every page's own. A template named after a rich-block part
   * (`trackTable.row`, `queue.row`) replaces that part's template, where the block allows it. */
  templates?: Record<string, Node>;
  /** Rich-block parts (`lyrics.activeLine`), merged over the pages' own part styles. */
  parts?: Record<string, PartStyle>;
  /** The experience's shell, per form factor. */
  shell?: Partial<Record<FormFactor, Node>>;
}

// Slots

/** A slot's context entry: the `{context.<name>}` a slot surface reads, and the record kind it refers to. */
export interface SlotContextSpec { name: string; ref?: 'event' | 'channel' | 'item' }

/** A published slot (`$defs.Slots` in the generated schema). `cap.perPlugin`: surfaces one plugin may
 * put in it; `cap.perSlot`: surfaces drawn in it across plugins (in the owner's order). `version`:
 * the RENDERER_VERSION that published it. */
export interface SlotSpec {
  id: string;
  context: readonly SlotContextSpec[];
  cap: { perPlugin?: number; perSlot?: number };
  version: number;
}

const PLAYER_CONTEXT = [
  { name: 'channel', ref: 'channel' }, { name: 'event', ref: 'event' }, { name: 'title', ref: 'item' },
  { name: 'kind' }, { name: 'chrome' }, { name: 'pictureTime' }, { name: 'delayed' },
] as const;

/** The published slot list. Additive within a renderer version: a new slot is a re-vendor for Ether. */
export const SLOTS = [
  { id: 'home.rows', context: [], cap: { perPlugin: 1 }, version: 20 },
  { id: 'title.panel', context: [{ name: 'title', ref: 'item' }, { name: 'kind' }], cap: { perPlugin: 1 }, version: 20 },
  { id: 'listen.album.panel', context: [{ name: 'title', ref: 'item' }], cap: { perPlugin: 1, perSlot: 3 }, version: 20 },
  { id: 'listen.artist.panel', context: [{ name: 'title', ref: 'item' }], cap: { perPlugin: 1, perSlot: 3 }, version: 20 },
  { id: 'listen.nowPlaying.panel', context: [{ name: 'title', ref: 'item' }], cap: { perPlugin: 1, perSlot: 2 }, version: 20 },
  { id: 'read.sidePanel', context: [{ name: 'title', ref: 'item' }], cap: { perPlugin: 1, perSlot: 2 }, version: 20 },
  { id: 'gallery.photo.panel', context: [{ name: 'title', ref: 'item' }], cap: { perPlugin: 1, perSlot: 2 }, version: 20 },
  { id: 'player.overlay.topLeft', context: PLAYER_CONTEXT, cap: { perSlot: 2 }, version: 20 },
  { id: 'player.overlay.topRight', context: PLAYER_CONTEXT, cap: { perSlot: 2 }, version: 20 },
  { id: 'player.overlay.bottom', context: PLAYER_CONTEXT, cap: { perSlot: 2 }, version: 20 },
  { id: 'toast', context: [{ name: 'alert' }], cap: { perPlugin: 1, perSlot: 3 }, version: 20 },
] as const satisfies readonly SlotSpec[];

/** A published slot id. */
export type SlotId = (typeof SLOTS)[number]['id'];

export const slotSpec = (id: string): SlotSpec | undefined => (SLOTS as readonly SlotSpec[]).find(s => s.id === id);

/** The slot a surface fills: its `slot`, or the slot its Sports-era presentation stands for
 * (`homeRow`: home.rows, `titlePanel`: title.panel, `playerOverlay` at an anchor: player.overlay.<anchor>,
 * `toast`: toast). */
export function surfaceSlot(surface: { presentation: string; slot?: string; anchor?: string }): SlotId | undefined {
  const id = surface.presentation === 'slot' ? surface.slot
    : surface.presentation === 'homeRow' ? 'home.rows'
      : surface.presentation === 'titlePanel' ? 'title.panel'
        : surface.presentation === 'playerOverlay' ? (surface.anchor ? `player.overlay.${surface.anchor}` : undefined)
          : surface.presentation === 'toast' ? 'toast' : undefined;
  return id && slotSpec(id) ? id as SlotId : undefined;
}

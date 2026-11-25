// The rich blocks' published contract (docs/experiences.md: Blocks), as data: each block's props,
// the parts a document may style and the parts whose template it may replace. Pure data with no
// imports, so the resolver, the validator and the schema tool (which emits it as
// $defs.RichBlocks) all read the same list.
//
// Owned by L1 (the Listen blocks). This first cut is G2's stub from the names in
// docs/experiences.md, so the document language can land first; L1 replaces its contents.

export interface RichPropSpec {
  /** value: any data (a single hole keeps its raw value); template: text; boolean, number; enum: one of `values`. */
  type: 'value' | 'template' | 'boolean' | 'number' | 'enum';
  values?: readonly string[];
  required?: boolean;
}

export interface RichBlockSpec {
  props: Readonly<Record<string, RichPropSpec>>;
  /** Parts a document styles (`parts: { "<block>.<part>": Style }`). */
  parts: readonly string[];
  /** Parts whose template a document may replace (`partTemplates`, or a document template named after the part). */
  templates: readonly string[];
}

export const RICH_BLOCKS = {
  player: {
    props: {},
    parts: ['player.surface', 'player.transport', 'player.scrubber', 'player.menu'],
    templates: [],
  },
  nowPlaying: {
    props: { item: { type: 'value' } },
    parts: ['nowPlaying.stage', 'nowPlaying.artwork', 'nowPlaying.title', 'nowPlaying.subtitle', 'nowPlaying.transport'],
    templates: [],
  },
  queue: {
    props: { queue: { type: 'value' }, reorder: { type: 'boolean' } },
    parts: ['queue.heading', 'queue.row', 'queue.activeRow'],
    templates: ['queue.row'],
  },
  lyrics: {
    props: { item: { type: 'value' }, translate: { type: 'boolean' } },
    parts: ['lyrics.line', 'lyrics.activeLine', 'lyrics.translation'],
    templates: [],
  },
  trackTable: {
    props: { tracks: { type: 'value', required: true }, columns: { type: 'template' }, discs: { type: 'boolean' }, reorder: { type: 'boolean' } },
    parts: ['trackTable.header', 'trackTable.row', 'trackTable.activeRow', 'trackTable.disc'],
    templates: ['trackTable.row'],
  },
  eq: {
    props: {},
    parts: ['eq.band', 'eq.label'],
    templates: [],
  },
  rail: {
    props: { items: { type: 'value' }, collapsed: { type: 'boolean' } },
    parts: ['rail.row', 'rail.activeRow', 'rail.heading'],
    templates: ['rail.row'],
  },
  bar: {
    props: { position: { type: 'enum', values: ['bottom', 'top'] } },
    parts: ['bar.surface', 'bar.cover', 'bar.title', 'bar.transport', 'bar.scrubber'],
    templates: [],
  },
  visualizer: {
    props: { mode: { type: 'enum', values: ['background', 'fullscreen'], required: true }, sceneId: { type: 'template' } },
    parts: ['visualizer.scenePicker', 'visualizer.sceneChip', 'visualizer.sceneChipActive', 'visualizer.caption'],
    templates: [],
  },
} as const satisfies Record<string, RichBlockSpec>;

export type RichBlockName = keyof typeof RICH_BLOCKS;

/**
 * Vela skin documents, schema 1: a whole skin as data. The client's one compiled
 * renderer (the "doc" engine) draws it; nothing in a document executes. See
 * docs/skin-schema.md for semantics, limits and the binding vocabulary.
 */

/** A string with `{key}` holes filled from the binding vocabulary (`{card.name}`); `{{` is a literal brace. */
export type Template = string;

/**
 * CSS-like properties by their CSS name (`background-color`, `grid-template-columns`).
 * Values are CSS text, a Tamber token name (`surface.page`), a document token
 * (`$accent`), or a Template for the properties docs/skin-schema.md marks bindable.
 */
export type Style = Partial<Record<StyleProperty, string>>;
export type StyleProperty =
  | 'display' | 'position' | 'inset' | 'top' | 'right' | 'bottom' | 'left' | 'z-index'
  | 'width' | 'height' | 'min-width' | 'min-height' | 'max-width' | 'max-height' | 'aspect-ratio' | 'box-sizing'
  | 'flex' | 'flex-grow' | 'flex-basis' | 'order' | 'flex-direction' | 'flex-wrap' | 'flex-shrink' | 'align-items' | 'align-self' | 'justify-content' | 'gap'
  | 'grid-template-columns' | 'grid-template-rows' | 'grid-column' | 'grid-row'
  | 'margin' | 'padding' | 'padding-top' | 'padding-right' | 'padding-bottom' | 'padding-left' | 'margin-top' | 'margin-right' | 'margin-bottom' | 'margin-left' | 'overflow' | 'overflow-x' | 'overflow-y' | 'scroll-snap-type' | 'scroll-snap-align' | 'scrollbar-width'
  | 'color' | 'background-color' | 'background-image' | 'opacity'
  | 'border' | 'border-width' | 'border-style' | 'border-color' | 'border-radius' | 'border-top-width' | 'border-top-color' | 'border-bottom-width' | 'border-bottom-color' | 'outline' | 'box-shadow' | 'filter' | 'backdrop-filter' | 'mask-image'
  | 'font-family' | 'font-size' | 'font-weight' | 'font-style' | 'line-height' | 'letter-spacing' | 'text-transform'
  | 'text-align' | 'text-shadow' | '-webkit-text-stroke' | 'text-overflow' | 'line-clamp' | 'white-space' | 'font-variant-numeric'
  | 'object-fit' | 'transform-origin' | 'translate' | 'scale' | 'rotate' | 'perspective'
  | 'transition' | 'animation' | 'pointer-events' | 'cursor';

/** One test on the binding vocabulary or the skin's own flags; a node's `when` list must all hold. */
export interface Condition {
  /** A binding key (`card.played`, `hero.backdrop`, `env.small`), or `flag:<name>`. */
  test: string;
  /** set: non-empty / true / non-zero (default). eq/ne: equals `value`. gt/lt: numeric. mod: `value` "n:r", the number % n == r. */
  is?: 'set' | 'eq' | 'ne' | 'gt' | 'lt' | 'mod';
  value?: string;
  not?: boolean;
}

export type Action =
  | 'select' | 'play' | 'pickHero' | 'home' | 'search' | 'live' | 'library'
  | 'toggle' | 'open' | 'close' | 'reset' | 'openPicker' | 'signOut' | 'moreRow' | 'playExtra' | 'back'
  /** A live home's monitor and channels (`live.home`): full watch, put on the monitor, flick ±1, tune in, sound, the guide. */
  | 'watch' | 'preview' | 'zap' | 'tuneIn' | 'unmute' | 'guide';

interface NodeBase {
  /** Overrides by viewport: `small` under 640 px, `wide` from 1200 px. */
  style?: Style; small?: Style; wide?: Style;
  /** Pointer hover and keyboard focus overlays (the renderer tracks both). */
  hover?: Style; focus?: Style;
  /** A group's hover or focus (`group: true` on an ancestor) applies `groupHover` here. */
  group?: boolean; groupHover?: Style;
  when?: Condition[];
  /** A motion preset by name (`motion` table), its delay staggered by the item index. */
  motion?: string; stagger?: { step: number; cap: number };
  role?: string; label?: Template; level?: number; testId?: Template;
  /** A box's element id (`detail-scroll-{env.entry}`: the route's scroll the navigation restores). */
  id?: Template;
}
export interface BoxNode extends NodeBase {
  type: 'box';
  /** Pressing it: `press` with an optional Template argument (`toggle` and `open`/`close` take a flag name). */
  press?: { action: Action; arg?: Template };
  children?: Node[];
}
export interface TextNode extends NodeBase { type: 'text'; text: Template }
export interface ImageNode extends NodeBase { type: 'image'; src: Template; alt?: Template; /** Fade in once loaded. */ fade?: boolean }
export interface IconNode extends NodeBase { type: 'icon'; symbol: string }
/** Repeat a template over a collection from the vocabulary (`home.rows`, `row.items`, `home.heroes`, `nav.destinations`). */
export interface RepeatNode extends NodeBase { type: 'repeat'; over: string; limit?: number; item: Node }
/** A template from the document's `templates`, inlined where it is used. */
export interface UseNode extends NodeBase { type: 'use'; template: string }
/** A foundation slot: `children` (the route content the shell wraps), `searchField`. */
export interface SlotNode extends NodeBase { type: 'slot'; slot: 'children' | 'searchField'; /** The inner box around the content (`style` is the outer). */ inner?: Style }
/** A compiled interactive part, styled by `params`: `skinPicker`, `install`, `heroPreview`, `cardPreview`. */
export interface WidgetNode extends NodeBase { type: 'widget'; widget: string; params?: Record<string, string> }
export type Node = BoxNode | TextNode | ImageNode | IconNode | RepeatNode | UseNode | SlotNode | WidgetNode;

export interface MotionPreset {
  /** A compiled keyframes name (docs/skin-schema.md lists them) or `none`. */
  keyframes: string; duration: number; delay?: number; easing?: string; fill?: 'none' | 'both' | 'forwards';
  iterations?: number | 'infinite'; direction?: 'normal' | 'alternate';
  /** What runs instead under reduced motion. */
  still?: { keyframes: string; duration: number };
}

export interface SkinFont { family: string; files: { url: string; weight: number; style: 'normal' | 'italic' }[]; sizeAdjust?: number }

export interface SkinDocument {
  schema: 1;
  /** The renderer version the document needs (the client's RENDERER_VERSION must be at least this). */
  renderer: number;
  id: string; name: string; version: string; tagline?: string;
  /** Same-origin `/vela/v0/appearance/` URLs. */
  preview?: string; swatches: string[];
  /** `$name` in any style value. Colours become CSS properties the theme sheet sets. */
  tokens?: Record<string, string>;
  /** `{s:key}` in any template, by locale (`en` is the fallback). */
  strings?: Record<string, Record<string, string>>;
  fonts?: Record<string, SkinFont>;
  motion?: Record<string, MotionPreset>;
  templates?: Record<string, Node>;
  /** One tree per foundation slot; a slot left out uses cinematic's compiled one. */
  slots: Partial<Record<'shell' | 'home' | 'row' | 'card' | 'status', Node>>;
  /** A tree per route the document draws whole (the route view); a route left out uses the slots, then cinematic. */
  routes?: Partial<Record<'home' | 'title' | 'collection' | 'library' | 'live' | 'watch', Node>>;
  /** `home: true` makes home a live surface: the guide's listings, clock and one preview tile run there (docs/skin-schema.md, "Live home"). */
  live?: { home?: boolean };
  /** Detail route presentation per viewport class. */
  detail?: { small?: 'fullscreen' | 'modal' | 'stack'; wide?: 'fullscreen' | 'modal' | 'stack'; split?: string };
}

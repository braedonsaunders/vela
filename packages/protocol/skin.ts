/**
 * Vela skin documents, schema 1: a whole skin as data. The client's one compiled
 * renderer (the "doc" engine) draws it; nothing in a document executes. See
 * docs/skin-schema.md for semantics, limits and the binding vocabulary.
 */
import type { ExperienceId, ExperienceOverride, SlotId } from './experiences';
import type { RichBlockName } from './rich-blocks';

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
  | 'border' | 'border-width' | 'border-style' | 'border-color' | 'border-radius' | 'corner-shape' | 'border-left-width' | 'border-left-color' | 'column-gap' | 'row-gap' | 'scroll-behavior' | 'scroll-padding-left' | 'color-scheme' | 'border-top-width' | 'border-top-color' | 'border-bottom-width' | 'border-bottom-color' | 'outline' | 'outline-offset' | 'box-shadow' | 'filter' | 'backdrop-filter' | 'mask-image'
  | 'font-family' | 'font-size' | 'font-weight' | 'font-style' | 'line-height' | 'letter-spacing' | 'text-transform'
  | 'text-align' | 'text-shadow' | '-webkit-text-stroke' | 'text-overflow' | 'line-clamp' | 'white-space' | 'font-variant-numeric'
  | 'object-fit' | 'transform-origin' | 'translate' | 'scale' | 'rotate' | 'perspective'
  | 'transition' | 'animation' | 'pointer-events' | 'cursor';

/** Renderer 20: the platform a variant applies on. Every device is exactly one: `tv` (Apple TV, Android TV
 * and Google TV), `ios` (iPhone and iPad), `android` (phones and tablets), `desktop` (the desktop app) or
 * `web` (a browser). */
export type Platform = 'ios' | 'android' | 'web' | 'desktop' | 'tv';

/** Renderer 20: an experience's form factor (its shell and whole-page variants). `tv` on a TV device;
 * `fold` on a foldable held partly open (book or tabletop, @vela/fold); `wide` in a window with room for
 * two panes (window-layout.ts: 980 px, or a landscape window of 840 px); `small` otherwise. */
export type FormFactor = 'small' | 'wide' | 'tv' | 'fold';

/** Renderer 20: the style of a rich block's part (`lyrics.activeLine`): a style, or layers with the
 * node's viewport, platform and interaction variants. */
export type PartStyle = Style | PartLayers;
export interface PartLayers {
  style?: Style; small?: Style; wide?: Style; tv?: Style; fold?: Style;
  platforms?: Partial<Record<Platform, Style>>;
  hover?: Style; focus?: Style; active?: Style;
}

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
  | 'select' | 'person' | 'play' | 'pickHero' | 'home' | 'search' | 'live' | 'library'
  | 'toggle' | 'open' | 'close' | 'reset' | 'openPicker' | 'switchProfile' | 'playlists' | 'addToPlaylist' | 'signOut' | 'moreRow' | 'playExtra' | 'back'
  /** A failed route asks again for what failed (`env.canRetry`). */
  | 'retry'
  /** Shell: open this flag alone, closing the others (keep- flags stay); pressed again it closes. */
  | 'only'
  /** The search input (widget searchInput): empty the query; focus the input (id vela-search). */
  | 'clearSearch' | 'focusSearch'
  /** Page a row's pager by one page (arg: the row id). */
  | 'pageNext' | 'pagePrev'
  /** A library page: sort by an option, flip the direction, filter name|value, load more titles. */
  | 'librarySort' | 'librarySortFlip' | 'libraryFilter' | 'libraryMore' | 'libraryView'
  /** Signed out (route auth): sign in with the fields; start or cancel a quick-connect code. */
  | 'signIn' | 'startQuick' | 'cancelQuick' | 'goSecure'
  /** A collection page: load its next titles. */
  | 'collectionMore' | 'personMore'
  /** A live home's monitor and channels (`live.home`): full watch, put on the monitor, flick ±1, tune in, sound, the guide. */
  | 'watch' | 'preview' | 'zap' | 'tuneIn' | 'unmute' | 'guide'
  /** Live TV multiview: add the channel (arg: its id) and show multiview; with no arg, show it as it is. */
  | 'multiview'
  /** Search (`routes.search`): open a live hit by its `hit.ref`; ask the descriptive lane again. */
  | 'searchLibrary' | 'searchSort' | 'searchDirection' | 'searchKind' | 'searchMore' | 'openHit' | 'retryDescriptive'
  /** Renderer 19, plugin screens and surfaces (docs/plugin-screens.md): structured `args`. */
  | 'navigate' | 'setParam' | 'plugin' | 'openLink' | 'dismiss';

interface NodeBase extends Breakpoints {
  /** Overrides by viewport: `small` under 640 px, `wide` from 1200 px, `tv` on a TV (renderer 19). */
  style?: Style; small?: Style; wide?: Style; tv?: Style;
  /** Renderer 20: on a foldable held partly open (env.fold), after `tv`. */
  fold?: Style;
  /** Renderer 20: a style overlay per platform, applied last (after small, wide, breakpoints, tv and fold). */
  platforms?: Partial<Record<Platform, Style>>;
  /** Renderer 19: play a motion preset when the filled value changes (a score pops). */
  onChange?: { value: Template; motion: string };
  /** Renderer 19, screens: lazy sources read when this node is about to draw. */
  needs?: string[];
  /** Pointer hover and keyboard focus overlays (the renderer tracks both). */
  hover?: Style; focus?: Style;
  /** A group's hover or focus (`group: true` on an ancestor) applies `groupHover` here; its keyboard focus `groupFocus`. */
  group?: boolean; groupHover?: Style; groupFocus?: Style;
  /** While pressed (pointer down), over the hover style: e.g. { scale: '0.97' } as a compiled control's press scale. */
  active?: Style;
  /** The first state whose conditions hold replaces `style` on the same element (transitions run). */
  states?: { when: Condition[]; style: Style; hover?: Style; focus?: Style; groupHover?: Style; groupFocus?: Style; /** The press button's name while this state holds. */ label?: Template }[];
  /** A pressable box: disabled while these hold, drawn with `disabledStyle`. */
  disabled?: Condition[]; disabledStyle?: Style;
  /** The press button's accessibility state and role. */
  a11y?: { expanded?: Condition[]; selected?: Condition[]; current?: Condition[]; pressed?: Condition[]; /** aria-checked (menu item radios and checkboxes). */ checked?: Condition[]; /** Decorative: hidden from assistive technology (aria-hidden). */ hidden?: boolean; haspopup?: string; title?: Template; role?: string };
  /** Escape clears this flag and moves focus to `returnFocus` (an element id). */
  escape?: string; returnFocus?: Template;
  layoutTransition?: string; /** Accepted and ignored for now (docs/skin-schema.md). */ sharedElement?: string;
  /** A motion preset played as the node leaves. */
  exit?: string;
  when?: Condition[];
  /** A motion preset by name (`motion` table), its delay staggered by the item index. */
  motion?: string; stagger?: { step: number; cap: number };
  role?: string; label?: Template; level?: number; testId?: Template;
  /** A box's element id (`detail-scroll-{env.entry}`: the route's scroll the navigation restores). */
  id?: Template;
}
/** A press: an action with a Template argument, or (renderer 19) named Template arguments. */
export interface Press {
  action: Action; arg?: Template; /** Focus this element id after the action. */ focus?: Template;
  args?: Record<string, Template>;
  /** Screens: a client-only patch applied until the plugin action answers. */
  optimistic?: { record?: Template; source?: string; path: string; value: Template };
}
export interface BoxNode extends NodeBase {
  type: 'box';
  /** Pressing it: `press` with an optional Template argument (`toggle` and `open`/`close` take a flag name). */
  press?: Press;
  /** A row's pager (inside a home row): this box scrolls sideways; `pageNext`/`pagePrev {row.id}` move it by
   *  max(200, width - 2 x inset - peek) px, and `pager.*` say whether it overflows and is at an end. */
  pager?: { inset?: number; peek?: number };
  /** A pressable box shows Exact's hover wash under its content (as a compiled button does) unless false. */
  controlStates?: boolean;
  /** Renderer 17, in the shell: a navigation row kept to one line in the room its parent box gives it (the
   *  parent's width, so give the row a parent whose width does not follow it). The renderer measures every
   *  child of the row, a repeat's items one by one; the destinations (children pressing home, library or live)
   *  that do not fit beside the others leave from the row's end, last first, and Home always stays. Then
   *  `nav.more` holds (draw a More control in the row on it: it is measured as if shown), `dest.more` holds for
   *  each library left out, `nav.liveMore` for Live TV, and `nav.moreOn` while the current section is one of them. */
  fit?: 'nav';
  /** Renderer 18: on TV this box, which presses nothing, still takes focus (wearing the focus ring) so the
   *  remote reaches it and a screen reader reads it as one passage, by its `label` or else its text: a menu's
   *  About line below its last control. Elsewhere it is an ordinary box (its text selectable on the web). */
  readingStop?: boolean;
  children?: Node[];
}
/** A text. One that is exactly `{env.viewerInitial}` and sets its own width and height is the viewer's
 * badge: the renderer draws the viewer's avatar over it, clipped to its shape, where the server gives one. */
export interface TextNode extends NodeBase { type: 'text'; text: Template }
/** Breakpoints at the document's own widths, evaluated against the slot's width. */
export interface Breakpoints { below?: Record<string, Style>; above?: Record<string, Style> }
export interface ImageNode extends NodeBase { type: 'image'; src: Template; alt?: Template; /** Fade in once loaded. */ fade?: boolean;
  /** Renderer 19: drawn instead when the source is empty, refused or fails to load. */ fallback?: Node }
export interface IconNode extends NodeBase { type: 'icon'; /** A platform symbol, */ symbol?: string; /** or the document's own glyph: SVG path data (up to 8) painted in currentColor. */ paths?: string[]; viewBox?: string; fillRule?: 'nonzero' | 'evenodd' }
/** Repeat a template over a collection from the vocabulary (`home.rows`, `row.items`, `home.heroes`, `nav.destinations`). */
export interface RepeatNode extends NodeBase { type: 'repeat'; over: string; limit?: number; item: Node;
  /** Renderer 19 (screens): the item's name (`{game.sides.0.score}`), an offset, a record key left out
   *  before `limit`, an identity template, and a time filter (only items whose `at` <= `time`). */
  as?: string; skip?: number; exclude?: Template; key?: Template; asOf?: { at: string; time: Template } }
/** A template from the document's `templates`, inlined where it is used.
 * Renderer 16 supplies velaSummary: an overflow-measured, expandable title synopsis. */
export interface UseNode extends NodeBase { type: 'use'; template: string;
  /** Renderer 19: arguments read as `{arg.<name>}` in the template; children fill its `children` slot. */
  with?: Record<string, Template>; children?: Node[]; press?: Press }
/** A foundation slot: `children` (the route content the shell wraps), `searchField`; or (renderer 20, in a
 * built-in page) a published plugin slot, `plugin:<slot id>` (experiences.ts SLOTS), where the slot
 * surfaces plugins contribute draw, each in its own box. */
export interface SlotNode extends NodeBase { type: 'slot'; slot: 'children' | 'searchField' | PluginSlot; /** The inner box around the content (`style` is the outer). */ inner?: Style;
  /** A plugin slot: the `{context.<name>}` values its surfaces read (the slot's published context names only). */
  context?: Record<string, Template>;
  /** A plugin slot: at most this many surfaces (within the slot's cap). */
  limit?: number }
/** A published plugin slot as a slot node names it. */
export type PluginSlot = `plugin:${SlotId}`;
/** A compiled interactive part, styled by `params`: `skinPicker`, `install`, `heroPreview`, `cardPreview`. */
/** Widgets: `install`, `observe`, `liveTile`; `searchInput` (params placeholder, label, placeholderColor; its node style sets the
 *  text's colour and font) within 3 levels of home or the shell; `sentinel` (params.on: `row` | `home` | `library`) asks for
 *  the next page; `select` (params options: library.genres | library.sorts | library.kinds, action, arg with {value},
 *  none: a leading empty option's label, label) is the platform select styled by its node. */
export interface WidgetNode extends NodeBase { type: 'widget'; widget: string; params?: Record<string, string> }
/** A value per viewport class (renderer 19 blocks). */
export type PerClass<T> = T | { default: T; small?: T; wide?: T; tv?: T };
/** Every block node (renderer 20): `fallback` is drawn when the client does not know the block, or when
 * the block cannot run here (the visualizer where env.canVisualize is false). */
interface BlockBase extends NodeBase { fallback?: Node }
interface ItemsBase extends BlockBase { over: string; as: string; item: Node; key?: Template; exclude?: Template; limit?: number }
/** Renderer 19 blocks (docs/plugin-screens.md: Building blocks). */
export interface SectionsNode extends BlockBase { type: 'sections'; children: Node[]; gap?: string }
export interface ShelfNode extends ItemsBase { type: 'shelf'; itemWidth?: PerClass<string>; gap?: string; stableOrder?: boolean; empty?: Node }
export interface GridNode extends ItemsBase { type: 'grid'; columns: PerClass<number>; gap?: string }
export interface TabsNode extends BlockBase { type: 'tabs'; over: string; as: string; value: Template; label: Template; count?: Template;
  bind: { param?: string; state?: string; clear?: string[] }; default?: Template; all?: Template; chip?: string; size?: 'small';
  /** Nodes drawn after the options inside the same scroll and focus row (Sports' Hide scores switch). */ after?: Node[];
  /** With `bind.param`: on first draw an empty param takes the resolved `default` (history replace, no re-read), so a later
   *  change of the default does not move the selection. */ pin?: boolean }
export interface TableNode extends BlockBase { type: 'table'; data: string; compact?: boolean; focusRows?: number;
  /** false: ignore rows' `highlight` (a game's own tables are not lit, as standings are). Default true. */ highlight?: boolean }
export interface LineGraphNode extends BlockBase { type: 'lineGraph'; series: string; sides?: string; subject?: Template; live?: Template; height?: PerClass<string> }
/** With `channel`: one muted live preview of a channel (renderer 19). Without (renderer 20): the rich
 * playback player, its props and parts in rich-blocks.ts. */
export interface PlayerNode extends RichBase { type: 'player'; channel?: Template }
/** Renderer 20: a rich native block (rich-blocks.ts lists each one's props, parts and part templates).
 * The engine, focus and timing stay native; a document styles its published parts and replaces the
 * part templates the block allows (a template reads `{item.*}`, the block's state as `{part.*}`). */
interface RichBase extends BlockBase {
  /** The block's props (rich-blocks.ts), as Templates; a single hole passes its raw value. */
  props?: Record<string, Template>;
  /** Part styles by part name (`trackTable.activeRow`), over the document's `parts`. */
  parts?: Record<string, PartStyle>;
  /** Part templates by part name (`queue.row`), over a document template of that name. */
  partTemplates?: Record<string, Node>;
}
export interface RichNode extends RichBase { type: Exclude<RichBlockName, 'player' | 'visualizer'> }
/** Renderer 20: the music visualizer (its engine is the app's). Without the capability (env.canVisualize
 * false) it draws its `fallback`. Parts: visualizer.scenePicker, sceneChip, sceneChipActive, caption. */
export interface VisualizerNode extends RichBase { type: 'visualizer'; mode: 'background' | 'fullscreen'; sceneId?: Template }
export interface ParamInputNode extends BlockBase { type: 'paramInput'; param: string; placeholder?: Template }
export interface TitleCardNode extends BlockBase { type: 'titleCard'; item: Template }
export interface MarqueeNode extends ItemsBase { type: 'marquee'; gap?: string; speed?: number }
export type BlockNode = SectionsNode | ShelfNode | GridNode | TabsNode | TableNode | LineGraphNode | PlayerNode | ParamInputNode | TitleCardNode | MarqueeNode
  | RichNode | VisualizerNode;
export type Node = BoxNode | TextNode | ImageNode | IconNode | RepeatNode | UseNode | SlotNode | WidgetNode | BlockNode;

export interface MotionPreset {
  /** A compiled keyframes name (docs/skin-schema.md lists them) or `none`. */
  keyframes: string; duration: number; delay?: number; easing?: string; fill?: 'none' | 'both' | 'forwards';
  iterations?: number | 'infinite'; direction?: 'normal' | 'alternate';
  /** What runs instead under reduced motion. */
  still?: { keyframes: string; duration: number };
}

export interface SkinFont { family: string; /** weight: a number, or a range "300 700" for a variable face. */ files: { url: string; weight: number | string; style: 'normal' | 'italic' }[]; sizeAdjust?: number }

/** The keys of a document's `ui` block (packages/skin/src/resolve/ui-defaults.ts holds Cinematic's values). */
export type UiName = 'page' | 'raised' | 'ink' | 'inkSecondary' | 'inkQuiet' | 'inkInverse' | 'inkHover' | 'accent' | 'onAccent'
  | 'control' | 'controlHover' | 'glass' | 'glassEdge' | 'glassEdgeStrong' | 'popover' | 'scrim' | 'track' | 'trackStrong'
  | 'focusHalo' | 'shadow' | 'skeleton' | 'skeletonLight' | 'alert' | 'live' | 'highlight' | 'positive' | 'font' | 'fontDisplay'
  | 'radiusControl' | 'radiusCard' | 'radiusPanel';

export interface SkinDocument {
  schema: 1;
  /** The renderer version the document needs (the client's RENDERER_VERSION must be at least this). */
  renderer: number;
  id: string; name: string; version: string; tagline?: string;
  /** Same-origin `/vela/v0/appearance/` URLs. */
  preview?: string; swatches: string[];
  /** `$name` in any style value. Colours become CSS properties the theme sheet sets. */
  tokens?: Record<string, string>;
  /** Renderer 15: the look of the Vela base (the built-in routes the document inherits), read as
   *  `$ui.<name>` in any style. Colours, the two font stacks (`font`, `fontDisplay`) and radii in px
   *  (`radiusControl`, `radiusCard`, `radiusPanel`); a key left out takes Cinematic's value. */
  ui?: Partial<Record<UiName, string | number>>;
  /** `{s:key}` in any template, by locale (`en` is the fallback). */
  strings?: Record<string, Record<string, string>>;
  fonts?: Record<string, SkinFont>;
  motion?: Record<string, MotionPreset>;
  /** The document's own keyframes (`keyframes: "doc:<name>"` in a preset): opacity, translate (px/%), scale, rotate (deg). */
  keyframes?: Record<string, Record<string, { opacity?: number; translate?: string; scale?: number; rotate?: number }>>;
  templates?: Record<string, Node>;
  /** One tree per foundation slot; a slot left out is the Vela base's (renderer 15). */
  slots?: Partial<Record<'shell' | 'home' | 'row' | 'card' | 'status', Node>>;
  /** A tree per route the document draws whole (the route view); a route left out is the Vela base's.
   *  `search` is drawn in home's view, after home's nodes, while a query is open. */
  routes?: Partial<Record<'home' | 'search' | 'title' | 'person' | 'collection' | 'library' | 'live' | 'watch' | 'auth', Node>>;
  /** Renderer 20: overrides of the built-in experiences (`listen`), merged over Vela's page documents:
   *  whole pages, templates (a part's template by the part's name), part styles and the shell per form
   *  factor. Whatever is left out stays Vela's. */
  experiences?: Record<ExperienceId, ExperienceOverride>;
  /** `home: true` makes home a live surface: the guide's listings, clock and one preview tile run there (docs/skin-schema.md). */
  live?: { home?: boolean };
  /** Detail route presentation per viewport class. */
  /** The title page's presentation below and from `from` px (default 640), and the home pane width in px it splits beside it from there. */
  /** How the foundation frames the document's pages: home fades under a floating bar; home, libraries and Live TV pan sideways. */
  traits?: { barMask?: boolean; panSections?: boolean; /** Where a section page's content starts below the shell's navigation (CSS lengths; '0px' when the nav is in flow). Resolved by the renderer, never authored. */ headerInset?: { wide: string; small: string }; /** The page and ink colours behind every screen (cold start and splash included). */ page?: string; ink?: string; /** The launch splash stands on paper (a light ground). */ splashOnPaper?: boolean };
  /** The document draws its pages' loading and failure states itself (home and routes, from env.load, env.canRetry and
   *  the retry action); without it the foundation's status screen shows while home loads or fails. */
  status?: boolean;
  detail?: { from?: number; small?: 'fullscreen' | 'modal' | 'stack'; wide?: 'fullscreen' | 'modal' | 'stack'; split?: string;
    /** A framed title page's surround, drawn behind the document's frame over home: scrim colour (default media.overlay),
     *  backdrop blur (default 'blur(18px) saturate(1.1)'), or flat: no scrim (a full-page title). */
    frame?: { scrim?: string; blur?: string; flat?: boolean } };
}

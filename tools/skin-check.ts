/**
 * Check a skin or page document (docs/skin-schema.md, docs/plugin-screens.md, docs/experiences.md):
 * resolve it as the React renderer does (packages/skin/src/resolve.ts, resolve/screen.ts) at a
 * desktop, a phone and a TV width, and report its schema, limits, literal colours, tokens, icons,
 * actions, slots, budgets and style matrix portability (in human-readable form or `--json`).
 *
 *   bun tools/skin.ts check [--json] <document.ts | document.json>
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { RENDERER_VERSION, resolveDocument, type ResolvedDocument, type RNode } from '../packages/skin/src/resolve';
import { BUDGETS, type Finding, type PageCost } from '../packages/skin/src/resolve/budget';
import { perfReport, treesReport } from './skin-budget';
import {
  checkExperienceOverrides,
  heldColours,
  resolveScreenDocument,
  SCREEN_CAPABILITIES,
  screenTrees,
  velaUseProblems,
  type OverrideFinding,
  type ResolvedScreen,
  type ScreenViewport,
} from '../packages/skin/src/resolve/screen';
import { experiencePages } from '../packages/skin/src/resolve/builtin';
import { SCREEN_LIMITS, type ScreenDocument } from '../packages/protocol/screen';
import { VELA_ACTIONS } from '../packages/protocol/vela-sources';
import { SYMBOLS } from '../packages/skin/src/icons';
import { portabilityReport, type PortabilityFinding } from '../packages/skin/src/resolve/portability';
import { uiDefaults } from '../packages/skin/src/resolve/ui-defaults';
import { VELA_DOCUMENT_SCHEMA_DIGEST } from '../packages/skin/src/resolve/screen-schema-digest';
import { parseColour } from '../packages/skin/src/screen/colour';
import { validate } from './screen-schema';
import type { SkinDocument } from '../packages/protocol/skin';

const WIDTHS = [1440, 390, 1920];
/** The viewports a screen document is checked at: a desktop, a phone and a TV. */
const SCREEN_VIEWPORTS: (ScreenViewport & { name: string })[] = [
  { width: 1440, height: 900, platform: 'web', name: 'desktop' },
  { width: 390, height: 844, platform: 'ios', name: 'phone' },
  { width: 1920, height: 1080, tv: true, scale: 1.25, platform: 'tv', name: 'tv' },
];

const UI_KEYS = new Set(Object.keys(uiDefaults));
const VALID_ACTIONS = new Set([
  'select', 'person', 'play', 'pickHero', 'home', 'search', 'live', 'library',
  'toggle', 'open', 'close', 'reset', 'openPicker', 'switchProfile', 'playlists', 'manageLibraries', 'addToPlaylist', 'signOut', 'moreRow', 'playExtra', 'back',
  'retry', 'only', 'clearSearch', 'focusSearch', 'pageNext', 'pagePrev',
  'librarySort', 'librarySortFlip', 'libraryFilter', 'libraryMore', 'libraryView',
  'signIn', 'startQuick', 'cancelQuick', 'goSecure', 'collectionMore', 'personMore',
  'watch', 'preview', 'zap', 'tuneIn', 'unmute', 'guide', 'multiview',
  'searchLibrary', 'searchSort', 'searchDirection', 'searchKind', 'searchMore', 'openHit', 'retryDescriptive',
  'navigate', 'setParam', 'plugin', 'openLink', 'dismiss',
]);
const STYLE_KEYS = new Set(['style', 'small', 'wide', 'tv', 'fold', 'hover', 'focus', 'groupHover', 'groupFocus', 'active', 'disabledStyle', 'inner']);

export interface DocumentFinding {
  level: 'error' | 'warning';
  code: string;
  at: string;
  message: string;
}

export interface ViewportBudgetReport {
  viewport: string;
  width: number;
  tv?: boolean;
  pages: PageCost[];
  findings: Finding[];
  warnings?: string[];
  error?: string;
}

export interface DocumentCheckReport {
  ok: boolean;
  kind: 'skin' | 'screen';
  id: string;
  renderer: number;
  owner?: 'vela' | 'plugin';
  experience?: string;
  screen?: string;
  page?: string;
  presentation?: string;
  schema: {
    valid: boolean;
    schema: number;
    renderer: number;
    maxRenderer: number;
    digest?: string;
    errors: string[];
  };
  limits: {
    valid: boolean;
    bytes: number;
    maxBytes: number;
    nodes: number;
    maxNodes: number;
    depth: number;
    maxDepth: number;
    longestString: number;
    maxStringLength: number;
    paletteColours: number;
    maxPaletteColours: number;
    errors: string[];
  };
  literalColours: {
    valid: boolean;
    palette: string[];
    swatches: string[];
    refused: { at: string; colour: string }[];
    errors: string[];
    warnings: string[];
  };
  tokens: {
    valid: boolean;
    declared: string[];
    uiDeclared: string[];
    used: string[];
    uiUsed: string[];
    paletteUsed: string[];
    unknown: string[];
    errors: string[];
  };
  icons: {
    valid: boolean;
    used: string[];
    unknown: string[];
    errors: string[];
  };
  actions: {
    valid: boolean;
    declared: string[];
    used: string[];
    pluginUsed: string[];
    unknown: string[];
    undeclaredPlugin: string[];
    velaUseErrors?: string[];
    errors: string[];
  };
  slots: {
    valid: boolean;
    declared: string[];
    used: string[];
    experiences: string[];
    experienceOverrides?: OverrideFinding[];
    presentationSlot?: string;
    unknown: string[];
    errors: string[];
  };
  budgets: {
    valid: boolean;
    limits: typeof BUDGETS;
    viewports: ViewportBudgetReport[];
    portability: PortabilityFinding[];
    errors: string[];
    warnings: string[];
  };
  findings: DocumentFinding[];
  errors: string[];
  warnings: string[];
}

export async function loadDocument(path: string): Promise<SkinDocument | ScreenDocument> {
  if (path.endsWith('.json')) return JSON.parse(await readFile(path, 'utf8')) as SkinDocument | ScreenDocument;
  // Append a cache-busting query if re-importing in long-lived watch processes (`skin.ts serve`).
  const mod = await import(`${resolve(path)}?t=${Date.now()}`) as Record<string, unknown>;
  return (mod.default ?? Object.values(mod).find(v => v && typeof v === 'object' && 'schema' in (v as object))) as SkinDocument | ScreenDocument;
}

let cachedScreenSchema: Record<string, unknown> | null = null;
async function getScreenSchema(): Promise<Record<string, unknown> | null> {
  if (cachedScreenSchema) return cachedScreenSchema;
  const root = resolve(import.meta.dir, '..');
  for (const name of ['vela-document.v1.json', 'plugin-screen.v1.json']) {
    try {
      const text = await readFile(join(root, 'packages/protocol/schemas', name), 'utf8');
      cachedScreenSchema = JSON.parse(text) as Record<string, unknown>;
      return cachedScreenSchema;
    } catch {
      // try next
    }
  }
  return null;
}

function longestString(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce((n: number, v) => Math.max(n, longestString(v)), 0);
  if (value && typeof value === 'object') return Object.entries(value).reduce((n: number, [k, v]) => Math.max(n, k.length, longestString(v)), 0);
  return 0;
}

function measureTreeDepth(value: unknown, depth = 1): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const node = value as Record<string, unknown>;
  if (typeof node.type !== 'string') return 0;
  let max = depth;
  if (Array.isArray(node.children)) {
    for (const child of node.children) max = Math.max(max, measureTreeDepth(child, depth + 1));
  }
  if (Array.isArray(node.after)) {
    for (const child of node.after) max = Math.max(max, measureTreeDepth(child, depth + 1));
  }
  for (const key of ['item', 'fallback', 'empty']) {
    if (node[key] && typeof node[key] === 'object') max = Math.max(max, measureTreeDepth(node[key], depth + 1));
  }
  return max;
}

interface RawScan {
  tokensUsed: Set<string>;
  uiUsed: Set<string>;
  paletteUsed: Set<string>;
  iconsUsed: Set<string>;
  actionsUsed: Set<string>;
  pluginActionsUsed: Set<string>;
  slotsUsed: Set<string>;
  refusedLiterals: { at: string; colour: string }[];
  maxDepth: number;
}

function scanStyleString(text: string, at: string, isScreen: boolean, out: RawScan): void {
  for (const m of text.matchAll(/\$ui\.([A-Za-z0-9_-]+)/g)) out.uiUsed.add(m[1]!);
  for (const m of text.matchAll(/\$palette\.([A-Za-z0-9_-]+)/g)) out.paletteUsed.add(m[1]!);
  const stripped = text.replace(/\$ui\.[A-Za-z0-9_-]+|\$palette\.[A-Za-z0-9_-]+/g, '');
  for (const m of stripped.matchAll(/\$([A-Za-z0-9_-]+)/g)) out.tokensUsed.add(m[1]!);
  if (isScreen) {
    heldColours(text, colour => out.refusedLiterals.push({ at, colour }));
  }
}

function scanRawNode(node: unknown, at: string, isScreen: boolean, out: RawScan, depth = 1): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.type === 'string') out.maxDepth = Math.max(out.maxDepth, depth);
  if (obj.type === 'icon' && typeof obj.symbol === 'string' && !obj.symbol.includes('{')) {
    out.iconsUsed.add(obj.symbol);
  }
  if (obj.type === 'slot' && typeof obj.slot === 'string') {
    out.slotsUsed.add(obj.slot);
  }
  if (obj.press && typeof obj.press === 'object') {
    const press = obj.press as Record<string, unknown>;
    if (typeof press.action === 'string') {
      out.actionsUsed.add(press.action);
      if (press.action === 'plugin' && press.args && typeof press.args === 'object') {
        const name = (press.args as Record<string, unknown>).name;
        if (typeof name === 'string' && !name.includes('{')) out.pluginActionsUsed.add(name);
      }
    }
  }
  for (const [key, value] of Object.entries(obj)) {
    if (!value) continue;
    const path = `${at}.${key}`;
    if (STYLE_KEYS.has(key) && typeof value === 'object' && !Array.isArray(value)) {
      for (const [row, raw] of Object.entries(value as Record<string, unknown>)) {
        if (typeof raw === 'string') scanStyleString(raw, `${path}.${row}`, isScreen, out);
      }
    } else if ((key === 'below' || key === 'above' || key === 'platforms') && typeof value === 'object' && !Array.isArray(value)) {
      for (const [px, style] of Object.entries(value as Record<string, unknown>)) {
        if (style && typeof style === 'object') {
          for (const [row, raw] of Object.entries(style as Record<string, unknown>)) {
            if (typeof raw === 'string') scanStyleString(raw, `${path}.${px}.${row}`, isScreen, out);
          }
        }
      }
    } else if (key === 'with' && typeof value === 'object' && !Array.isArray(value)) {
      for (const [argName, raw] of Object.entries(value as Record<string, unknown>)) {
        if (typeof raw === 'string') {
          if (argName === 'glyph' && !raw.includes('{')) out.iconsUsed.add(raw);
          if (raw.includes('$') || (isScreen && parseColour(raw))) {
            scanStyleString(raw, `${path}.${argName}`, isScreen, out);
          }
        }
      }
    } else if (key === 'params' && typeof value === 'object' && !Array.isArray(value)) {
      for (const [pName, raw] of Object.entries(value as Record<string, unknown>)) {
        if (typeof raw === 'string' && raw.includes('$')) scanStyleString(raw, `${path}.${pName}`, isScreen, out);
      }
    } else if (key === 'states' && Array.isArray(value)) {
      value.forEach((st, i) => scanRawNode(st, `${path}[${i}]`, isScreen, out, depth));
    } else if ((key === 'children' || key === 'after') && Array.isArray(value)) {
      value.forEach((child, i) => scanRawNode(child, `${path}[${i}]`, isScreen, out, depth + 1));
    } else if (key === 'item' || key === 'fallback' || key === 'empty') {
      scanRawNode(value, path, isScreen, out, depth + 1);
    }
  }
}

/** Icon symbols the trees name that the renderer has no geometry for: they would draw nothing. */
function unknownSymbols(trees: RNode[]): string[] {
  const missing = new Set<string>();
  const walk = (node: RNode) => {
    if (node.kind === 'icon' && node.symbol && !node.paths && !SYMBOLS[node.symbol]) missing.add(node.symbol);
    if (node.kind === 'box' || node.kind === 'sections') node.children.forEach(walk);
    if (node.kind === 'repeat' || node.kind === 'shelf' || node.kind === 'grid' || node.kind === 'marquee') walk(node.item);
    if (node.kind === 'shelf' && node.empty) walk(node.empty);
    if (node.kind === 'tabs') { walk(node.chip); node.after?.forEach(walk); }
    if (node.kind === 'image' && node.fallback) walk(node.fallback);
  };
  trees.forEach(walk);
  return [...missing].sort();
}

function usedSymbolsInTrees(trees: RNode[]): string[] {
  const used = new Set<string>();
  const walk = (node: RNode) => {
    if (node.kind === 'icon' && node.symbol) used.add(node.symbol);
    if (node.kind === 'box' || node.kind === 'sections') node.children.forEach(walk);
    if (node.kind === 'repeat' || node.kind === 'shelf' || node.kind === 'grid' || node.kind === 'marquee') walk(node.item);
    if (node.kind === 'shelf' && node.empty) walk(node.empty);
    if (node.kind === 'tabs') { walk(node.chip); node.after?.forEach(walk); }
    if (node.kind === 'image' && node.fallback) walk(node.fallback);
  };
  trees.forEach(walk);
  return [...used].sort();
}

function skinTrees(resolved: ResolvedDocument): RNode[] {
  return [...(resolved.shell ? [resolved.shell] : []), ...Object.values(resolved.routes).filter((t): t is RNode => !!t)];
}

/**
 * Analyze a loaded SkinDocument or ScreenDocument and produce a complete machine-readable
 * validator report (schema, limits, literalColours, tokens, icons, actions, slots, budgets).
 */
export async function analyzeLoadedDocument(loaded: SkinDocument | ScreenDocument): Promise<DocumentCheckReport> {
  const isScreen = (loaded as ScreenDocument).kind === 'screen';
  const findings: DocumentFinding[] = [];
  const addFinding = (level: 'error' | 'warning', code: string, at: string, message: string) => {
    findings.push({ level, code, at, message });
  };

  const scan: RawScan = {
    tokensUsed: new Set(),
    uiUsed: new Set(),
    paletteUsed: new Set(),
    iconsUsed: new Set(),
    actionsUsed: new Set(),
    pluginActionsUsed: new Set(),
    slotsUsed: new Set(),
    refusedLiterals: [],
    maxDepth: 0,
  };

  const bytes = new TextEncoder().encode(JSON.stringify(loaded)).length;
  const longest = longestString(loaded);

  if (isScreen) {
    const doc = loaded as ScreenDocument & { owner?: 'vela' | 'plugin'; experience?: string };
    const id = `${doc.screen}/${doc.page}`;

    // 1. Schema check
    const schemaErrors: string[] = [];
    const schemaObj = await getScreenSchema();
    if (schemaObj) {
      for (const err of validate(schemaObj, doc)) {
        schemaErrors.push(err);
        addFinding('error', 'schema', err.split(':')[0] || '/', err);
      }
    }
    if (doc.schema !== 1) {
      const msg = `Screen document schema ${String(doc.schema)} is not supported`;
      schemaErrors.push(msg);
      addFinding('error', 'schema', '/schema', msg);
    }
    if (typeof doc.renderer !== 'number' || doc.renderer < 19 || doc.renderer > RENDERER_VERSION) {
      const msg = doc.renderer > RENDERER_VERSION
        ? `${id} needs renderer ${doc.renderer}; this client draws ${RENDERER_VERSION}`
        : `${id}: a screen document needs renderer 19 or more`;
      schemaErrors.push(msg);
      addFinding('error', 'schema', '/renderer', msg);
    }
    for (const needed of doc.requires ?? []) {
      if (!SCREEN_CAPABILITIES.has(needed)) {
        const msg = `${id} needs ${needed}, which this client does not draw`;
        schemaErrors.push(msg);
        addFinding('error', 'schema', '/requires', msg);
      }
    }

    // Scan raw trees & templates & tokens
    for (const [tName, raw] of Object.entries(doc.tokens ?? {})) {
      if (typeof raw === 'string') scanStyleString(raw, `tokens.${tName}`, true, scan);
    }
    for (const [tName, tNode] of Object.entries(doc.templates ?? {})) {
      scanRawNode(tNode, `templates.${tName}`, true, scan, 1);
    }
    if (doc.tree) scanRawNode(doc.tree, 'tree', true, scan, 1);
    for (const [fName, fNode] of Object.entries(doc.forms ?? {})) {
      scanRawNode(fNode, `forms.${fName}`, true, scan, 1);
    }
    for (const [pName, pNode] of Object.entries(doc.platforms ?? {})) {
      scanRawNode(pNode, `platforms.${pName}`, true, scan, 1);
    }
    if (doc.loading) scanRawNode(doc.loading, 'loading', true, scan, 1);
    if (doc.failure) scanRawNode(doc.failure, 'failure', true, scan, 1);

    const maxTreeDepth = Math.max(
      doc.tree ? measureTreeDepth(doc.tree) : 0,
      ...Object.values(doc.forms ?? {}).map(n => measureTreeDepth(n)),
      ...Object.values(doc.platforms ?? {}).map(n => measureTreeDepth(n)),
      doc.loading ? measureTreeDepth(doc.loading) : 0,
      doc.failure ? measureTreeDepth(doc.failure) : 0,
    );

    // 2. Budgets & Viewport Resolution
    const viewports: ViewportBudgetReport[] = [];
    const budgetErrors: string[] = [];
    const budgetWarnings: string[] = [];
    let resolvedFirst: ResolvedScreen | undefined;
    let maxNodes = 0;

    for (const viewport of SCREEN_VIEWPORTS) {
      let model: ResolvedScreen;
      try {
        model = resolveScreenDocument(doc, viewport, 'en', {});
      } catch (e) {
        const msg = (e as Error).message;
        viewports.push({ viewport: viewport.name, width: viewport.width, tv: viewport.tv, pages: [], findings: [], error: msg });
        budgetErrors.push(`${viewport.name}: refused: ${msg}`);
        addFinding('error', 'resolve', viewport.name, `${viewport.name}: refused: ${msg}`);
        continue;
      }
      resolvedFirst ??= model;
      const report = treesReport(screenTrees(model));
      for (const p of report.pages) maxNodes = Math.max(maxNodes, p.nodes);
      for (const f of report.findings) {
        if (f.level === 'error') {
          budgetErrors.push(`${viewport.name} ${f.route}: ${f.message}`);
          addFinding('error', 'budget', `${viewport.name}.${f.route}`, f.message);
        } else {
          budgetWarnings.push(`${viewport.name} ${f.route}: ${f.message}`);
          addFinding('warning', 'budget', `${viewport.name}.${f.route}`, f.message);
        }
      }
      for (const w of model.warnings) {
        budgetWarnings.push(`${viewport.name}: ${w}`);
        addFinding('warning', 'resolve', viewport.name, w);
      }
      viewports.push({
        viewport: viewport.name,
        width: viewport.width,
        tv: viewport.tv,
        pages: report.pages,
        findings: report.findings,
        warnings: model.warnings,
      });
    }

    // 3. Limits
    const limitErrors: string[] = [];
    const paletteEntries = Object.entries(doc.palette ?? {});
    if (bytes > SCREEN_LIMITS.documentBytes) {
      const msg = `${id} is ${bytes} bytes; a screen document is at most ${SCREEN_LIMITS.documentBytes}`;
      limitErrors.push(msg);
      addFinding('error', 'limits', '/bytes', msg);
    }
    if (longest > SCREEN_LIMITS.stringLength) {
      const msg = `${id} has a string of ${longest} characters; at most ${SCREEN_LIMITS.stringLength}`;
      limitErrors.push(msg);
      addFinding('error', 'limits', '/stringLength', msg);
    }
    if (paletteEntries.length > SCREEN_LIMITS.paletteColours) {
      const msg = `${id} has ${paletteEntries.length} palette colours; at most ${SCREEN_LIMITS.paletteColours}`;
      limitErrors.push(msg);
      addFinding('error', 'limits', '/palette', msg);
    }
    if (maxNodes > SCREEN_LIMITS.nodes) {
      const msg = `${id} draws ${maxNodes} nodes; at most ${SCREEN_LIMITS.nodes}`;
      limitErrors.push(msg);
      addFinding('error', 'limits', '/nodes', msg);
    }
    if (maxTreeDepth > SCREEN_LIMITS.depth) {
      const msg = `${id} nests ${maxTreeDepth} deep; at most ${SCREEN_LIMITS.depth}`;
      limitErrors.push(msg);
      addFinding('error', 'limits', '/depth', msg);
    }

    // 4. Literal colours
    const colourErrors: string[] = [];
    const colourWarnings: string[] = [];
    for (const [key, colour] of paletteEntries) {
      if (!parseColour(colour)) {
        const msg = `${id}: $palette.${key} is not a colour (${colour})`;
        colourErrors.push(msg);
        addFinding('error', 'literalColours', `palette.${key}`, msg);
      }
    }
    for (const ref of scan.refusedLiterals) {
      const msg = `Literal colour ${ref.colour} at ${ref.at} drawn as transparent: a screen writes white, black, its palette or $ui`;
      colourWarnings.push(msg);
      addFinding('warning', 'literalColours', ref.at, msg);
    }

    // 5. Tokens
    const declaredTokens = Object.keys(doc.tokens ?? {}).sort();
    const declaredTokenSet = new Set(declaredTokens);
    const paletteSet = new Set(Object.keys(doc.palette ?? {}));
    const unknownTokens: string[] = [];
    const tokenErrors: string[] = [];
    for (const t of scan.tokensUsed) {
      if (!declaredTokenSet.has(t)) {
        unknownTokens.push(`$${t}`);
        const msg = `Unknown token $${t}`;
        tokenErrors.push(msg);
        addFinding('error', 'tokens', 'tokens', msg);
      }
    }
    for (const u of scan.uiUsed) {
      if (!UI_KEYS.has(u)) {
        unknownTokens.push(`$ui.${u}`);
        const msg = `Unknown UI token $ui.${u}`;
        tokenErrors.push(msg);
        addFinding('error', 'tokens', 'ui', msg);
      }
    }
    for (const p of scan.paletteUsed) {
      if (!paletteSet.has(p)) {
        unknownTokens.push(`$palette.${p}`);
        const msg = `Unknown palette colour $palette.${p}`;
        tokenErrors.push(msg);
        addFinding('error', 'tokens', 'palette', msg);
      }
    }

    // 6. Icons
    const resolvedTrees = resolvedFirst ? screenTrees(resolvedFirst).map(([, t]) => t) : [];
    const missingIcons = resolvedFirst ? unknownSymbols(resolvedTrees) : [...scan.iconsUsed].filter(s => !SYMBOLS[s]).sort();
    const allUsedIcons = [...new Set([...scan.iconsUsed, ...usedSymbolsInTrees(resolvedTrees)])].sort();
    const iconErrors: string[] = [];
    if (missingIcons.length) {
      const msg = `icon symbols the renderer cannot draw: ${missingIcons.join(', ')}`;
      iconErrors.push(msg);
      addFinding('error', 'icons', 'icons', msg);
    }

    // 7. Actions & vela.* rules (velaUseProblems)
    const declaredActions = Object.keys(doc.actions ?? {}).sort();
    const declaredActionSet = new Set(declaredActions);
    const unknownActions = [...scan.actionsUsed].filter(a => !VALID_ACTIONS.has(a)).sort();
    const undeclaredPlugin = [...scan.pluginActionsUsed]
      .filter(a => !declaredActionSet.has(a) && !(doc.owner === 'vela' && a in VELA_ACTIONS))
      .sort();
    const velaProblems = velaUseProblems(doc);
    const actionErrors: string[] = [];
    for (const a of unknownActions) {
      const msg = `Unknown press action ${a}`;
      actionErrors.push(msg);
      addFinding('error', 'actions', 'actions', msg);
    }
    for (const a of undeclaredPlugin) {
      const msg = `Plugin action ${a} is not declared in actions`;
      actionErrors.push(msg);
      addFinding('error', 'actions', 'actions', msg);
    }
    for (const vp of velaProblems) {
      actionErrors.push(vp);
      addFinding('error', 'actions', 'vela', vp);
    }

    // 8. Slots
    const validScreenSlots = new Set(['children', 'searchField']);
    const unknownSlots = [...scan.slotsUsed].filter(s => !validScreenSlots.has(s) && !s.startsWith('plugin:')).sort();
    const slotErrors = unknownSlots.map(s => `Unknown slot ${s}`);
    for (const err of slotErrors) addFinding('error', 'slots', 'slots', err);

    // 9. Portability
    const trees = { tree: doc.tree, ...(doc.loading ? { loading: doc.loading } : {}), ...(doc.failure ? { failure: doc.failure } : {}) };
    const portability = portabilityReport({ routes: trees as SkinDocument['routes'], templates: doc.templates });
    for (const pf of portability) {
      if (pf.level === 'error') {
        budgetErrors.push(`style matrix ${pf.row} at ${pf.at}: ${pf.message}`);
        addFinding('error', 'portability', pf.at, `${pf.row}: ${pf.message}`);
      } else {
        budgetWarnings.push(`style matrix ${pf.row} at ${pf.at}: ${pf.message}`);
        addFinding('warning', 'portability', pf.at, `${pf.row}: ${pf.message}`);
      }
    }

    const errors = [
      ...schemaErrors,
      ...limitErrors,
      ...colourErrors,
      ...tokenErrors,
      ...iconErrors,
      ...actionErrors,
      ...slotErrors,
      ...budgetErrors,
    ];
    const warnings = [...colourWarnings, ...budgetWarnings];
    const ok = viewports.length > 0 && viewports.every(v => !v.error) && errors.length === 0;

    return {
      ok,
      kind: 'screen',
      id,
      renderer: doc.renderer,
      ...(doc.owner ? { owner: doc.owner } : {}),
      ...(doc.experience ? { experience: doc.experience } : {}),
      screen: doc.screen,
      page: doc.page,
      presentation: doc.presentation,
      schema: {
        valid: schemaErrors.length === 0,
        schema: doc.schema,
        renderer: doc.renderer,
        maxRenderer: RENDERER_VERSION,
        digest: VELA_DOCUMENT_SCHEMA_DIGEST,
        errors: schemaErrors,
      },
      limits: {
        valid: limitErrors.length === 0,
        bytes,
        maxBytes: SCREEN_LIMITS.documentBytes,
        nodes: maxNodes,
        maxNodes: SCREEN_LIMITS.nodes,
        depth: maxTreeDepth,
        maxDepth: SCREEN_LIMITS.depth,
        longestString: longest,
        maxStringLength: SCREEN_LIMITS.stringLength,
        paletteColours: paletteEntries.length,
        maxPaletteColours: SCREEN_LIMITS.paletteColours,
        errors: limitErrors,
      },
      literalColours: {
        valid: colourErrors.length === 0,
        palette: Object.keys(doc.palette ?? {}).sort(),
        swatches: [],
        refused: scan.refusedLiterals,
        errors: colourErrors,
        warnings: colourWarnings,
      },
      tokens: {
        valid: tokenErrors.length === 0,
        declared: declaredTokens,
        uiDeclared: [],
        used: [...scan.tokensUsed].sort(),
        uiUsed: [...scan.uiUsed].sort(),
        paletteUsed: [...scan.paletteUsed].sort(),
        unknown: unknownTokens.sort(),
        errors: tokenErrors,
      },
      icons: {
        valid: iconErrors.length === 0,
        used: allUsedIcons,
        unknown: missingIcons,
        errors: iconErrors,
      },
      actions: {
        valid: actionErrors.length === 0,
        declared: declaredActions,
        used: [...scan.actionsUsed].sort(),
        pluginUsed: [...scan.pluginActionsUsed].sort(),
        unknown: unknownActions,
        undeclaredPlugin,
        velaUseErrors: velaProblems,
        errors: actionErrors,
      },
      slots: {
        valid: slotErrors.length === 0,
        declared: [],
        used: [...scan.slotsUsed].sort(),
        experiences: [],
        presentationSlot: doc.presentation === 'slot' ? doc.slot : doc.presentation,
        unknown: unknownSlots,
        errors: slotErrors,
      },
      budgets: {
        valid: budgetErrors.length === 0,
        limits: BUDGETS,
        viewports,
        portability,
        errors: budgetErrors,
        warnings: budgetWarnings,
      },
      findings,
      errors,
      warnings,
    };
  }

  // SkinDocument branch
  const doc = loaded as SkinDocument;
  const id = doc.id;
  const schemaErrors: string[] = [];
  if (doc.schema !== 1) {
    const msg = `Skin document schema ${String(doc.schema)} is not supported`;
    schemaErrors.push(msg);
    addFinding('error', 'schema', '/schema', msg);
  }
  if (typeof doc.renderer !== 'number' || doc.renderer > RENDERER_VERSION) {
    const msg = `${doc.name ?? id} needs renderer ${doc.renderer}; this client draws ${RENDERER_VERSION}`;
    schemaErrors.push(msg);
    addFinding('error', 'schema', '/renderer', msg);
  }

  for (const [sName, sNode] of Object.entries(doc.slots ?? {})) scanRawNode(sNode, `slots.${sName}`, false, scan, 1);
  for (const [rName, rNode] of Object.entries(doc.routes ?? {})) scanRawNode(rNode, `routes.${rName}`, false, scan, 1);
  for (const [tName, tNode] of Object.entries(doc.templates ?? {})) scanRawNode(tNode, `templates.${tName}`, false, scan, 1);
  for (const [expName, expOverride] of Object.entries(doc.experiences ?? {})) {
    for (const [pageName, pageVal] of Object.entries(expOverride?.pages ?? {})) {
      if (pageVal && typeof pageVal === 'object' && 'type' in pageVal) {
        scanRawNode(pageVal, `experiences.${expName}.pages.${pageName}`, false, scan, 1);
      } else if (pageVal && typeof pageVal === 'object') {
        const po = pageVal as { tree?: unknown; forms?: Record<string, unknown>; platforms?: Record<string, unknown>; loading?: unknown; failure?: unknown };
        if (po.tree) scanRawNode(po.tree, `experiences.${expName}.pages.${pageName}.tree`, false, scan, 1);
        for (const [f, fn] of Object.entries(po.forms ?? {})) scanRawNode(fn, `experiences.${expName}.pages.${pageName}.forms.${f}`, false, scan, 1);
        for (const [p, pn] of Object.entries(po.platforms ?? {})) scanRawNode(pn, `experiences.${expName}.pages.${pageName}.platforms.${p}`, false, scan, 1);
      }
    }
    for (const [tName, tNode] of Object.entries(expOverride?.templates ?? {})) {
      scanRawNode(tNode, `experiences.${expName}.templates.${tName}`, false, scan, 1);
    }
    for (const [fName, sNode] of Object.entries(expOverride?.shell ?? {})) {
      scanRawNode(sNode, `experiences.${expName}.shell.${fName}`, false, scan, 1);
    }
  }

  const viewports: ViewportBudgetReport[] = [];
  const budgetErrors: string[] = [];
  const budgetWarnings: string[] = [];
  let resolvedFirst: ResolvedDocument | undefined;
  let maxNodes = 0;

  for (const width of WIDTHS) {
    const vpName = width === 1440 ? 'desktop' : width === 390 ? 'phone' : 'tv';
    let model: ResolvedDocument;
    try {
      model = resolveDocument(doc, width, 'en');
    } catch (e) {
      const msg = (e as Error).message;
      viewports.push({ viewport: vpName, width, tv: width === 1920, pages: [], findings: [], error: msg });
      budgetErrors.push(`${width}px: refused: ${msg}`);
      addFinding('error', 'resolve', `${width}px`, `${width}px: refused: ${msg}`);
      continue;
    }
    resolvedFirst ??= model;
    const report = perfReport(model);
    for (const p of report.pages) maxNodes = Math.max(maxNodes, p.nodes);
    for (const f of report.findings) {
      if (f.level === 'error') {
        budgetErrors.push(`${width}px ${f.route}: ${f.message}`);
        addFinding('error', 'budget', `${width}px.${f.route}`, f.message);
      } else {
        budgetWarnings.push(`${width}px ${f.route}: ${f.message}`);
        addFinding('warning', 'budget', `${width}px.${f.route}`, f.message);
      }
    }
    viewports.push({
      viewport: vpName,
      width,
      tv: width === 1920,
      pages: report.pages,
      findings: report.findings,
    });
  }

  const limitErrors: string[] = [];
  if (maxNodes > SCREEN_LIMITS.nodes) {
    const msg = `A skin document draws at most ${SCREEN_LIMITS.nodes} nodes (${maxNodes})`;
    limitErrors.push(msg);
    addFinding('error', 'limits', '/nodes', msg);
  }
  if (scan.maxDepth > SCREEN_LIMITS.depth) {
    const msg = `A skin document nests at most ${SCREEN_LIMITS.depth} deep (${scan.maxDepth})`;
    limitErrors.push(msg);
    addFinding('error', 'limits', '/depth', msg);
  }

  const declaredTokens = Object.keys(doc.tokens ?? {}).sort();
  const declaredTokenSet = new Set(declaredTokens);
  const uiDeclared = Object.keys(doc.ui ?? {}).sort();
  const unknownTokens: string[] = [];
  const tokenErrors: string[] = [];
  for (const t of scan.tokensUsed) {
    if (!declaredTokenSet.has(t)) {
      unknownTokens.push(`$${t}`);
      const msg = `Unknown token $${t}`;
      tokenErrors.push(msg);
      addFinding('error', 'tokens', 'tokens', msg);
    }
  }
  for (const u of scan.uiUsed) {
    if (!UI_KEYS.has(u)) {
      unknownTokens.push(`$ui.${u}`);
      const msg = `Unknown UI token $ui.${u}`;
      tokenErrors.push(msg);
      addFinding('error', 'tokens', 'ui', msg);
    }
  }

  const resolvedTrees = resolvedFirst ? skinTrees(resolvedFirst) : [];
  const missingIcons = resolvedFirst ? unknownSymbols(resolvedTrees) : [...scan.iconsUsed].filter(s => !SYMBOLS[s]).sort();
  const allUsedIcons = [...new Set([...scan.iconsUsed, ...usedSymbolsInTrees(resolvedTrees)])].sort();
  const iconErrors: string[] = [];
  if (missingIcons.length) {
    const msg = `icon symbols the renderer cannot draw: ${missingIcons.join(', ')}`;
    iconErrors.push(msg);
    addFinding('error', 'icons', 'icons', msg);
  }

  const unknownActions = [...scan.actionsUsed].filter(a => !VALID_ACTIONS.has(a)).sort();
  const actionErrors = unknownActions.map(a => `Unknown press action ${a}`);
  for (const err of actionErrors) addFinding('error', 'actions', 'actions', err);

  const validSkinSlots = new Set(['shell', 'home', 'row', 'card', 'status']);
  const validNodeSlots = new Set(['children', 'searchField']);
  const declaredSlots = Object.keys(doc.slots ?? {}).sort();
  const unknownSlots = [
    ...declaredSlots.filter(s => !validSkinSlots.has(s)),
    ...[...scan.slotsUsed].filter(s => !validNodeSlots.has(s) && !s.startsWith('plugin:')),
  ].sort();
  const slotErrors = unknownSlots.map(s => `Unknown slot ${s}`);
  for (const err of slotErrors) addFinding('error', 'slots', 'slots', err);
  const experienceKeys = Object.entries(doc.experiences ?? {}).flatMap(([exp, ov]) => [
    ...Object.keys(ov?.pages ?? {}).map(p => `${exp}/${p}`),
    ...(ov?.shell ? [`${exp}/shell`] : []),
  ]).sort();

  const overrideFindings = checkExperienceOverrides(doc, experience => experiencePages(experience));
  for (const ofind of overrideFindings) {
    const at = `experiences.${ofind.experience}${ofind.page ? `.${ofind.page}` : ''}${ofind.viewport ? `.${ofind.viewport}` : ''}`;
    if (ofind.level === 'error') {
      slotErrors.push(`${at}: ${ofind.message}`);
      addFinding('error', 'experiences', at, ofind.message);
    } else {
      budgetWarnings.push(`${at}: ${ofind.message}`);
      addFinding('warning', 'experiences', at, ofind.message);
    }
  }

  const portability = portabilityReport(doc);
  for (const pf of portability) {
    if (pf.level === 'error') {
      budgetErrors.push(`style matrix ${pf.row} at ${pf.at}: ${pf.message}`);
      addFinding('error', 'portability', pf.at, `${pf.row}: ${pf.message}`);
    } else {
      budgetWarnings.push(`style matrix ${pf.row} at ${pf.at}: ${pf.message}`);
      addFinding('warning', 'portability', pf.at, `${pf.row}: ${pf.message}`);
    }
  }

  const errors = [
    ...schemaErrors,
    ...limitErrors,
    ...tokenErrors,
    ...iconErrors,
    ...actionErrors,
    ...slotErrors,
    ...budgetErrors,
  ];
  const warnings = [...budgetWarnings];
  const ok = viewports.length > 0 && viewports.every(v => !v.error) && errors.length === 0;

  return {
    ok,
    kind: 'skin',
    id,
    renderer: doc.renderer,
    schema: {
      valid: schemaErrors.length === 0,
      schema: doc.schema,
      renderer: doc.renderer,
      maxRenderer: RENDERER_VERSION,
      errors: schemaErrors,
    },
    limits: {
      valid: limitErrors.length === 0,
      bytes,
      maxBytes: SCREEN_LIMITS.documentBytes,
      nodes: maxNodes,
      maxNodes: SCREEN_LIMITS.nodes,
      depth: scan.maxDepth,
      maxDepth: SCREEN_LIMITS.depth,
      longestString: longest,
      maxStringLength: SCREEN_LIMITS.stringLength,
      paletteColours: 0,
      maxPaletteColours: SCREEN_LIMITS.paletteColours,
      errors: limitErrors,
    },
    literalColours: {
      valid: true,
      palette: [],
      swatches: doc.swatches ?? [],
      refused: [],
      errors: [],
      warnings: [],
    },
    tokens: {
      valid: tokenErrors.length === 0,
      declared: declaredTokens,
      uiDeclared,
      used: [...scan.tokensUsed].sort(),
      uiUsed: [...scan.uiUsed].sort(),
      paletteUsed: [],
      unknown: unknownTokens.sort(),
      errors: tokenErrors,
    },
    icons: {
      valid: iconErrors.length === 0,
      used: allUsedIcons,
      unknown: missingIcons,
      errors: iconErrors,
    },
    actions: {
      valid: actionErrors.length === 0,
      declared: [],
      used: [...scan.actionsUsed].sort(),
      pluginUsed: [],
      unknown: unknownActions,
      undeclaredPlugin: [],
      errors: actionErrors,
    },
    slots: {
      valid: slotErrors.length === 0,
      declared: declaredSlots,
      used: [...scan.slotsUsed].sort(),
      experiences: experienceKeys,
      experienceOverrides: overrideFindings,
      unknown: unknownSlots,
      errors: slotErrors,
    },
    budgets: {
      valid: budgetErrors.length === 0,
      limits: BUDGETS,
      viewports,
      portability,
      errors: budgetErrors,
      warnings: budgetWarnings,
    },
    findings,
    errors,
    warnings,
  };
}

export async function analyzeDocument(path: string): Promise<DocumentCheckReport> {
  const loaded = await loadDocument(path);
  return analyzeLoadedDocument(loaded);
}

/** The style matrix (docs/architecture.md): rows refused on native fail, approximated rows are noted. */
function printPortability(findings: PortabilityFinding[]): boolean {
  const counts = new Map<string, { finding: PortabilityFinding; count: number }>();
  for (const finding of findings) {
    const key = `${finding.level} ${finding.row} ${finding.message}`;
    const seen = counts.get(key);
    if (seen) seen.count++;
    else counts.set(key, { finding, count: 1 });
  }
  console.log('  style matrix (React Native)');
  if (counts.size === 0) console.log('    every row draws the same on every platform');
  for (const { finding, count } of counts.values()) {
    const label = finding.level === 'error' ? 'FAIL' : 'warn';
    console.log(`    ${label} ${finding.row} (${count}x, first at ${finding.at}): ${finding.message}`);
  }
  return !findings.some(f => f.level === 'error');
}

/** A plugin screen or surface document (docs/plugin-screens.md): resolved as the client resolves it, its
 * limits and budgets per page, the style matrix, and the icons it names. */
async function checkScreen(doc: ScreenDocument): Promise<boolean> {
  let ok = true, shown = '';
  console.log(`${doc.screen}/${doc.page}: screen, renderer ${doc.renderer}, ${doc.presentation}`);
  let resolved: ResolvedScreen | undefined;
  for (const viewport of SCREEN_VIEWPORTS) {
    let model: ResolvedScreen;
    try { model = resolveScreenDocument(doc, viewport, 'en', {}); } catch (e) { console.log(`  ${viewport.name}: refused: ${(e as Error).message}`); ok = false; continue; }
    resolved ??= model;
    const report = treesReport(screenTrees(model));
    const key = JSON.stringify([report, model.warnings]);
    if (key === shown) continue;
    shown ||= key;
    console.log(`  ${viewport.name} (${viewport.width}px)`);
    console.log('    tree        nodes  per item  images/item  endless/item  blurs/item');
    for (const p of report.pages) console.log(`    ${p.route.padEnd(11)} ${String(p.nodes).padStart(5)}  ${String(p.perItem).padStart(8)}  ${String(p.imagesPerItem).padStart(11)}  ${String(p.endlessPerItem).padStart(12)}  ${String(p.blursPerItem).padStart(10)}`);
    for (const f of report.findings) { console.log(`    ${f.level === 'error' ? 'FAIL' : 'warn'} ${f.route}: ${f.message}`); if (f.level === 'error') ok = false; }
    for (const w of model.warnings) console.log(`    warn ${w}`);
  }
  const trees = { tree: doc.tree, ...(doc.loading ? { loading: doc.loading } : {}), ...(doc.failure ? { failure: doc.failure } : {}) };
  if (!printPortability(portabilityReport({ routes: trees as SkinDocument['routes'], templates: doc.templates }))) ok = false;
  if (resolved) {
    const symbols = unknownSymbols(screenTrees(resolved).map(([, tree]) => tree));
    if (symbols.length) {
      console.log(`  FAIL icon symbols the renderer cannot draw: ${symbols.join(', ')}`);
      ok = false;
    }
  }
  console.log(`  budgets (warn/limit): ${Object.entries(BUDGETS).map(([k, b]) => `${k} ${b.warn}/${b.fail}`).join(', ')}`);
  console.log(ok ? 'pass' : 'FAIL');
  return ok;
}

/** Prints the report (human-readable or `--json`); returns false when the document fails. */
export async function checkDocument(path: string, options: { json?: boolean } = {}): Promise<boolean> {
  if (options.json) {
    const report = await analyzeDocument(path);
    console.log(JSON.stringify(report, null, 2));
    return report.ok;
  }
  const loaded = await loadDocument(path);
  if ((loaded as ScreenDocument).kind === 'screen') return checkScreen(loaded as ScreenDocument);
  const doc = loaded as SkinDocument;
  let ok = true, shown = '';
  console.log(`${doc.id}: renderer ${doc.renderer}`);
  for (const width of WIDTHS) {
    let model;
    try { model = resolveDocument(doc, width, 'en'); } catch (e) { console.log(`  ${width}px: refused: ${(e as Error).message}`); ok = false; continue; }
    const report = perfReport(model);
    // A phone or TV width is shown only where its report differs from the desktop's.
    if (JSON.stringify(report) === shown) continue;
    shown ||= JSON.stringify(report);
    console.log(`  ${width}px`);
    console.log('    page        nodes  per item  images/item  endless/item  blurs/item');
    for (const p of report.pages) console.log(`    ${p.route.padEnd(11)} ${String(p.nodes).padStart(5)}  ${String(p.perItem).padStart(8)}  ${String(p.imagesPerItem).padStart(11)}  ${String(p.endlessPerItem).padStart(12)}  ${String(p.blursPerItem).padStart(10)}`);
    for (const f of report.findings) { console.log(`    ${f.level === 'error' ? 'FAIL' : 'warn'} ${f.route}: ${f.message}`); if (f.level === 'error') ok = false; }
  }
  if (!printPortability(portabilityReport(doc))) ok = false;
  for (const f of checkExperienceOverrides(doc, experience => experiencePages(experience))) {
    const where = `${f.experience}${f.page ? `/${f.page}` : ''}${f.viewport ? ` (${f.viewport})` : ''}`;
    console.log(`  ${f.level === 'error' ? 'FAIL' : 'warn'} experiences ${where}: ${f.message}`);
    if (f.level === 'error') ok = false;
  }
  try {
    const symbols = unknownSymbols(skinTrees(resolveDocument(doc, WIDTHS[0]!, 'en')));
    if (symbols.length) {
      console.log(`  FAIL icon symbols the renderer cannot draw: ${symbols.join(', ')}`);
      ok = false;
    }
  } catch {
    // Already reported as refused above.
  }
  console.log(`  budgets (warn/limit): ${Object.entries(BUDGETS).map(([k, b]) => `${k} ${b.warn}/${b.fail}`).join(', ')}`);
  console.log(ok ? 'pass' : 'FAIL');
  return ok;
}

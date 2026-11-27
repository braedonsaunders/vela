// The profile menu primitive (renderer 22, docs/skin-schema.md: Profile menu): a `profileMenu` node
// becomes an ordinary box holding every entry the app offers (entries.ts), arranged and drawn by the
// document's look. The resolver expands it before converting, so the menu's rows are plain document
// nodes: hover, focus, states, the TV focus guide of a box with `escape`, reading stops and the node
// budget all apply to them as to any other node.
import type {
  BoxNode, Condition, Node, ProfileMenuEntryLook, ProfileMenuLook, ProfileMenuNode, ProfileMenuSection, SkinDocument,
} from '../../../protocol/skin';
import { PROFILE_MENU_ENTRIES, PROFILE_MENU_HIDEABLE, PROFILE_MENU_SECTIONS, type ProfileMenuEntry } from './entries';

/** What a part reads as {entry.*}. */
interface Facts { id: string; label: string; detail: string; icon: string; testId: string; glyph?: Node }

/** An item the menu draws: an app entry or one of the look's extras. */
interface Item { facts: Facts; entry?: ProfileMenuEntry; extra?: NonNullable<ProfileMenuLook['extras']>[string]; part: string }

const ENTRY_HOLE = /\{entry\.(id|label|detail|icon|testId)\}/g;
const SECTION_HOLE = /\{section\.title\}/g;

/** The look a node draws with: the document's (by name; `default` when the node names none) over the base's. */
export function profileMenuLook(node: ProfileMenuNode, doc: SkinDocument, base: ProfileMenuLook): ProfileMenuLook {
  const name = node.look ?? 'default';
  const own = doc.profileMenus?.[name];
  if (node.look && !own) throw new Error(`Unknown profile menu look ${node.look}`);
  if (!own || own === base) return base;
  // A part the look leaves out is the base's, but for `group`: sections sit in the look's panel as
  // its own rows do unless the look boxes them itself.
  const { group: _group, ...inherited } = base.parts ?? {};
  const parts = { ...inherited, ...own.parts };
  // A look that draws its own rows draws Appearance with them too, unless it gives a picker of its own.
  if (own.parts?.row && !own.parts.picker) parts.picker = own.parts.row;
  return { ...own, parts };
}

/** The menu's box: the node's own panel props, its children the arranged entries. */
export function expandProfileMenu(node: ProfileMenuNode, doc: SkinDocument, base: ProfileMenuLook): BoxNode {
  const look = profileMenuLook(node, doc, base);
  const { type: _type, look: _look, ...panel } = node;
  return { ...panel, type: 'box', children: profileMenuChildren(look) };
}

/** The arranged sections, each entry placed once (docs/skin-schema.md: Profile menu, Arrangement). */
export function arrangement(look: ProfileMenuLook): ProfileMenuSection[] {
  const hidden = new Set<string>(look.hide ?? []);
  for (const id of hidden) {
    if (!PROFILE_MENU_HIDEABLE.has(id as never)) throw new Error(`A profile menu cannot leave out ${id}: only ${[...PROFILE_MENU_HIDEABLE].join(', ')} may be hidden`);
  }
  const extras = Object.keys(look.extras ?? {});
  for (const id of extras) if (PROFILE_MENU_ENTRIES.some(entry => entry.id === id)) throw new Error(`A profile menu extra cannot take the entry id ${id}`);
  const known = new Set<string>([...PROFILE_MENU_ENTRIES.map(entry => entry.id), ...extras]);
  const sections = (look.sections ?? PROFILE_MENU_SECTIONS.map(section => ({ ...section, entries: [] as string[] })))
    .map(section => ({ ...section, entries: [...section.entries] }));
  const placed = new Set<string>();
  for (const section of sections) {
    for (const id of section.entries) {
      if (!known.has(id)) throw new Error(`Unknown profile menu entry ${id}`);
      if (placed.has(id)) throw new Error(`Profile menu entry ${id} is placed twice`);
      placed.add(id);
    }
  }
  // Whatever the arrangement leaves out joins its default section: the look's section of that id, or
  // one added where the default order puts it. So entries the app adds later appear in every skin.
  const order = PROFILE_MENU_SECTIONS.map(section => section.id as string);
  const sectionFor = (id: string) => {
    const found = sections.find(section => section.id === id);
    if (found) return found;
    const spec = PROFILE_MENU_SECTIONS.find(section => section.id === id)!;
    const added = { id, ...(spec.title ? { title: spec.title } : {}), entries: [] as string[] };
    const after = order.indexOf(id);
    const next = sections.findIndex(section => order.indexOf(section.id ?? '') > after);
    sections.splice(next < 0 ? sections.length : next, 0, added);
    return added;
  };
  for (const entry of PROFILE_MENU_ENTRIES) if (!placed.has(entry.id)) sectionFor(entry.section).entries.push(entry.id);
  for (const id of extras) if (!placed.has(id)) sectionFor('you').entries.push(id);
  return sections.map(section => ({ ...section, entries: section.entries.filter(id => !hidden.has(id)) }));
}

function profileMenuChildren(look: ProfileMenuLook): Node[] {
  const parts = look.parts ?? {};
  const children: Node[] = [];
  if (look.title) {
    const title = parts.title && fillPart(parts.title, facts('title', look.title, {}, ''), '');
    if (title) children.push(title);
  }
  for (const section of arrangement(look)) {
    const items = section.entries.flatMap(id => draw(item(id, look), parts));
    if (!items.length) continue;
    const heading = section.title && parts.section ? fillPart(parts.section, facts(section.id ?? '', '', {}, ''), section.title) : undefined;
    const drawn = [...(heading ? [heading] : []), ...items];
    if (section.divider && children.length && parts.divider) children.push(clone(parts.divider));
    if (parts.group?.type === 'box') children.push({ ...clone(parts.group), children: [...(parts.group.children ?? []), ...drawn] } as Node);
    else children.push(...drawn);
  }
  return children;
}

function facts(id: string, label: string, own: ProfileMenuEntryLook, testId: string, entry?: ProfileMenuEntry): Facts {
  return {
    id,
    label: own.label ?? label,
    detail: own.detail ?? entry?.detail ?? '',
    icon: own.icon ?? entry?.icon ?? '',
    testId,
    ...(own.glyph ? { glyph: own.glyph } : {}),
  };
}

function item(id: string, look: ProfileMenuLook): Item {
  const entry = PROFILE_MENU_ENTRIES.find(candidate => candidate.id === id);
  if (entry) {
    const own = look.entries?.[entry.id] ?? {};
    const part = own.part ?? (entry.kind === 'header' ? 'header' : entry.kind === 'about' ? 'about' : entry.kind === 'widget' ? 'servers'
      : entry.id === 'appearance' ? 'picker' : 'row');
    return { facts: facts(entry.id, entry.label, own, entry.testId, entry), entry, part };
  }
  const extra = look.extras![id]!;
  return { facts: facts(id, extra.label, extra, extra.testId ?? `profile-menu-${id}`), extra, part: extra.part ?? 'row' };
}

function draw({ facts: f, entry, extra, part }: Item, parts: Record<string, Node>): Node[] {
  if (entry?.kind === 'widget') {
    const widget: Node = { type: 'widget', widget: entry.widget!.widget, testId: entry.testId,
      params: { ...entry.widget!.params, label: f.label } };
    const wrapper = parts[part];
    if (wrapper?.type !== 'box') return [{ ...widget, when: entry.when }];
    const box = fillPart(wrapper, f, '');
    return box ? [{ ...box, when: [...(box.when ?? []), ...entry.when], children: [...((box as BoxNode).children ?? []), widget] } as Node] : [];
  }
  const template = parts[part] ?? parts.row;
  if (!template) throw new Error(`The profile menu has no ${part} part`);
  const filled = fillPart(template, f, '');
  if (!filled) return [];
  const when: Condition[] = [...(entry?.when ?? extra?.when ?? []), ...(filled.when ?? [])];
  const header = entry?.kind === 'header';
  const about = entry?.kind === 'about';
  const press = entry?.press ?? extra?.press;
  const a11y = entry?.a11y ?? extra?.a11y;
  // The control: the node the part marks with {entry.testId}, else its root.
  const control = (node: Node): Node => ({
    ...node,
    testId: f.testId,
    ...(header ? {} : { label: about ? '{env.aboutLabel}' : f.label }),
    ...(press ? { press } : {}),
    ...(about ? { readingStop: true } : {}),
    ...(a11y ? { a11y: { ...a11y, ...node.a11y } } : {}),
  } as Node);
  const marked = mapNodes(filled, node => node.testId === f.testId ? control(node) : node);
  const root = marked.found ? marked.node : control(filled);
  const target = marked.found ? marked.target! : root;
  if ((press || about) && target.type !== 'box') throw new Error(`A profile menu ${part} part's control must be a box`);
  return [{ ...root, when } as Node];
}

/** A part with {entry.*} and {section.title} filled; conditions on entry.* decided now. Null when the root's fail. */
function fillPart(template: Node, f: Facts, sectionTitle: string): Node | null {
  const values: Record<string, string> = { id: f.id, label: f.label, detail: f.detail, icon: f.icon, testId: f.testId };
  const text = (value: string) => value.replace(ENTRY_HOLE, (_, key: string) => values[key] ?? '').replace(SECTION_HOLE, sectionTitle);
  const holds = (test: Condition) => {
    const value = values[test.test.slice('entry.'.length)] ?? '';
    const is = test.is ?? 'set';
    const result = is === 'set' ? value !== '' : is === 'eq' ? value === (test.value ?? '') : is === 'ne' ? value !== (test.value ?? '') : false;
    return test.not ? !result : result;
  };
  const deep = (value: unknown): unknown => typeof value === 'string' ? text(value)
    : Array.isArray(value) ? value.map(deep)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v)])) : value;
  const visit = (node: Node): Node | null => {
    const local = node.when?.filter(test => test.test.startsWith('entry.')) ?? [];
    if (!local.every(holds)) return null;
    if (node.type === 'icon' && node.symbol === '{entry.icon}') {
      if (f.glyph) return { ...clone(f.glyph), style: { ...node.style, ...f.glyph.style } } as Node;
      if (!f.icon) return null;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'when') {
        const kept = (value as Condition[]).filter(test => !test.test.startsWith('entry.')).map(test => deep(test) as Condition);
        if (kept.length) out.when = kept;
      } else if (key === 'children' && Array.isArray(value)) {
        out.children = (value as Node[]).map(visit).filter((child): child is Node => child !== null);
      } else if ((key === 'item' || key === 'fallback') && value && typeof value === 'object') {
        out[key] = visit(value as Node) ?? { type: 'box' };
      } else out[key] = deep(value);
    }
    return out as unknown as Node;
  };
  return visit(template);
}

/** The node with `change` applied to the first node it alters (depth first), and that node. */
function mapNodes(node: Node, change: (node: Node) => Node): { node: Node; found: boolean; target?: Node } {
  const changed = change(node);
  if (changed !== node) return { node: changed, found: true, target: changed };
  if (node.type === 'box' && node.children) {
    for (let index = 0; index < node.children.length; index++) {
      const inner = mapNodes(node.children[index]!, change);
      if (inner.found) {
        const children = [...node.children];
        children[index] = inner.node;
        return { node: { ...node, children }, found: true, target: inner.target };
      }
    }
  }
  return { node, found: false };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

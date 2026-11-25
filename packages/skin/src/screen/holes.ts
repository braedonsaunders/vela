// A screen document's `{…}` holes compiled to the renderer's accessors (docs/plugin-screens.md:
// Bindings). A hole is a path from a root (`src`, `param`, `state`, `context`, `env`, `arg`, an
// item's alias, `$index`) or a string (`s:key`), then pipes. Compiled once per document and
// viewport; drawing fills them from the context's ScreenScope. A hole never throws while drawing:
// a missing path reads ''. A hole naming an unknown root or pipe refuses the document instead.
import type { Accessor, Ctx, Env } from '../vocabulary';
import { pipe, type Pipe } from './pipes';
import { RANGES, deref, text, walk, type RecordReader } from './scope';
import { number as formatNumber, plural as pluralForm } from '../../../core/src/i18n';

/** A compiled template: literal text, or text with holes (resolve.ts's Template). */
export type Template = string | { parts: (string | Accessor)[] };
/** A raw value read from the scope (a list, an object, a number), record references followed. */
export type Value = (c: Ctx, e: Env) => unknown;

/** An argument a `use` passes (`with`), or a string's `with:` pipe. */
export interface Arg {
  template: Template;
  /** Its raw value when it is a single hole (so `{arg.side|crest}` reads the side, not its text). */
  value?: Value;
  /** Its path when it is a bare path or a single plain hole (`over: "{arg.over}"`). */
  path?: string;
}

export interface HoleScope {
  /** The document's strings (one locale). */
  strings: Record<string, string>;
  /** Renderer 20, built-in documents: a string the document does not have, from Vela's locale tables
   * (its `{name}` placeholders read as `{arg.name}`), else undefined. */
  fallback?: (key: string) => string | undefined;
  /** `{arg.*}` in force (inside a `use` or a string's `with:`). */
  args: Record<string, Arg>;
  /** The item aliases in force (`as` of the enclosing repeats and blocks). */
  aliases: ReadonlySet<string>;
  /** The skin's page colour, for `readable`. */
  page: string;
  /** Strings nesting strings: bounded. */
  depth?: number;
}

/** A binding path: dot segments from a root (`$` allowed: `$index`, `$key`, `$pending`). */
const PATH = /^[$A-Za-z_][\w$-]*(\.[\w$^-]+)*$/;

const ENV_KEYS = new Set(['small', 'wide', 'tv', 'isTV', 'still', 'canMultiview', 'canPlay', 'canRetry', 'error', 'range5', 'range6',
  // Renderer 20: a device capability, the platform, the form factor and a partly open foldable's posture.
  'canVisualize', 'platform', 'form', 'fold',
  // Renderer 20: the viewer's name and the time now (epoch ms; {env.now|greeting}).
  'viewer', 'now']);

const fillT = (t: Template, c: Ctx, e: Env): string =>
  typeof t === 'string' ? t : t.parts.map(p => (typeof p === 'string' ? p : p(c, e))).join('');

const NONE: RecordReader = () => undefined;
const reader = (c: Ctx): RecordReader => c.screen?.record ?? NONE;

/** Read one item of the scope by alias. */
function item(alias: string): Value {
  return c => c.screen?.items[alias]?.value;
}

/** A value reader for a path (no pipes), or an error for an unknown root. */
export function pathValue(path: string, scope: HoleScope): Value {
  const segments = path.split('.');
  const [root, ...rest] = segments as [string, ...string[]];
  const walked = (start: Value): Value => (rest.length ? (c, e) => walk(start(c, e), rest, reader(c)) : start);
  switch (root) {
    case 'src': {
      const [id, ...path] = rest;
      if (!id) throw new Error(`A source path names its source: {${path}}`);
      if (path[0] === '$pending') return c => c.screen?.page.pending[id] === true;
      if (path[0] === '$error') return c => c.screen?.page.errors[id] ?? '';
      return c => walk(c.screen?.page.sources[id], path, reader(c));
    }
    case 'param': return c => walk(c.screen?.page.params, rest, reader(c));
    case 'state': return c => walk(c.screen?.state, rest, reader(c));
    case 'context': return c => walk(c.screen?.page.context, rest, reader(c));
    case 'env': {
      const [name, ...more] = rest;
      if (!name || !ENV_KEYS.has(name)) throw new Error(`Unknown binding {${path}}: a screen reads env.${[...ENV_KEYS].join(', env.')}`);
      const at: Value = (c, e) => {
        switch (name) {
          case 'small': return e.small;
          case 'wide': return e.width >= 1200;
          case 'tv': return e.tv;
          // The TV class (`tv`) includes a web window 1600px or wider; `isTV` is a TV device only.
          case 'isTV': return e.isTV === true;
          case 'still': return e.still;
          case 'canMultiview': return e.canMultiview === true;
          case 'canPlay': return e.canPlay !== false;
          // False on clients and devices without the visualizer.
          case 'canVisualize': return e.canVisualize === true;
          case 'platform': return e.platform ?? '';
          case 'form': return e.form ?? (e.tv ? 'tv' : e.small ? 'small' : 'wide');
          case 'fold': return e.fold ?? '';
          case 'viewer': return e.viewer ?? '';
          case 'now': return Date.now();
          // The first read's failure as the server or the network gave it (the failure node's message line).
          case 'error': return c.screen?.page.load === 'failed' ? c.screen.page.error ?? '' : '';
          case 'canRetry': return c.screen ? c.screen.page.load === 'failed' || Object.keys(c.screen.page.errors).length > 0 : false;
          default: return RANGES[name];
        }
      };
      return more.length ? (c, e) => walk(at(c, e), more, reader(c)) : at;
    }
    case '$index': {
      if (rest.length) throw new Error(`Unknown binding {${path}}`);
      return c => c.index;
    }
    case 'arg': {
      const [name, ...more] = rest;
      const arg = name ? scope.args[name] : undefined;
      // An argument the caller did not pass reads ''.
      if (!arg) return () => undefined;
      const start: Value = arg.value ?? ((c, e) => fillT(arg.template, c, e));
      return more.length ? (c, e) => walk(start(c, e), more, reader(c)) : start;
    }
    default:
      if (scope.aliases.has(root)) return walked(item(root));
      throw new Error(`Unknown binding {${path}}`);
  }
}

/** Split a hole's text on its pipe bars. */
function bars(body: string): string[] {
  return body.split('|');
}

/** `with:a=path,b=path` as arguments compiled in the caller's scope. A path may carry argument-less
 * pipes after `~` (`with:date=src.recap.firstPlayAt~fullDate`, renderer 20). */
function withArgs(spec: string, scope: HoleScope): Record<string, Arg> {
  const args: Record<string, Arg> = {};
  for (const pair of spec.split(',')) {
    const at = pair.indexOf('=');
    if (at <= 0) throw new Error(`with: takes name=path pairs (${spec})`);
    const name = pair.slice(0, at).trim(), [path = '', ...pipes] = pair.slice(at + 1).trim().split('~');
    const value = holeValue([path.trim(), ...pipes.map(p => p.trim())].join('|'), scope);
    args[name] = { template: { parts: [(c, e) => text(value(c, e), reader(c))] }, value, path };
  }
  return args;
}

/** A document string compiled where it is used, its `{arg.*}` from `with:` (else the caller's). */
function stringTemplate(key: string, scope: HoleScope, args?: Record<string, Arg>): Template {
  const depth = (scope.depth ?? 0) + 1;
  if (depth > 4) throw new Error(`Strings nest at most 4 deep ({s:${key}})`);
  const source = scope.strings[key] ?? scope.fallback?.(key);
  if (source === undefined) return '';
  return compileTemplate(source, { ...scope, args: args ? { ...scope.args, ...args } : scope.args, depth });
}

/** A string option of `then:` (`s:key`) or literal text. */
function option(spec: string, scope: HoleScope, args?: Record<string, Arg>): Template {
  return spec.startsWith('s:') ? stringTemplate(spec.slice(2), scope, args) : spec;
}

/** A path with pipes, as a raw value (the last pipe's result). Strings (`s:key`) read as text. */
export function holeValue(body: string, scope: HoleScope): Value {
  const [head, ...rest] = bars(body) as [string, ...string[]];
  let value: Value;
  let at = 0;
  if (head.startsWith('s:')) {
    const args = rest[0]?.startsWith('with:') ? withArgs(rest[at++]!.slice(5), scope) : undefined;
    const t = stringTemplate(head.slice(2), scope, args);
    value = (c, e) => fillT(t, c, e);
  } else {
    if (!PATH.test(head.trim())) throw new Error(`Not a binding path: {${body}}`);
    value = pathValue(head.trim(), scope);
  }
  for (; at < rest.length; at++) {
    const spec = rest[at]!;
    const name = /^\s*([A-Za-z]+)(?::|\s*$)/.exec(spec)?.[1];
    if (name === 'then' && /(^|,)s:/.test(spec.slice(5))) {
      // `then:s:a,s:b` picks a string; a following `with:` fills either.
      const args = rest[at + 1]?.startsWith('with:') ? withArgs(rest[++at]!.slice(5), scope) : undefined;
      const [yes = '', no = ''] = spec.slice(5).split(',');
      const a = option(yes, scope, args), b = option(no, scope, args), before = value;
      value = (c, e) => fillT(!['', 'false', '0'].includes(text(before(c, e), reader(c))) ? a : b, c, e);
      continue;
    }
    if (name === 'plural') {
      value = pluralPipe(value, spec.slice(7).trim(), rest[at + 1]?.startsWith('with:') ? withArgs(rest[++at]!.slice(5), scope) : {}, scope);
      continue;
    }
    if (name === 'asOf') {
      value = asOfPipe(value, spec.slice(5));
      continue;
    }
    if (name === 'with') throw new Error(`with: follows a string ({s:key|with:…}): {${body}}`);
    const known: Pipe | undefined = name ? pipe(spec.trim(), scope.page) : undefined;
    if (known) {
      const before = value;
      value = (c, e) => known(before(c, e), reader(c));
      continue;
    }
    if (name && /^[A-Za-z]+(:|$)/.test(spec.trim())) throw new Error(`Unknown pipe ${name} in {${body}}`);
    // Literal text after a bar: a separator drawn before the value only when it is non-empty.
    const before = value;
    value = (c, e) => { const s = text(before(c, e), reader(c)); return s ? spec + s : ''; };
  }
  return value;
}

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

/** Renderer 20, `{<path>|plural:<key>}` (a following `with:` adds arguments): the string `<key>.<form>`
 * for the number's plural form in the viewer's locale (else `<key>.other`), its `{arg.count}` the
 * number formatted. `{src.album.tracks.total|plural:media.count.tracks}` reads "12 tracks". */
function pluralPipe(before: Value, key: string, args: Record<string, Arg>, scope: HoleScope): Value {
  if (!key) throw new Error('plural: names a string');
  const count = (c: Ctx, e: Env) => Number(text(before(c, e), reader(c))) || 0;
  const scoped = { ...args, count: { template: { parts: [(c: Ctx, e: Env) => formatNumber(count(c, e))] }, value: count } };
  const forms = Object.fromEntries(PLURAL_FORMS.map(form => [form, stringTemplate(`${key}.${form}`, scope, scoped)])) as Record<string, Template>;
  return (c, e) => {
    const form = pluralForm(count(c, e));
    return fillT(forms[form] || forms.other!, c, e);
  };
}

/** The picture's time for `asOf`: the context's `pictureTime`, else now (live). */
function pictureTime(c: Ctx): number {
  const t = c.screen?.page.context?.pictureTime;
  const at = typeof t === 'number' ? t : t ? Date.parse(String(t)) : NaN;
  return Number.isFinite(at) ? at : Date.now();
}

/** A time value (ISO text or epoch ms) as epoch ms; NaN when neither. */
export function timeOf(value: unknown): number {
  if (typeof value === 'number') return value;
  const s = text(value);
  return /^\d{10,}$/.test(s) ? Number(s) : Date.parse(s);
}

/**
 * `{list|asOf:at}`: of a list of timed items, the newest whose `at` is at or before the picture's
 * time (the context's `pictureTime`; now when live). `asOf:at,score.mtl` reads a path of that item.
 * A list with no times is the live value: unfiltered (with a path, read from its last item).
 */
function asOfPipe(before: Value, spec: string): Value {
  const [at = 'at', path = ''] = spec.split(',').map(s => s.trim());
  const atPath = at.split('.'), valuePath = path ? path.split('.') : [];
  return (c, e) => {
    const read = reader(c);
    const list = deref(before(c, e), read);
    if (!Array.isArray(list)) return undefined;
    const limit = pictureTime(c);
    let best: unknown, bestAt = -Infinity, timed = false;
    for (const entry of list) {
      const t = timeOf(walk(entry, atPath, read));
      if (!Number.isFinite(t)) continue;
      timed = true;
      if (t <= limit && t >= bestAt) { best = entry; bestAt = t; }
    }
    // A list without times (an older plugin) is the live value, unfiltered.
    if (!timed) return valuePath.length ? walk(list[list.length - 1], valuePath, read) : before(c, e);
    return valuePath.length ? walk(best, valuePath, read) : best;
  };
}

/** A hole as text. */
function holeText(body: string, scope: HoleScope): Accessor {
  const value = holeValue(body, scope);
  return (c, e) => text(value(c, e), reader(c));
}

/** Text with holes compiled; `{{` is a literal brace. `wrap` post-processes each hole's text (styles validate it). */
export function compileTemplate(source: string, scope: HoleScope, wrap?: (hole: Accessor, body: string) => Accessor): Template {
  const parts: (string | Accessor)[] = [];
  let literal = '';
  let at = 0;
  for (const m of source.matchAll(/\{\{|\{([^{}]*)\}/g)) {
    literal += source.slice(at, m.index);
    at = m.index! + m[0].length;
    if (m[0] === '{{') { literal += '{'; continue; }
    const body = m[1]!;
    // A plain string with no pipes is inlined, so its literal text stays literal.
    if (/^s:[\w.-]+$/.test(body) && !wrap) {
      const inner = stringTemplate(body.slice(2), scope);
      if (typeof inner === 'string') { literal += inner; continue; }
      if (literal) parts.push(literal);
      literal = '';
      parts.push(...inner.parts);
      continue;
    }
    // An argument passed as literal text (or not passed) is literal here too: styles fold, symbols stay static.
    const arg = /^arg\.(\^*\w+)$/.exec(body);
    if (arg) {
      const passed = scope.args[arg[1]!];
      if (!passed) continue;
      if (typeof passed.template === 'string') { literal += passed.template; continue; }
    }
    if (literal) parts.push(literal);
    literal = '';
    const hole = holeText(body, scope);
    parts.push(wrap ? wrap(hole, body) : hole);
  }
  literal += source.slice(at);
  if (literal) parts.push(literal);
  if (parts.every(p => typeof p === 'string')) return (parts as string[]).join('');
  return { parts };
}

/** A template that is exactly one hole, as its body (`{e.sides}` -> `e.sides`); else undefined. */
export function singleHole(source: string): string | undefined {
  const m = /^\{([^{}]+)\}$/.exec(source.trim());
  return m ? m[1] : undefined;
}

/** A field that names a path (`over`, `data`, `series`): a bare path, or `{arg.x}` standing for one. */
export function pathField(source: string, scope: HoleScope): Value {
  const hole = singleHole(source);
  if (hole === undefined) return holeValue(source.trim(), scope);
  const arg = /^arg\.(\w+)$/.exec(hole);
  if (arg) {
    const passed = scope.args[arg[1]!];
    if (!passed) return () => undefined;
    return passed.value ?? ((c, e) => fillT(passed.template, c, e));
  }
  return holeValue(hole, scope);
}


/** A `with` value compiled in the caller's scope: a literal (also read as a path when it is one,
 * `over: "src.yours.events"`), a single hole (its raw value kept), or text with holes. */
export function makeArg(raw: string, scope: HoleScope): Arg {
  const template = compileTemplate(raw, scope);
  if (typeof template === 'string') {
    if (!PATH.test(raw.trim())) return { template };
    try { return { template, value: pathValue(raw.trim(), scope), path: raw.trim() }; } catch { return { template }; }
  }
  const hole = singleHole(raw);
  if (hole === undefined || hole.startsWith('s:')) return { template };
  return { template, value: holeValue(hole, scope), ...(hole.includes('|') ? {} : { path: hole }) };
}

/** The text of a field that names a path, for reports and keys (`{arg.over}` resolved). */
export function pathText(source: string, scope: HoleScope): string {
  const hole = singleHole(source);
  if (hole === undefined) return source.trim();
  const arg = /^arg\.(\w+)$/.exec(hole);
  return arg ? scope.args[arg[1]!]?.path ?? hole : hole;
}

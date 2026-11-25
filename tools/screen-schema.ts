/**
 * The JSON Schema of Vela documents, vela-document.v1.json (docs/experiences.md: Versioned schema;
 * docs/plugin-screens.md: Versioning), generated from the TypeScript that Vela draws them with:
 * packages/protocol/screen.ts (the page and surface envelope), skin.ts (the node language and skin
 * documents) and experiences.ts. Its root is the page document (`kind: "screen"`), which Ether
 * validates plugin documents against; skins validate against `#/$defs/SkinDocument`, and action
 * answers' `navigate` is `#/$defs/NavigateAction`. Published lists are data in `$defs`, each a
 * `{ const: [...] }`: `Slots` (the slot list), `RichBlocks` (each rich block's props and parts),
 * `VelaSources` and `VelaActions` (the `vela.*` names Ether accepts), and `Renderer` (the
 * RENDERER_VERSION it describes).
 *
 * Also written: the index of built-in page documents (packages/protocol/fixtures/experiences/
 * index.ts), which bundles every `<experience>/<page>.json` there.
 *
 * The generated files and the digest (VELA_DOCUMENT_SCHEMA_DIGEST, beside RENDERER_VERSION) are
 * committed; `check` fails when any no longer matches, so a change to the language cannot reach one
 * side without the other.
 *
 *   bun tools/screen-schema.ts write    regenerate the schema, the digest and the built-in index
 *   bun tools/screen-schema.ts check    fail on drift (run by the tests)
 *   bun tools/screen-schema.ts print    the schema on stdout
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { SLOTS } from '../packages/protocol/experiences';
import { RICH_BLOCKS } from '../packages/protocol/rich-blocks';
import { VELA_ACTIONS, VELA_SOURCES } from '../packages/protocol/vela-sources';
import { RENDERER_VERSION } from '../packages/skin/src/resolve/version';

const root = resolve(import.meta.dir, '..');
export const SCHEMA_NAME = 'vela-document.v1.json';
export const SCHEMA_FILE = join(root, 'packages/protocol/schemas', SCHEMA_NAME);
const DIGEST_FILE = join(root, 'packages/skin/src/resolve/screen-schema-digest.ts');
const SOURCE = join(root, 'packages/protocol/screen.ts');
const PROTOCOL = join(root, 'packages/protocol') + '/';
const EXPERIENCES = join(root, 'packages/protocol/fixtures/experiences');
export const BUILTIN_INDEX = join(EXPERIENCES, 'index.ts');

/** Wire shapes beside the document, each a named definition (Ether validates answers and frames too),
 * by the protocol module that exports them. */
const DEFINITIONS: Record<string, string[]> = {
  'screen.ts': ['ScreenDocument', 'NavigateAction', 'ScreenData', 'ScreenActionRequest', 'ScreenActionAnswer', 'StreamRecords', 'StreamSource',
    'SurfaceContribution', 'SurfaceContext', 'AlertFrame', 'ScreenNavigationEntry', 'SurfaceRow'],
  'skin.ts': ['SkinDocument'],
  'experiences.ts': ['ExperienceOverride', 'SlotSpec'],
};

/** Published lists, as data (`{ const }`) so the schema stays a valid JSON Schema. */
const DATA: Record<string, { description: string; value: unknown }> = {
  Renderer: { description: 'The RENDERER_VERSION this schema describes.', value: RENDERER_VERSION },
  Slots: { description: 'The published slots (experiences.ts SLOTS): a slot surface fills one by id; context names its {context.*} values; cap bounds surfaces per plugin and per slot.', value: SLOTS },
  RichBlocks: { description: 'Each rich block\'s props, the parts a document may style and the parts whose template it may replace (rich-blocks.ts).', value: RICH_BLOCKS },
  VelaSources: { description: 'The vela.* sources the client answers (vela-sources.ts). Ether accepts `from: "vela.<name>"` only for these, and in a plugin document only {context.*} holes as their arguments.', value: VELA_SOURCES },
  VelaActions: { description: 'The vela.* local actions (press `plugin` with `name: "vela.<name>"`), answered by the client; built-in documents only.', value: VELA_ACTIONS },
};

type Schema = Record<string, unknown>;

/** Keys in a stable order, so the digest follows content, not the compiler's walk. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted((value as Schema)[k])]));
  return value;
}

/** The schema generated from the protocol's types. */
export function generateSchema(): Schema {
  const program = ts.createProgram([SOURCE, join(PROTOCOL, 'experiences.ts')], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(SOURCE);
  if (!file) throw new Error(`Cannot read ${SOURCE}`);
  const defs: Record<string, Schema> = {};
  const inProtocol = (symbol: ts.Symbol | undefined) => !!symbol?.declarations?.some(d => d.getSourceFile().fileName.startsWith(PROTOCOL));
  const docs = (symbol: ts.Symbol | undefined): Schema => {
    const text = symbol ? ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim() : '';
    return text ? { description: text } : {};
  };

  // Aliases the protocol declares (Style is Partial<Record<…>>, which the compiler otherwise names
  // Partial), by the type each stands for, so they are one definition each.
  const aliases = new Map<ts.Type, string>();
  for (const source of [SOURCE, join(PROTOCOL, 'skin.ts'), join(PROTOCOL, 'experiences.ts')]) {
    const module = checker.getSymbolAtLocation(program.getSourceFile(source)!);
    for (const symbol of module ? checker.getExportsOfModule(module) : []) {
      if (!(symbol.flags & ts.SymbolFlags.TypeAlias)) continue;
      const declared = checker.getDeclaredTypeOfSymbol(symbol);
      if (declared.flags & ts.TypeFlags.Object || declared.isUnion()) aliases.set(declared, symbol.name);
    }
  }

  const unionKey = (members: readonly ts.Type[]) => members.map(t => (t as { id?: number }).id).sort().join(',');
  const unionAliases = new Map<string, ts.Type>([...aliases.keys()].filter(t => t.isUnion()).map(t => [unionKey((t as ts.UnionType).types), t]));

  /** A named definition for an interface or a non-generic alias declared in the protocol. */
  function nameOf(type: ts.Type): string | undefined {
    const alias = aliases.get(type);
    if (alias && !(type.isUnion() && type.types.every(t => t.flags & ts.TypeFlags.StringLiteral) && type.types.length < 4)) return alias;
    if (type.aliasSymbol && !type.aliasTypeArguments?.length && inProtocol(type.aliasSymbol)) return type.aliasSymbol.name;
    const symbol = type.getSymbol();
    if (symbol && symbol.flags & ts.SymbolFlags.Interface && inProtocol(symbol) && !(type as ts.TypeReference).typeArguments?.length) return symbol.name;
    return undefined;
  }

  function convert(type: ts.Type, seen = new Set<ts.Type>()): Schema {
    const name = nameOf(type);
    if (name) {
      if (!defs[name]) {
        defs[name] = {};
        defs[name] = { ...docs(aliases.has(type) ? undefined : type.aliasSymbol ?? type.getSymbol()), ...body(type, seen) };
      }
      return { $ref: `#/$defs/${name}` };
    }
    return body(type, seen);
  }

  function body(type: ts.Type, seen: Set<ts.Type>): Schema {
    const f = type.flags;
    if (f & ts.TypeFlags.Any || f & ts.TypeFlags.Unknown || f & ts.TypeFlags.Undefined || f & ts.TypeFlags.Void) return {};
    if (f & ts.TypeFlags.String) return { type: 'string' };
    if (f & ts.TypeFlags.Number) return { type: 'number' };
    if (f & ts.TypeFlags.Boolean) return { type: 'boolean' };
    if (f & ts.TypeFlags.Null) return { type: 'null' };
    if (f & ts.TypeFlags.StringLiteral) return { const: (type as ts.StringLiteralType).value };
    if (f & ts.TypeFlags.NumberLiteral) return { const: (type as ts.NumberLiteralType).value };
    if (f & ts.TypeFlags.BooleanLiteral) return { const: checker.typeToString(type) === 'true' };
    if (type.isUnion()) {
      const members = type.types.filter(t => !(t.flags & ts.TypeFlags.Undefined));
      // An optional field of a named union (`tree?: Node`) refers to its definition.
      const named = members.length > 1 && members.length < type.types.length ? unionAliases.get(unionKey(members)) : undefined;
      if (named) return convert(named, seen);
      if (members.every(t => t.flags & ts.TypeFlags.StringLiteral)) return { enum: members.map(t => (t as ts.StringLiteralType).value).sort() };
      if (members.length === 2 && members.every(t => t.flags & ts.TypeFlags.BooleanLiteral)) return { type: 'boolean' };
      const nonBool = members.filter(t => !(t.flags & ts.TypeFlags.BooleanLiteral));
      const parts = [...(nonBool.length < members.length ? [{ type: 'boolean' }] : []), ...nonBool.map(t => convert(t, seen))];
      return parts.length === 1 ? parts[0]! : { anyOf: parts };
    }
    if (type.isIntersection()) return { allOf: type.types.map(t => convert(t, seen)) };
    if (checker.isArrayType(type)) return { type: 'array', items: convert(checker.getTypeArguments(type as ts.TypeReference)[0]!, seen) };
    if (checker.isTupleType(type)) {
      const items = checker.getTypeArguments(type as ts.TypeReference).map(t => convert(t, seen));
      return { type: 'array', prefixItems: items, minItems: items.length, maxItems: items.length };
    }
    if (f & ts.TypeFlags.Object) {
      if (seen.has(type)) return {};
      seen.add(type);
      const properties: Record<string, Schema> = {};
      const required: string[] = [];
      for (const prop of checker.getPropertiesOfType(type)) {
        const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
        const propType = declaration ? checker.getTypeOfSymbolAtLocation(prop, declaration) : checker.getTypeOfSymbol(prop);
        properties[prop.name] = { ...convert(propType, seen), ...docs(prop) };
        if (!(prop.flags & ts.SymbolFlags.Optional)) required.push(prop.name);
      }
      const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
      seen.delete(type);
      const out: Schema = { type: 'object' };
      if (Object.keys(properties).length) out.properties = properties;
      if (required.length) out.required = required.sort();
      out.additionalProperties = index ? convert(index.type, seen) : false;
      return out;
    }
    throw new Error(`No schema for type ${checker.typeToString(type)}`);
  }

  for (const [module, names] of Object.entries(DEFINITIONS)) {
    const source = program.getSourceFile(join(PROTOCOL, module));
    const exported = new Map(checker.getExportsOfModule(checker.getSymbolAtLocation(source!)!).map(s => [s.name, s]));
    for (const name of names) {
      const symbol = exported.get(name);
      if (!symbol) throw new Error(`packages/protocol/${module} exports no ${name}`);
      convert(checker.getDeclaredTypeOfSymbol(symbol));
    }
  }
  if (!defs.NavigateAction) throw new Error('The schema has no $defs/NavigateAction');
  for (const [name, { description, value }] of Object.entries(DATA)) {
    if (defs[name]) throw new Error(`$defs/${name} is both a type and a published list`);
    defs[name] = { description, const: JSON.parse(JSON.stringify(value)) };
  }
  return sorted({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://vela.app/schemas/${SCHEMA_NAME}`,
    title: 'Vela document',
    description: 'Generated by tools/screen-schema.ts from packages/protocol/screen.ts, skin.ts and experiences.ts. Do not edit. The root is a page document (kind "screen": plugin and built-in pages); skins are #/$defs/SkinDocument.',
    $ref: '#/$defs/ScreenDocument',
    $defs: defs,
  }) as Schema;
}

/**
 * Validate a value against the generated schema (the subset it uses: $ref, type, const, enum,
 * anyOf, allOf, properties, required, additionalProperties, items, prefixItems). Returns the
 * problems as JSON pointers, so the fixtures are checked here as Ether checks plugin documents.
 */
export function validate(schema: Schema, value: unknown, at = '', root: Schema = schema): string[] {
  if (typeof schema.$ref === 'string') {
    const target = (root.$defs as Record<string, Schema>)[schema.$ref.replace('#/$defs/', '')];
    if (!target) return [`${at}: unknown ${schema.$ref}`];
    return validate(target, value, at, root);
  }
  if ('const' in schema && value !== schema.const) return [`${at}: is not ${JSON.stringify(schema.const)}`];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return [`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.length} values`];
  if (Array.isArray(schema.anyOf)) {
    const tries = (schema.anyOf as Schema[]).map(s => validate(s, value, at, root));
    if (tries.some(t => t.length === 0)) return [];
    // The closest branch (fewest problems) explains the failure best.
    return tries.sort((a, b) => a.length - b.length)[0]!;
  }
  if (Array.isArray(schema.allOf)) return (schema.allOf as Schema[]).flatMap(s => validate(s, value, at, root));
  const type = schema.type;
  if (type === 'string' && typeof value !== 'string') return [`${at}: is not a string`];
  if (type === 'number' && typeof value !== 'number') return [`${at}: is not a number`];
  if (type === 'boolean' && typeof value !== 'boolean') return [`${at}: is not a boolean`];
  if (type === 'null' && value !== null) return [`${at}: is not null`];
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${at}: is not a list`];
    if (Array.isArray(schema.prefixItems)) return (schema.prefixItems as Schema[]).flatMap((s, i) => validate(s, value[i], `${at}/${i}`, root));
    return schema.items ? value.flatMap((v, i) => validate(schema.items as Schema, v, `${at}/${i}`, root)) : [];
  }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at}: is not an object`];
    const o = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    const problems = ((schema.required ?? []) as string[]).filter(k => !(k in o)).map(k => `${at}/${k}: is required`);
    for (const [k, v] of Object.entries(o)) {
      if (properties[k]) problems.push(...validate(properties[k]!, v, `${at}/${k}`, root));
      else if (schema.additionalProperties === false) problems.push(`${at}/${k}: is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') problems.push(...validate(schema.additionalProperties as Schema, v, `${at}/${k}`, root));
    }
    return problems;
  }
  return [];
}

export const schemaText = (schema: Schema) => JSON.stringify(schema, null, 2) + '\n';
export const digestOf = (text: string) => createHash('sha256').update(text).digest('hex');

/** The digest recorded beside RENDERER_VERSION. */
export async function recordedDigest(): Promise<string> {
  const text = await readFile(DIGEST_FILE, 'utf8').catch(() => '');
  return /VELA_DOCUMENT_SCHEMA_DIGEST = '([0-9a-f]{64})'/.exec(text)?.[1] ?? '';
}

/** Drift: what no longer matches (empty when the committed schema and digest follow the types). */
export async function drift(): Promise<string[]> {
  const text = schemaText(generateSchema());
  const committed = await readFile(SCHEMA_FILE, 'utf8').catch(() => '');
  const problems: string[] = [];
  if (committed !== text) problems.push(`${SCHEMA_FILE} does not match packages/protocol/screen.ts, skin.ts and experiences.ts`);
  if (await recordedDigest() !== digestOf(text)) problems.push(`VELA_DOCUMENT_SCHEMA_DIGEST in ${DIGEST_FILE} is not the schema's digest`);
  if ((await readFile(BUILTIN_INDEX, 'utf8').catch(() => '')) !== builtinIndexText()) problems.push(`${BUILTIN_INDEX} does not list the built-in documents beside it`);
  // Every screen fixture and built-in document is a valid document.
  const schema = JSON.parse(text) as Schema;
  for (const dir of ['screens', 'experiences']) {
    const fixtures = join(root, 'packages/protocol/fixtures', dir);
    for (const path of new Bun.Glob('**/*.json').scanSync(fixtures)) {
      if (/(^|\/)data/.test(path)) continue;
      const errors = validate(schema, JSON.parse(await readFile(join(fixtures, path), 'utf8')));
      if (errors.length) problems.push(`fixtures/${dir}/${path} is not a valid document: ${errors.slice(0, 5).join('; ')}`);
    }
  }
  return problems;
}

/** The built-in page documents beside the index: `<experience>/<page>.json`, sorted. */
export function builtinFiles(): string[] {
  return [...new Bun.Glob('*/*.json').scanSync(EXPERIENCES)].filter(path => !/(^|\/)data/.test(path)).sort();
}

/** The index bundling every built-in page document (Metro needs each import written out). */
export function builtinIndexText(): string {
  const files = builtinFiles();
  const name = (path: string) => `doc_${path.replace(/\.json$/, '').replace(/[^A-Za-z0-9]/g, '_')}`;
  return `// Written by \`bun tools/screen-schema.ts write\`: every built-in page document beside this file
// (<experience>/<page>.json), bundled with the app. packages/skin/src/resolve/builtin.ts addresses them as
// vela:<experience>/<page>. Do not edit; add or remove a JSON file and run the tool.
import type { ScreenDocument } from '../../screen';
${files.map(path => `import ${name(path)} from './${path}';`).join('\n')}${files.length ? '\n' : ''}
export const BUILTIN_DOCUMENTS: readonly ScreenDocument[] = [${files.map(path => `\n  ${name(path)} as unknown as ScreenDocument,`).join('')}${files.length ? '\n' : ''}];
`;
}

async function write(): Promise<string> {
  const text = schemaText(generateSchema());
  const digest = digestOf(text);
  await mkdir(dirname(SCHEMA_FILE), { recursive: true });
  await writeFile(SCHEMA_FILE, text);
  await writeFile(DIGEST_FILE, `// Written by tools/screen-schema.ts: the SHA-256 of packages/protocol/schemas/${SCHEMA_NAME},
// the JSON Schema of Vela documents (Ether validates plugin documents with it). It changes with the
// document language; \`bun tools/screen-schema.ts check\` fails when it no longer matches the types.
export const VELA_DOCUMENT_SCHEMA_DIGEST = '${digest}';
/** The name the plugin-screens release used. */
export const SCREEN_SCHEMA_DIGEST = VELA_DOCUMENT_SCHEMA_DIGEST;
`);
  await mkdir(EXPERIENCES, { recursive: true });
  await writeFile(BUILTIN_INDEX, builtinIndexText());
  return digest;
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === 'write') console.log(`${SCHEMA_NAME} ${await write()}`);
  else if (command === 'print') process.stdout.write(schemaText(generateSchema()));
  else if (command === 'check') {
    const problems = await drift();
    for (const p of problems) console.log(`FAIL ${p}; run: bun tools/screen-schema.ts write`);
    if (problems.length) process.exit(1);
    console.log(`pass ${SCHEMA_NAME} ${await recordedDigest()}`);
  } else {
    console.error('Usage: bun tools/screen-schema.ts write | check | print');
    process.exit(1);
  }
}

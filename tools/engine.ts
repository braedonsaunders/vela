/**
 * Single-engine source profiles. Exact compiles a component at every call site and has
 * no lazy plan loading, so a release ships one build per layout engine. prepareEngine
 * rewrites a STAGED client (never a working tree) so the foundation dispatches only
 * that engine, plus the cinematic slots it falls back to, and bakes the engine id into
 * foundation/engine.contract. Release packaging (tools/release) and skin packages
 * (tools/skin.ts) both call it. See docs/skin-distribution.md.
 *
 *   bun tools/engine.ts <staged-client-dir> <engine>     (for inspection)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Engines the foundation dispatches; "example" is the extension slot a skin package fills. */
export const ENGINES = ['cinematic', 'index', 'jellytwin', 'mochi', 'marquee', 'example', 'doc'];

/** `skin == "x"` / `skin != "x"` joined by `or`/`and` (no parentheses), for skin = engine. */
function decide(condition: string, engine: string): boolean | undefined {
  const atom = (text: string): boolean | undefined => {
    const m = /^skin (==|!=) "([a-z0-9-]+)"$/.exec(text.trim());
    return m ? (m[1] === '==') === (m[2] === engine) : undefined;
  };
  const ors = condition.split(' or ').map(part => part.split(' and ').map(atom));
  if (ors.some(ands => ands.some(v => v === undefined))) return undefined;
  return ors.some(ands => ands.every(Boolean));
}
const indent = (line: string) => line.length - line.trimStart().length;
const dedent = (lines: string[]) => lines.map(line => line.slice(2));

/** Rewrite `else if C` chains as `else` + a nested `if C`, so every branch is one block. */
function nestElseIf(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)else if (.+)$/.exec(lines[i]);
    if (!m) continue;
    const at = m[1].length;
    let j = i + 1;
    // The rest of the chain: this branch's body, then any later else / else if and their bodies.
    while (j < lines.length && (lines[j].trim() === '' || indent(lines[j]) > at || (indent(lines[j]) === at && /^\s*else\b/.test(lines[j])))) j++;
    const rest = lines.slice(i + 1, j).map(line => line.trim() === '' ? line : `  ${line}`);
    return nestElseIf([...lines.slice(0, i), `${m[1]}else`, `${m[1]}  if ${m[2]}`, ...rest, ...lines.slice(j)]);
  }
  return lines;
}

/** Replace each decidable `if`/`else` on the skin by the branch that runs. */
function pruneBlocks(lines: string[], engine: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)if (.+)$/.exec(lines[i]);
    const verdict = m ? decide(m[2], engine) : undefined;
    if (!m || verdict === undefined) { out.push(lines[i]); continue; }
    const at = m[1].length, body: string[] = [], other: string[] = [];
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || indent(lines[j]) > at)) body.push(lines[j++]);
    if (j < lines.length && indent(lines[j]) === at && lines[j].trim() === 'else') {
      j++;
      while (j < lines.length && (lines[j].trim() === '' || indent(lines[j]) > at)) other.push(lines[j++]);
    }
    out.push(...pruneBlocks(dedent(verdict ? body : other), engine));
    i = j - 1;
  }
  return out;
}

/** Split `a ? b : c ? d : e` at depth zero. */
function ternary(expr: string): string[] | undefined {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (expr.startsWith(' ? ', i) || expr.startsWith(' : ', i))) { parts.push(expr.slice(start, i)); start = i + 3; i += 2; }
  }
  parts.push(expr.slice(start));
  return parts.length % 2 === 1 && parts.length > 1 ? parts : undefined;
}
/** A one-line `fn` whose body is a ternary chain on the skin: keep the branch that runs. */
function pruneFunction(line: string, engine: string): string {
  const m = /^(fn .+? = )\((.+)\)$/.exec(line);
  const parts = m && ternary(m[2]);
  if (!m || !parts) return line;
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const verdict = decide(parts[i], engine);
    if (verdict === undefined) return line;
    if (verdict) return `${m[1]}${parts[i + 1]}`;
  }
  return `${m[1]}${parts[parts.length - 1]}`;
}

/** Drop imported names the file no longer uses, and imports left empty. */
function pruneImports(text: string): string {
  const lines = text.split('\n');
  const body = lines.filter(line => !line.startsWith('use ')).join('\n');
  return lines.flatMap(line => {
    const m = /^use (.+) from ("[^"]+")$/.exec(line);
    if (!m) return [line];
    const kept = m[1].split(', ').filter(item => {
      const local = item.split(' as ').pop()!.trim();
      return new RegExp(`\\b${local}\\b`).test(body);
    });
    return kept.length ? [`use ${kept.join(', ')} from ${m[2]}`] : [];
  }).join('\n');
}

export async function prepareEngine(client: string, engine: string): Promise<void> {
  if (!ENGINES.includes(engine)) throw new Error(`Unknown engine ${engine}; one of ${ENGINES.join(', ')}`);
  const dispatch = join(client, 'foundation/skin.contract');
  const source = await readFile(dispatch, 'utf8');
  const pruned = pruneBlocks(nestElseIf(source.split('\n')), engine).map(line => pruneFunction(line, engine)).join('\n');
  if (/\bskin [!=]= "/.test(pruned)) throw new Error('foundation/skin.contract still dispatches on skin after pruning: a condition the profile cannot decide');
  await writeFile(dispatch, pruneImports(pruned));
  const marker = join(client, 'foundation/engine.contract');
  const engineSource = await readFile(marker, 'utf8');
  if (!engineSource.includes('fn buildEngine(): string = ""')) throw new Error('foundation/engine.contract has no empty buildEngine() to bake');
  await writeFile(marker, engineSource.replace('fn buildEngine(): string = ""', `fn buildEngine(): string = ${JSON.stringify(engine)}`));
}

/** Mount a staged client's routes under /vela, as Ether serves it. */
export async function mountRoutes(client: string): Promise<void> {
  const path = join(client, 'app.contract');
  let count = 0;
  const routed = (await readFile(path, 'utf8')).replace(/^(\s+\w+ )"(\/[^"\n]*)"\s*$/gm, (_line, prefix, route) => {
    // Route declarations are the only bare indented identifier + quoted path lines.
    count++; return `${prefix}"${route === '/' ? '/vela' : '/vela' + route}"`;
  });
  if (!count) throw new Error('No route declarations found to mount under /vela/');
  // Exact permits a non-root first route only with an explicit unmatched-location fallback.
  await writeFile(path, routed.replace(/^(routes \w+\n)([\s\S]*?)(?=^\S)/m, (block, header, declarations) =>
    /^  notfound(?:\s|$)/m.test(declarations) ? block : `${header}${declarations.trimEnd()}\n  notfound\n\n`));
}

if (import.meta.main) {
  const [client, engine] = process.argv.slice(2);
  if (!client || !engine) throw new Error('Usage: bun tools/engine.ts <staged-client-dir> <engine>');
  await prepareEngine(client, engine);
}

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
export const ENGINES = ['cinematic', 'index', 'jellytwin', 'mochi', 'marquee', 'example'];

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
  const pruned = pruneBlocks(source.split('\n'), engine).map(line => pruneFunction(line, engine)).join('\n');
  if (/\bskin [!=]= "/.test(pruned)) throw new Error('foundation/skin.contract still dispatches on skin after pruning: a condition the profile cannot decide');
  await writeFile(dispatch, pruneImports(pruned));
  const marker = join(client, 'foundation/engine.contract');
  const engineSource = await readFile(marker, 'utf8');
  if (!engineSource.includes('fn buildEngine(): string = ""')) throw new Error('foundation/engine.contract has no empty buildEngine() to bake');
  await writeFile(marker, engineSource.replace('fn buildEngine(): string = ""', `fn buildEngine(): string = ${JSON.stringify(engine)}`));
}

if (import.meta.main) {
  const [client, engine] = process.argv.slice(2);
  if (!client || !engine) throw new Error('Usage: bun tools/engine.ts <staged-client-dir> <engine>');
  await prepareEngine(client, engine);
}

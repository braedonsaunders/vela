/**
 * Check a skin document (docs/skin-schema.md): resolve it as the React renderer does
 * (packages/skin/src/resolve.ts) at a phone, a desktop and a TV width, and print its performance
 * report (tools/skin-budget.ts) with pass/fail against the budgets and the style matrix.
 *
 *   bun tools/skin.ts check <document.ts | document.json>
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveDocument } from '../packages/skin/src/resolve/index';
import { BUDGETS } from '../packages/skin/src/resolve/budget';
import { perfReport } from './skin-budget';
import { SYMBOLS } from '../packages/skin/src/icons';
import type { ResolvedDocument, RNode } from '../packages/skin/src/resolve/index';
import { portabilityReport, type PortabilityFinding } from '../packages/skin/src/resolve/portability';
import type { SkinDocument } from '../packages/protocol/skin';

const WIDTHS = [1440, 390, 1920];

async function load(path: string): Promise<SkinDocument> {
  if (path.endsWith('.json')) return JSON.parse(await readFile(path, 'utf8')) as SkinDocument;
  const mod = await import(resolve(path)) as Record<string, unknown>;
  return (mod.default ?? Object.values(mod).find(v => v && typeof v === 'object' && 'schema' in (v as object))) as SkinDocument;
}

/** The style matrix (docs/rn-migration.md): rows refused on native fail, approximated rows are noted. */
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

/** Icon symbols the document names that the renderer has no geometry for: they would draw nothing. */
function unknownSymbols(resolved: ResolvedDocument): string[] {
  const missing = new Set<string>();
  const walk = (node: RNode) => {
    if (node.kind === 'icon' && node.symbol && !node.paths && !SYMBOLS[node.symbol]) missing.add(node.symbol);
    if (node.kind === 'box') node.children.forEach(walk);
    if (node.kind === 'repeat') walk(node.item);
  };
  if (resolved.shell) walk(resolved.shell);
  for (const tree of Object.values(resolved.routes)) if (tree) walk(tree);
  return [...missing].sort();
}

/** Prints the report; returns false when the document fails (unresolvable, over a limit, or unportable). */
export async function checkDocument(path: string): Promise<boolean> {
  const doc = await load(path);
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
  try {
    const symbols = unknownSymbols(resolveDocument(doc, WIDTHS[0]!, 'en'));
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

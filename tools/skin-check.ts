/**
 * Check a skin document (docs/skin-schema.md): resolve it as the client does at a phone, a
 * desktop and a TV width, and print its performance report (client/src/skin/budget.ts) with
 * pass/fail against the budgets. The resolver refuses an over-limit document at load, so a
 * document that fails here fails in the app too.
 *
 *   bun tools/skin.ts check <document.ts | document.json>
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { skinDoc } from '../client/src/skin/index';
import { BUDGETS, perfReport } from '../client/src/skin/budget';
import { portabilityReport, type PortabilityFinding } from '../client/src/skin/portability';
import type { SkinDocument } from '../protocol/v0/skin';

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

/** Prints the report; returns false when the document fails (unresolvable, over a limit, or unportable). */
export async function checkDocument(path: string): Promise<boolean> {
  const doc = await load(path);
  let ok = true, shown = '';
  console.log(`${doc.id}: renderer ${doc.renderer}`);
  for (const width of WIDTHS) {
    let model;
    try { model = skinDoc(doc, width, ''); } catch (e) { console.log(`  ${width}px: refused: ${(e as Error).message}`); ok = false; continue; }
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
  console.log(`  budgets (warn/limit): ${Object.entries(BUDGETS).map(([k, b]) => `${k} ${b.warn}/${b.fail}`).join(', ')}`);
  console.log(ok ? 'pass' : 'FAIL');
  return ok;
}

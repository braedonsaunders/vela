// Compare a legacy capture set with a document capture set and write the parity report.
//
//   bun tools/parity/compare.ts --legacy <dir> --document <dir> --out <dir>
//
// Each directory holds a capture tool's manifest.json, captures and frames/. For every view both
// captured, the moving mask is what moved between each set's two frames (union of both), and the
// diff is taken outside it. Writes report.md (the results table), results.json and diffs/*.png.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { decodePng, encodePng } from './png';
import { diffImages, movingMask, RULE, verdict, type Rect } from './diff';
import { CAPTURE_SCALE, DEVICE_MASKS, reviewed as sportsReviewed } from './views';
import { listenReviewed } from './listen-views';
import { readReviewed } from './read-views';

interface Capture { viewport: string; view: string; file: string; frame: string; description: string; review?: string; ok: boolean; error?: string; reviewedRegions?: (Rect & { note: string })[] }
interface Manifest { variant: string; experience?: string; platform: string; now: string; captures: Capture[] }

const { values } = parseArgs({ options: { legacy: { type: 'string' }, document: { type: 'string' }, out: { type: 'string' }, threshold: { type: 'string' } } });
if (!values.legacy || !values.document || !values.out) throw new Error('--legacy, --document and --out are required');
const legacyDir = resolve(values.legacy), documentDir = resolve(values.document), out = resolve(values.out);
mkdirSync(join(out, 'diffs'), { recursive: true });
const read = (dir: string) => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
const legacy = read(legacyDir), document = read(documentDir);
if (legacy.now !== document.now) console.warn(`warning: the sets were captured at different frozen instants (${legacy.now} vs ${document.now})`);
const threshold = Number(values.threshold ?? 10);
// The experience the sets capture (Sports when the manifest does not say) picks its reviewed list.
const experience = legacy.experience;
const reviewed = experience === 'read' ? readReviewed : experience === 'listen' ? listenReviewed : sportsReviewed;
const label = experience === 'read' ? 'Read' : experience === 'listen' ? 'Listen' : 'Sports';
const png = (dir: string, file: string) => decodePng(new Uint8Array(readFileSync(join(dir, file))));

interface Row { viewport: string; view: string; description: string; status: 'pass' | 'fail' | 'review' | 'missing'; percent?: number; maxDisplacement?: number; changed?: number; masked?: number; reasons: string[]; reviewedNotes?: string[]; moved?: { x: number; y: number; width: number; height: number; shift: { dx: number; dy: number } | null }[]; legacy?: string; document?: string; diff?: string; review?: string }
const rows: Row[] = [];
for (const before of legacy.captures) {
  const after = document.captures.find(c => c.viewport === before.viewport && c.view === before.view);
  const row: Row = { viewport: before.viewport, view: before.view, description: before.description, status: 'missing', reasons: [], review: reviewed({ name: before.view }, before.viewport) };
  rows.push(row);
  if (!before.ok || !after?.ok) { row.reasons.push(!before.ok ? `legacy capture failed: ${before.error?.split('\n')[0]}` : after ? `document capture failed: ${after.error?.split('\n')[0]}` : 'no document capture'); continue; }
  const a = png(legacyDir, before.file), b = png(documentDir, after.file);
  const mask: Rect[] = [...(DEVICE_MASKS[before.viewport] ?? []), ...(after.reviewedRegions ?? []).map(({ note: _n, ...rect }) => rect)];
  const reviewedNotes = [...new Set((after.reviewedRegions ?? []).map(r => r.note))];
  for (const [dir, capture, image] of [[legacyDir, before, a], [documentDir, after, b]] as const) {
    if (existsSync(join(dir, capture.frame))) mask.push(...movingMask(image, png(dir, capture.frame)));
  }
  const result = diffImages(a, b, { mask, threshold });
  const diffFile = join('diffs', basename(before.file));
  writeFileSync(join(out, diffFile), encodePng(result.image));
  // Moves are judged in points: a 2x screenshot's 2 px is 1 point.
  const scale = experience === 'read' && before.viewport === 'ios-fold' ? 3 : CAPTURE_SCALE[before.viewport] ?? 1;
  // A move is an element's: regions under 10 square points (a glyph's dot, anti-aliasing) cannot be
  // told apart from noise by translation, so they count in the percentage only.
  const counted = result.regions.filter(r => r.displacement !== null && r.pixels >= 10 * scale * scale);
  result.maxDisplacement = counted.length ? Math.round((Math.max(...counted.map(r => r.displacement!)) / scale) * 100) / 100 : 0;
  const judged = verdict(result);
  Object.assign(row, {
    status: row.review ? 'review' : judged.pass ? 'pass' : 'fail', percent: result.percent, maxDisplacement: result.maxDisplacement, changed: result.changed,
    masked: mask.length, reasons: judged.reasons, ...(reviewedNotes.length ? { reviewedNotes } : {}),
    // The regions that moved too far, for finding them on the diff picture.
    moved: counted.filter(r => r.displacement! / scale > RULE.maxDisplacement).slice(0, 12).map(({ x, y, width, height, shift }) => ({ x, y, width, height, shift })),
    legacy: relative(out, join(legacyDir, before.file)), document: relative(out, join(documentDir, after.file)), diff: diffFile,
  });
}

writeFileSync(join(out, 'results.json'), JSON.stringify({ legacy: legacyDir, document: documentDir, rule: RULE, threshold, rows }, null, 2));
const count = (status: Row['status']) => rows.filter(r => r.status === status).length;
const lines = [
  `# ${label} parity: ${legacy.platform}`, '',
  `Rule: at most ${RULE.maxPercent}% of pixels differ outside the moving regions, nothing moves more than ${RULE.maxDisplacement} px. Channel threshold ${threshold}/255. Frozen at ${legacy.now}.`, '',
  `Pass ${count('pass')} · fail ${count('fail')} · review ${count('review')} · missing ${count('missing')}`, '',
  '| Viewport | View | Result | % differing | Max move (px) | Content changes | Masked regions | Notes | Images |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(r => `| ${r.viewport} | ${r.view} | ${r.status} | ${r.percent ?? ''} | ${r.maxDisplacement ?? ''} | ${r.changed ?? ''} | ${r.masked ?? ''} | ${[...r.reasons, r.review ?? '', ...(r.reviewedNotes ?? []).map(n => `reviewed, left out: ${n}`)].filter(Boolean).join('; ')} | ${r.diff ? `[legacy](${r.legacy}) · [document](${r.document}) · [diff](${r.diff})` : ''} |`),
  '',
];
writeFileSync(join(out, 'report.md'), lines.join('\n'));
console.log(lines.slice(0, 5).join('\n'));
if (count('fail') || count('missing')) process.exitCode = 1;

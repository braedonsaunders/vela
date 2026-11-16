/**
 * Vela skins are documents (docs/skin-schema.md): data the app's one renderer draws.
 *
 *   bun tools/skin.ts check <document.ts|.json>   a document's performance report (tools/skin-check.ts)
 *   bun tools/skin.ts documents <out>             write the built-in documents (tools/skin-documents.ts)
 */
import { resolve } from 'node:path';
const [command, target] = process.argv.slice(2);
try {
  if (command === 'check' && target) { if (!await (await import('./skin-check')).checkDocument(target)) process.exitCode = 1; }
  else if (command === 'documents' && target) console.log(JSON.stringify(await (await import('./skin-documents')).writeDocuments(resolve(target)), null, 2));
  else throw new Error('Usage: bun tools/skin.ts check <document.ts|.json> · documents <out>');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

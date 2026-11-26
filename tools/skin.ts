/**
 * Vela skins and experience pages are documents (docs/skin-schema.md, docs/experiences.md):
 * data the app's one renderer draws.
 *
 *   bun tools/skin.ts check [--json] <document.ts|.json>   a document's validator & performance report (tools/skin-check.ts)
 *   bun tools/skin.ts serve <document.ts|.json> [options]  watch & serve a document to Vela's multi-frame preview (tools/skin-serve.ts)
 *   bun tools/skin.ts documents <out>                      write the built-in documents (tools/skin-documents.ts)
 */
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

try {
  if (command === 'check') {
    const json = rest.includes('--json');
    const target = rest.find(a => !a.startsWith('-'));
    if (!target) throw new Error('Usage: bun tools/skin.ts check [--json] <document.ts|.json>');
    if (!await (await import('./skin-check')).checkDocument(target, { json })) process.exitCode = 1;
  } else if (command === 'serve') {
    const target = rest.find(a => !a.startsWith('-'));
    if (!target) throw new Error('Usage: bun tools/skin.ts serve <document.ts|.json> [--port <port>] [--server <url>] [--app <url>]');
    await (await import('./skin-serve')).runServeCli(rest);
  } else if (command === 'documents' && rest[0]) {
    console.log(JSON.stringify(await (await import('./skin-documents')).writeDocuments(resolve(rest[0])), null, 2));
  } else {
    throw new Error('Usage: bun tools/skin.ts check [--json] <document.ts|.json> · serve <document.ts|.json> · documents <out>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

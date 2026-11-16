/**
 * Vela skins are documents (docs/skin-schema.md): data the app's one renderer draws.
 *
 *   bun tools/skin.ts check <document.ts|.json>   a document's performance report (tools/skin-check.ts)
 *   bun tools/skin.ts documents <out>             write the built-in documents (tools/skin-documents.ts)
 *   bun tools/skin.ts generate [<client>]         regenerate client/foundation/skins.generated.contract
 *                                                 while compiled packages remain (removed with them)
 */
import { join, relative, resolve } from 'node:path';
import { generateRegistry, installed } from './skin-registry';

const root = resolve(import.meta.dir, '..');
const [command, target] = process.argv.slice(2);
try {
  if (command === 'check' && target) { if (!await (await import('./skin-check')).checkDocument(target)) process.exitCode = 1; }
  else if (command === 'documents' && target) console.log(JSON.stringify(await (await import('./skin-documents')).writeDocuments(resolve(target)), null, 2));
  else if (command === 'generate') {
    const client = target ? resolve(target) : join(root, 'client');
    await generateRegistry(client);
    console.log(`${relative(root, join(client, 'foundation/skins.generated.contract'))}: ${(await installed(client)).map(f => f.skin.id).join(', ')}`);
  }
  else throw new Error('Usage: bun tools/skin.ts check <document.ts|.json> · documents <out> · generate [<client>]');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

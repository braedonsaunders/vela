// Published skin URLs (/vela/skins/<id>/<version>/...) are immutable: Ether keeps them for open tabs
// and refuses a release that changes their bytes. Any change to a built-in skin's published files
// therefore needs a new version. This checks the built output against skin-versions.lock.json.
//   Update the lock after a deliberate version bump: VELA_UPDATE_SKIN_LOCK=1 bun test skin-versions
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { writeDocuments } from '../../../tools/skin-documents';

const lockFile = join(import.meta.dir, 'skin-versions.lock.json');

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out.sort();
}

describe('built-in skin versions', () => {
  test('a skin whose published files changed has a new version', async () => {
    const out = await mkdtemp(join(tmpdir(), 'vela-skins-'));
    try {
      const refs = await writeDocuments(out);
      const current: Record<string, string> = {};
      for (const ref of refs) {
        const dir = join(out, ref.id, ref.version);
        const hash = createHash('sha256');
        for (const file of await files(dir)) hash.update(relative(dir, file)).update('\0').update(await readFile(file)).update('\0');
        current[`${ref.id}@${ref.version}`] = hash.digest('hex');
      }
      if (process.env.VELA_UPDATE_SKIN_LOCK === '1') {
        const previous = JSON.parse(await readFile(lockFile, 'utf8').catch(() => '{}')) as Record<string, string>;
        await writeFile(lockFile, JSON.stringify({ ...previous, ...current }, Object.keys({ ...previous, ...current }).sort(), 2) + '\n');
        return;
      }
      const lock = JSON.parse(await readFile(lockFile, 'utf8')) as Record<string, string>;
      for (const [key, hash] of Object.entries(current)) {
        if (key in lock) expect({ skin: key, hash }).toEqual({ skin: key, hash: lock[key]! });
        else throw new Error(`${key} is not in skin-versions.lock.json; after a deliberate version bump run VELA_UPDATE_SKIN_LOCK=1 bun test skin-versions`);
      }
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 60000);
});

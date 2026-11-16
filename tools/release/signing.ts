import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
export const output = resolve(import.meta.dir, '../../.artifacts/release');
export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export async function command(cmd: string[], capture = false): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: capture ? 'pipe' : 'inherit', stderr: 'inherit' });
  const result = capture ? await new Response(p.stdout).text() : '';
  if (await p.exited) throw new Error(`Command failed: ${cmd[0]}`);
  return result.trim();
}
export async function keychain(operation: 'init'|'public'|'sign', identity: string, file?: string): Promise<string> {
  if (!['production-v1','production-v2','lab-test-v1'].includes(identity)) throw new Error('Unknown signing identity');
  const pinnedHelper = process.env.VELA_SIGNING_HELPER;
  if (pinnedHelper) return command([resolve(pinnedHelper), operation, identity, ...file ? [file] : []], true);
  const source = join(import.meta.dir, 'keychain.swift');
  const dir = join(output, '.signing'); await mkdir(dir, {recursive:true});
  const executable = join(dir, `keychain-${sha256(await readFile(source)).slice(0,16)}`);
  if (!await Bun.file(executable).exists()) await command(['swiftc', source, '-o', executable]);
  return command([executable, operation, identity, ...file ? [file] : []], true);
}
export function verifySignature(bytes: Uint8Array, signature: string, publicKey: string) {
  const key = Buffer.from(publicKey, 'base64'), sig = Buffer.from(signature.trim(), 'base64');
  if (key.length !== 32 || sig.length !== 64) throw new Error('Invalid Ed25519 key/signature length');
  const spki = createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key]),format:'der',type:'spki'});
  if (!verify(null, bytes, spki, sig)) throw new Error('Release signature verification failed');
}
if (import.meta.main) {
  const [operation, identity] = process.argv.slice(2);
  if (!['init','public'].includes(operation)) throw new Error('Usage: bun tools/release/signing.ts <init|public> <production-v1|lab-test-v1>');
  console.log(await keychain(operation as 'init'|'public', identity)); // Public key only.
}

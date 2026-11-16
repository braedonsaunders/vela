// Starts mock-server/main.ts on a free port for one test file and stops it afterwards. The mock
// starts serving at import, so it runs as its own process rather than in the test's.
import { join } from 'node:path';

export interface RunningMock { url: string; stop(): Promise<void> }

export async function launchMock(env: Record<string, string> = {}): Promise<RunningMock> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'main.ts')], {
    env: { ...process.env, PORT: '0', ...env },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let output = '';
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
    const match = /Vela mock: (http:\/\/\S+?)\/? /.exec(output);
    if (match) {
      reader.releaseLock();
      return { url: match[1]!, stop: async () => { child.kill(); await child.exited; } };
    }
  }
  child.kill();
  throw new Error(`Mock server did not start: ${output}`);
}

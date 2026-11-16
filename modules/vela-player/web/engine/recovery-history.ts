import { redactMediaError } from './media-auth';
import type { RecoveryDiagnostic } from './model';

/** No URLs, source identifiers, credentials or packet bytes are retained. */
export function recoveryMessage(message: string): string {
  return redactMediaError(message)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[media URL]')
    .replace(/\/(?:vela\/v0\/)?sessions\/media\/[^\s<>"']+/gi, '[media path]')
    .slice(0, 512);
}

/** Owned by one engine/session, independent of its disposable source backend. */
export class RecoveryHistory {
  private entries: RecoveryDiagnostic[] = [];
  record(entry: RecoveryDiagnostic): void {
    this.entries.push({ ...entry, message: recoveryMessage(entry.message) });
    if (this.entries.length > 8) this.entries.shift();
  }
  snapshot(): RecoveryDiagnostic[] {
    return this.entries.map((entry) => ({ ...entry }));
  }
  get length() {
    return this.entries.length;
  }
  clear(): void {
    this.entries = [];
  }
}

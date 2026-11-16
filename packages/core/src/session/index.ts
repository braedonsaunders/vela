import type { Device, Tokens } from '../wire';
import type { Credentials } from '../adapter';

/** Secrets (sessions, server tokens, the device ID): the Keychain or Keystore natively, the page's
 * storage on the web. Synchronous, so a credential read never waits on a bridge round trip. */
export interface SecretStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}
export class SessionCredentials implements Credentials {
  constructor(private store: SecretStore, readonly device: Device, readonly refreshKey: () => string) {}
  async get(): Promise<Tokens | null> {
    const value = this.store.get('vela.session');
    return value ? JSON.parse(value) as Tokens : null;
  }
  async set(tokens: Tokens | null): Promise<void> { this.store.set('vela.session', tokens ? JSON.stringify(tokens) : ''); }
}

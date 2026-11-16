import type { Device, Tokens } from '../../wire/v0/types';
import type { Credentials } from '../adapter';

/** Exact's secret store is synchronous; secret.keep vela.session is required. */
export interface SecretStore { get(key: string): string | null | undefined; set(key: string, value: string): void }
export class SessionCredentials implements Credentials {
  constructor(private store: SecretStore, readonly device: Device, readonly refreshKey: () => string) {}
  async get(): Promise<Tokens | null> {
    const value = this.store.get('vela.session');
    return value ? JSON.parse(value) as Tokens : null;
  }
  async set(tokens: Tokens | null): Promise<void> { this.store.set('vela.session', tokens ? JSON.stringify(tokens) : ''); }
}

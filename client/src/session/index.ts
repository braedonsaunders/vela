import type { Device, DevicePollRequest, GrantPoll, QuickPollRequest, SignInRequest, Tokens } from '../../../protocol/v0/types';
import type { ServerAdapter } from '../adapter';
import type { Credentials } from '../adapter/ether';

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
export class Session {
  constructor(private adapter: ServerAdapter, private credentials: Credentials) {}
  async signIn(request: SignInRequest): Promise<Tokens> {
    const tokens = await this.adapter.signIn(request);
    await this.credentials.set(tokens);
    return tokens;
  }
  async pollDevice(request: DevicePollRequest): Promise<GrantPoll> { return this.accept(await this.adapter.pollDevice(request)); }
  async pollQuickConnect(request: QuickPollRequest): Promise<GrantPoll> { return this.accept(await this.adapter.pollQuickConnect(request)); }
  private async accept(result: GrantPoll): Promise<GrantPoll> {
    if (result.status === 'approved') await this.credentials.set(result.tokens);
    return result;
  }
  async signOut(idempotencyKey: string): Promise<void> {
    const tokens = await this.credentials.get();
    if (!tokens) return;
    await this.adapter.revoke({ refreshToken: tokens.refreshToken, idempotencyKey });
    const current = await this.credentials.get();
    if (current?.refreshToken === tokens.refreshToken) await this.credentials.set(null);
  }
}

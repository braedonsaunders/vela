import type { SecretStore } from './index';

/** One native app process owns its secure store. Avoid decrypting the same value on every
 * render/request; writes remain durable before readers can observe the new value. */
export function cachedSecretStore(store: SecretStore): SecretStore {
  const values = new Map<string, string | null>();
  return {
    get(key) {
      if (values.has(key)) return values.get(key)!;
      const value = store.get(key);
      values.set(key, value);
      return value;
    },
    set(key, value) {
      store.set(key, value);
      values.set(key, value);
    },
  };
}

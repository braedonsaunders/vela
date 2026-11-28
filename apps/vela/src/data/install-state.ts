import type { SecretStore } from '@vela/core';

export const INSTALL_MARKER = 'vela.install-initialized';

const SESSION_KEYS = [
  'vela.servers',
  'vela.server-sessions',
  'vela.session',
  'vela.plex-accounts',
  'vela.device',
] as const;

interface InstallSecrets {
  containerCreatedAt(): number | null;
  secretUpdatedAt(key: string): number | null;
  removeSecret(key: string): void;
}

/** Run before the app constructs a session or reads any cached secrets. */
export function initializeAppleInstall(preferences: SecretStore, secrets: InstallSecrets): void {
  if (preferences.get(INSTALL_MARKER) === '1') return;

  const createdAt = secrets.containerCreatedAt();
  // Versions before the marker can have a populated Keychain on upgrade and on
  // reinstall. A write during this container's lifetime is evidence of an upgrade.
  const existingInstall = SESSION_KEYS.some(key => {
    const updatedAt = secrets.secretUpdatedAt(key);
    return updatedAt !== null && (createdAt === null || updatedAt >= createdAt);
  });
  if (!existingInstall) {
    for (const key of SESSION_KEYS) secrets.removeSecret(key);
  }

  preferences.set(INSTALL_MARKER, '1');
}

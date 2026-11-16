// Secrets on the web: the page's own storage for its origin, as the Exact client kept them.
// Nothing else on the origin runs third-party script (docs/architecture.md, decision 4).
import type { SecretStore } from '@vela/core';

export const secrets: SecretStore = {
  get: key => localStorage.getItem(key),
  set: (key, value) => localStorage.setItem(key, value),
};

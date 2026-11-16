// Plain preferences on the web: the page's storage, under their own prefix.
import type { SecretStore } from '@vela/core';

const PREFIX = 'vela.pref.';

export const preferences: SecretStore = {
  get: key => localStorage.getItem(PREFIX + key),
  set: (key, value) => localStorage.setItem(PREFIX + key, value),
};

// The signed-out page's vocabulary (docs/skin-schema.md, renderers 11 and 12): `env.auth`,
// `signin.*`, `quick.*`, the stage art, and the code drawn one tile per character
// (`quick.chars`, each `char.text`). Spread into the renderer's vocabulary; the semantics are the
// Contract renderer's (tools/renderer.ts), key for key. Outside the signed-out page every key
// reads empty.
import type { Accessor, Ctx, Env } from '../../vocabulary';
import type { AuthView } from './model';

const yes = (value: boolean) => (value ? 'true' : 'false');

function auth(read: (view: AuthView) => string): Accessor {
  return (_, e) => (e.auth ? read(e.auth) : '');
}

export const AUTH_VOCABULARY: Record<string, Accessor> = {
  'env.auth': auth(a => a.stage),
  'env.authBackdrop': auth(a => a.backdrop),
  'env.authWordmark': auth(a => a.wordmark),
  'signin.error': auth(a => a.error),
  'signin.busy': auth(a => yes(a.busy)),
  'signin.ready': auth(a => yes(a.ready)),
  'signin.canPassword': auth(a => yes(a.canPassword)),
  'signin.canQuick': auth(a => yes(a.canQuick)),
  'signin.secureOrigin': auth(a => a.secure.origin),
  'signin.secureBusy': auth(a => yes(a.secure.busy)),
  'signin.secureError': auth(a => a.secure.error),
  'quick.code': auth(a => a.quick.code),
  'quick.expires': auth(a => a.quick.expires),
  'quick.error': auth(a => a.quick.error),
  // A code character is the item's fact, as in the Contract renderer.
  'char.text': c => c.fact ?? '',
};

/** `quick.chars`: the quick-connect code, one item per character. */
export function quickChars(c: Ctx, e: Env, limit: number): Ctx[] {
  const code = e.auth?.quick.code ?? '';
  return [...code].slice(0, limit).map((fact, index) => ({ ...c, fact, index }));
}

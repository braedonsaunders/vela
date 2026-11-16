// What the signed-out page shows, as documents read it (docs/skin-schema.md, renderers 11 and
// 12): which notice or form is up, the sign-in options the server offers, the quick-connect code
// and the secure-origin offer. The app derives it from the session; documents only read it.
// The typed username and password are not here: they live in the sign-in form (form.tsx), so no
// document can read a password.

/** `env.auth`: a notice (offline, connecting, redeeming a web code) or a form (password, code). */
export type AuthStage = 'offline' | 'connecting' | 'redeeming' | 'signin' | 'quick';

export interface AuthView {
  stage: AuthStage;
  /** The last sign-in failure, in the viewer's words. */
  error: string;
  /** A sign-in or a quick-connect start is in flight. */
  busy: boolean;
  /** A username and a password are typed and nothing is in flight. */
  ready: boolean;
  canPassword: boolean;
  canQuick: boolean;
  quick: { code: string; expires: string; error: string };
  /** The HTTPS address this server also answers at, offered before a password is typed over HTTP. */
  secure: { origin: string; busy: boolean; error: string };
  /** A server pack's stage art (image paths), or empty. */
  backdrop: string;
  wordmark: string;
}

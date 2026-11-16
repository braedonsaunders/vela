// Client strings in a skin document's text (docs/skin-schema.md, renderer 15): `{t:ui.signIn}`
// is the app's own string in the viewer's locale, so the Vela base needs no strings of its own
// and stays translated. A string's placeholders may be bound to the vocabulary:
// `{t:secure.body|origin=signin.secureOrigin}` fills {origin} with the binding at render time.
import { msg } from '@vela/core';

const CLIENT_STRING = /\{t:([a-zA-Z0-9._-]+)(?:\|([a-zA-Z0-9_]+=[a-zA-Z.]+(?:,[a-zA-Z0-9_]+=[a-zA-Z.]+)*))?\}/g;

function bindings(list: string | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of (list ?? '').split(',').filter(Boolean)) {
    const [name, key] = pair.split('=');
    params[name] = `{${key}}`;
  }
  return params;
}

/** The text with every `{t:…}` replaced by its string; bound placeholders become vocabulary holes. */
export function withClientStrings(text: string): string {
  return text.replace(CLIENT_STRING, (_, key: string, list: string | undefined) => {
    const found = msg(key, bindings(list));
    if (found === key) throw new Error(`Unknown client string ${key}`);
    return found;
  });
}

// Written by tools/screen-schema.ts: the SHA-256 of packages/protocol/schemas/vela-document.v1.json,
// the JSON Schema of Vela documents (Ether validates plugin documents with it). It changes with the
// document language; `bun tools/screen-schema.ts check` fails when it no longer matches the types.
export const VELA_DOCUMENT_SCHEMA_DIGEST = 'e352ff6bdd4d390332089f8d4d4ed7eaa13098c0b7ed1957035d9dc4d62536ce';
/** The name the plugin-screens release used. */
export const SCREEN_SCHEMA_DIGEST = VELA_DOCUMENT_SCHEMA_DIGEST;

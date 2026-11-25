// Written by tools/screen-schema.ts: the SHA-256 of packages/protocol/schemas/vela-document.v1.json,
// the JSON Schema of Vela documents (Ether validates plugin documents with it). It changes with the
// document language; `bun tools/screen-schema.ts check` fails when it no longer matches the types.
export const VELA_DOCUMENT_SCHEMA_DIGEST = '503370ae6b734f512630129ff5a95dec844ad0c5a8033b7f4eb846699eb03c9a';
/** The name the plugin-screens release used. */
export const SCREEN_SCHEMA_DIGEST = VELA_DOCUMENT_SCHEMA_DIGEST;

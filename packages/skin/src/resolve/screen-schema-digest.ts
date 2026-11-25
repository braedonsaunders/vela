// Written by tools/screen-schema.ts: the SHA-256 of packages/protocol/schemas/vela-document.v1.json,
// the JSON Schema of Vela documents (Ether validates plugin documents with it). It changes with the
// document language; `bun tools/screen-schema.ts check` fails when it no longer matches the types.
export const VELA_DOCUMENT_SCHEMA_DIGEST = 'e36414e36f977abcd2b61118a4f8f5b969564f9fb2bd7c7fa30298eb63b5451d';
/** The name the plugin-screens release used. */
export const SCREEN_SCHEMA_DIGEST = VELA_DOCUMENT_SCHEMA_DIGEST;

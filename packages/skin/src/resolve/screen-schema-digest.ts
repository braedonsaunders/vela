// Written by tools/screen-schema.ts: the SHA-256 of packages/protocol/schemas/vela-document.v1.json,
// the JSON Schema of Vela documents (Ether validates plugin documents with it). It changes with the
// document language; `bun tools/screen-schema.ts check` fails when it no longer matches the types.
export const VELA_DOCUMENT_SCHEMA_DIGEST = '529aa3458e94c3e25cbb5377d24f12dbbabc7e5d26a566d2eb2d5f63ca8a81f0';
/** The name the plugin-screens release used. */
export const SCREEN_SCHEMA_DIGEST = VELA_DOCUMENT_SCHEMA_DIGEST;

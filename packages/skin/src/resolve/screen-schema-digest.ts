// Written by tools/screen-schema.ts: the SHA-256 of packages/protocol/schemas/vela-document.v1.json,
// the JSON Schema of Vela documents (Ether validates plugin documents with it). It changes with the
// document language; `bun tools/screen-schema.ts check` fails when it no longer matches the types.
export const VELA_DOCUMENT_SCHEMA_DIGEST = '62fbe8157cca361ef9ec557f297b9185a6fe5ae7a6e4cb58151650113a8ae5dc';
/** The name the plugin-screens release used. */
export const SCREEN_SCHEMA_DIGEST = VELA_DOCUMENT_SCHEMA_DIGEST;

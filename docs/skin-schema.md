# Skin schema

The canonical schema is [packages/protocol/skin.ts](../packages/protocol/skin.ts).
It defines schema-1 JSON documents, node types, bindings, conditions, styles,
motion and asset metadata. Consult its exported types for accepted fields;
[fixtures](../packages/protocol/fixtures) provide concrete documents.

Resolution lives in `packages/skin/src/resolve` and rendering in
`packages/skin/src/render.tsx`. Web and native style support can differ; inspect
the affected document on the target platform before claiming compatibility.

See [authoring](skin-authoring.md) and [distribution](skin-distribution.md).

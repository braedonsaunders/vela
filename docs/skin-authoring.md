# Authoring skins

A skin is a JSON document plus assets. Start with the examples in
[protocol fixtures](../packages/protocol/fixtures) and the
[canonical schema](../packages/protocol/skin.ts). Built-in documents live under
`packages/protocol/fixtures/skins`; the React renderer lives in `packages/skin/src`.

Use the fixed binding and action vocabulary to present app data and request app
interactions. Skins must not contain credentials, execute code or make requests.
Resolve and display your document through the RN app, checking navigation,
focus, reduced motion and the target screen size. A TypeScript compile alone
does not verify the appearance or interaction.

See [schema](skin-schema.md) and [distribution](skin-distribution.md).

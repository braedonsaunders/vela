# Authoring skins

A skin is a JSON document plus assets. Start with the examples in
[protocol fixtures](../packages/protocol/fixtures) and the
[canonical schema](../packages/protocol/skin.ts). Built-in documents live under
`packages/protocol/fixtures/skins`; the React renderer lives in `packages/skin/src`.

Use the fixed binding and action vocabulary to present app data and request app
interactions. Draw the profile menu with the `profileMenu` node and a look in
`profileMenus`, not with hand-built rows. The app supplies its entries, so features it adds later
reach your skin without an edit. A look restyles the entries (`parts`), arranges them
(`sections`), relabels one (`entries`) and adds your own rows (`extras`); see
[Profile menu](skin-schema.md#profile-menu). Late Night's setup menu
(`packages/protocol/fixtures/skins/latenight/document.ts`) is a complete example.

Skins must not contain credentials, execute code or make requests.
Resolve and display your document through the RN app, checking navigation,
focus, reduced motion and the target screen size. A TypeScript compile alone
does not verify the appearance or interaction.

See [schema](skin-schema.md) and [distribution](skin-distribution.md).

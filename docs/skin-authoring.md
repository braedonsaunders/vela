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

For title pages that draw their own facts, put a `detail.ratings` repeat beside them
and guard its container with `detail.hasRatings`. Use `rating.display` for the visible
text and `rating.accessibleLabel` for its label. Pair an icon with its value and
following separator in a single item so they wrap together. Declare renderer 23.
See [the ratings vocabulary](skin-schema.md#renderer-23) and the built-in
[ratings line](../packages/protocol/fixtures/skins/title-ratings.ts).

Skins must not contain credentials, execute code or make requests.
Resolve and display your document through the RN app, checking navigation,
focus, reduced motion and the target screen size. A TypeScript compile alone
does not verify the appearance or interaction.

See [schema](skin-schema.md) and [distribution](skin-distribution.md).

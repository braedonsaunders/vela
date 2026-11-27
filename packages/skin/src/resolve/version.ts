// The renderer's version, on its own so tools (tools/screen-schema.ts) read it without the resolver.

/** The highest document renderer version this renderer draws (docs/skin-schema.md). Renderer 19
 * adds plugin screen documents and their blocks (docs/plugin-screens.md); renderer 20 adds built-in
 * page documents, skin experience overrides, platform and form variants, rich blocks and their parts,
 * generic block fallbacks and slot surfaces (docs/experiences.md); renderer 21 adds the bindings
 * env.canManageLibraries and nav.showLive and the press action manageLibraries; renderer 22 adds the
 * profile menu primitive (the `profileMenu` node and the document's `profileMenus` looks), the
 * binding env.canDownloads and the press actions downloads and addServer. */
export const RENDERER_VERSION = 22;

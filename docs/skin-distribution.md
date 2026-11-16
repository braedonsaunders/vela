# Skin distribution

Skin documents and assets are versioned independently of the application.
Published `skins/<id>/<version>/` URLs are immutable. Change the skin version
and update preview/font references whenever bundled documents or assets change.
Renderer-only changes use the renderer source digest.

`tools/skin-documents.ts` exports the bundled catalogue; `tools/skin-renderer.ts`
provides renderer release metadata. Release inventories cover skin files along
with the application. Clients must respect document renderer requirements.
See [web distribution](distribution.md) for packaging.

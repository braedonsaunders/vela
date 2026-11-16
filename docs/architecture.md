# Architecture

Vela is a React Native / Expo media client. The app targets web through
react-native-web and Apple and Android devices through native hosts. Platform
support is under active development; a build does not establish device parity.

| Path | Responsibility |
| --- | --- |
| `apps/vela` | Expo routes, screens, platform storage and app assets |
| `packages/core` | Server adapters, sessions, discovery, search and common models |
| `packages/skin` | Skin resolution, theme vocabulary, React renderer and widgets |
| `packages/protocol` | Wire types, skin schema and fixtures |
| `packages/player-api` | Shared player view contract |
| `modules/vela-player` | Native playback module and web player |
| `mock-server` | Fixture-backed Bun protocol server |
| `tools/release` | Web export, inventory, signing and distribution tooling |

Ether is the reference server adapter; Jellyfin/Emby and Plex share the adapter
boundary. Credentials belong to platform storage and transport, never skins.
See the [protocol reference](../packages/protocol/README.md) and canonical
[wire types](../packages/protocol/types.ts).

Skins are schema-1 JSON documents rendered by the shared React renderer. They
contain layout, styles and bindings, not executable extensions. Native playback
uses libmpv through the Expo module. Web uses the WebCodecs/WebGPU engine and
external assets identified by payload digest.

Ether serves web/PWA exports under `/vela/`. Distribution uses signed inventories,
verified installation, atomic activation and rollback. Native applications have
separate delivery requirements. See [distribution](distribution.md).

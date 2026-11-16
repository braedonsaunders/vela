# Vela

A cinematic, document-skinnable viewing client built with React Native + Expo.
Ether is the reference server; Jellyfin/Emby and Plex adapters share the client boundary.
Vela includes no media or provider credentials.

**Status: integrated development candidate.** Source migration and Expo packaging are complete.
The packaged web app plays against Ether; native Apple and Android builds compile, and
Android TV plays the synthetic fixture. Device and installer qualification still have open
gates in the build plan. Dedicated desktop hosts come later.

- [Contributor instructions](AGENTS.md)
- [Current architecture, ownership and delivery gates](docs/build-plan.md)
- [RN migration and dated evidence](docs/rn-migration.md)
- [Web distribution and release obligations](docs/distribution.md)
- [Product specification](docs/design.md)
- [Protocol architecture](docs/protocol-design.md)

## Contribute

The root is a Bun workspace. `apps/vela` is the Expo app; shared code lives in
`packages/`, and native/web playback in `modules/vela-player`. The source moves and
release exporter have landed. See the build plan before changing shared paths.

From the repository root, compile a coherent chunk once:

```sh
source tools/env.sh
bun x tsc --noEmit -p apps/vela
```

For standalone mock-server changes use `bun x tsc --noEmit -p mock-server`; the web
player uses `bun x tsc --noEmit -p modules/vela-player/web`. Follow explicit coding-only
restrictions when a task forbids checks. No CI, test suites, harnesses or lint machinery.

Exact's app/dispatch was removed in `d47098c`. Contract/profile and former
`tools/dev.ts` instructions are historical, not the RN contributor workflow. The parent
coordinates an actual RN UI/playback look before
announcing those changes. Expo export/native builds are delivery work, not routine checks.
Keep bulky generated output under `~/.scratch/vela-build/<worktree>/`.

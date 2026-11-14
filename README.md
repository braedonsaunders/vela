# Vela

A cinematic, deeply skinnable viewing client for Ether, built with [Exact](https://github.com/expo/exact).

**Status: early client scaffold.**

Vela starts as a desktop/mobile web app and installable PWA. Ether serves its build as an app with its own protocol, Apps card, and configuration. The client lives in this separate repository. Native apps and adapters for other servers follow later.

- [Product specification](docs/design.md)
- [Proposed protocol architecture](docs/protocol-design.md)
- [Protocol research and server coordination](docs/protocol-research.md)

The official experience centers fast search over a cinematic backdrop, with Ether's automatic recommendations beneath it. Vela supplies the presentation and playback experience; Ether supplies identity, discovery, personalization, media, and server-side recovery.

Vela includes no media or provider credentials.

## Develop

From the repository root:

```sh
source tools/env.sh
bun tools/dev.ts
```

Use this single command for all local UI/playback work. It owns the mock on
`http://127.0.0.1:7777` and Exact's web loop on `http://127.0.0.1:8765`, with
`VELA_MOCK=1`, an explicit mock API origin and matching CORS. Sign in with
**demo / vela**. It prints its owner PID, refuses a second instance or occupied
ports, and shuts down both process groups on Ctrl-C or terminal exit.

From another terminal, `bun tools/dev.ts stop` requests shutdown of that owner.
It never adopts or stops an unrelated listener. The owner record lives under
`.tools/vela-dev/` (small metadata stays on the stable repository disk); a stale record is removed only when its PID is gone.
Do not launch separate mock or Exact servers alongside this command.

Generate synthetic media when no viewer is using it:
`bun mock-server/scripts/make-media.ts`. See [mock controls](mock-server/README.md).

The routine compile check remains `bun exact.mjs contract build app.contract
--json --errors-only` from `client/`. For a single visual look, use the running
loop at port 8765. Distribution and PWA packaging are described in
[distribution.md](docs/distribution.md).

Language catalogs live in `client/strings/<locale>.json`. Dev startup and release
packaging generate the TypeScript catalog registry automatically. After adding a
locale during a running loop, run `bun tools/locales.ts` (or restart the dev
command); edits to already imported catalogs use Exact's ordinary reload.

# Jellyfin / compatible Emby adapter

`client/src/adapter/jellyfin` implements `ServerAdapter` over the native
MediaBrowser API. Construct `JellyfinAdapter(serverAddress, credentials)` with a
validated server address (optional reverse-proxy base path) and a **per-server**
credential store. The data worker owns selection/connection UI and factory wiring.
All requests refuse redirects and stay on the configured origin/base path.

Password sign-in registers the supplied device using the MediaBrowser client
header. Quick Connect uses Initiate, Connect and AuthenticateWithQuickConnect;
authorization happens in the server's existing client. Native access tokens have
no refresh grant: `validateSession()` reads Users/Me; the refreshToken field stores
the same revocable credential, and expiresAt represents no scheduled expiration.
Logout revokes the token through Sessions/Logout. Never send it to a Vela refresh
endpoint. Device-code grants and Ether web codes are unavailable.

Resume, NextUp and Latest supply ordinary home rows; heroes and receipt tokens
are absent. User views supply libraries, with native sort/filter parameters.
Titles map watch state, community/critic ratings, images, chapters, cast/crew,
seasons/episodes and verified media facts. Local trailers and special features
are extras. Collections expose a first page (the current adapter boundary has no
collection continuation argument). Search is native catalogue search only.

PlaybackInfo uses actual client capabilities, including the universal player's
original demux/decode capabilities. Prefer static range streams for compatible
originals; otherwise use the server's returned HLS URL. The server chooses the
transcode. Audio/subtitle stream indexes, external WebVTT conversion, resume,
progress, pause/resume, seek, stop, live stream close and encoder cleanup map to
native endpoints. Playback generations/snapshots are adapter-local; they do not
claim server-published ranges or reconnectable events. Sessions/Playing and
Progress/Stopped update the server's own watch state. Native live channels and
programmes map when configured; IsEnabled alone does not prove any tuner exists.

`mediaHeaders()` returns Authorization: MediaBrowser Token=... for private host
fetches. Plans contain no account token. `nativePlaybackURL()` adds api_key only
for the private native-element fallback in memory. These hooks must stay outside
skin-visible models, diagnostics and persistent storage. HLS child requests also
need headers. The host must refuse redirects and scope headers to the selected
origin/base path. `mediaURL()` rejects other origins and strips URL credentials.

Unavailable capabilities: descriptive/AI search, ranking receipts, personalised
heroes/reasons, proactive fallback, live latency policy, seamless path/track
switching, audio fallback, trailer-preview grants, theme-music grants and bedtime.
ThemeSongs is deliberately not exposed as an expiring Vela ThemeMusic grant.

## Qualification (2026-11-14)

Ether 0.3.12-lab.19 at its Jellyfin frontend: password/session validation,
Quick Connect availability, three home rows, libraries/browse/search/details,
cast/extras, channels/guide, HLS negotiation/manifest, progress/snapshot/stop and
logout. The lab playback slot was released after stopping and revoking.

Official `jellyfin/jellyfin:latest` image (reported version 12.4.0, digest
`sha256:fea863d0cd9ec445985d9c75fc6ed64e38a1d2766cf0c250a33d553f4fc1b771`)
in temporary `vela-jellyfin` on bb-worker-server: generated H.264/AAC MP4, HEVC/AAC
MKV and sidecar SRT. Password/identity, Quick Connect pending/authorize/approved,
home/browse/search/detail, direct 206 byte-range (1024 bytes), HEVC-to-H.264/AAC
HLS manifest and MPEG-TS segment (128404 bytes), track discovery, progress,
snapshot, stop and revoke were exercised against the real server.
These are native API/media drives, not a finished Vela UI/decoder qualification.
No native Emby server was exercised.

Differences found: native HLS required the MediaBrowser Authorization header
(X-Emby-Token alone worked on direct files but returned 401 for HLS); native
LiveTv/Info reported IsEnabled true with zero tuners/channels. The adapter handles
both. Native latest rows omit already-played short fixtures per server policy.
The container required .NET configuration file polling on this host because its
inotify instance limit was already exhausted; host limits were left unchanged.

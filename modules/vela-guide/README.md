# Apple guide row drawing

This optional Expo view paints the shared guide's visible programme geometry on Apple TV.
It has no network, navigation, focus-target, cache, debounce or playback logic. The shared
widget supplies a bounded time window and uses the same focus anchor and selection model
as the RN fallback on Android TV. Web keeps its individual keyboard-focusable cells.

Row backgrounds and text textures are rasterized off the UI thread. Recycled views discard
stale drawing completions; selection borders and sliding text layers update on the UI
thread without rebuilding programme views. VoiceOver elements retain each programme's
label and send focus/activation back to the shared widget.

The shared RN TV focus-guide anchor handles directional input and activation on both Apple
and Android TV.

For device measurements, opt in with `EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS=1` and optionally
`EXPO_PUBLIC_VELA_GUIDE_REPORT_URL`. Normal Release builds leave these unset. The display-link
probe reports UI intervals and missed display opportunities, separately from JS RAF timing;
it does not measure GPU/compositor presentation.

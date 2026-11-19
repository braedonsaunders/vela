# Apple TV guide

The optional `GuideSurface` hosts a two-axis UICollectionView on tvOS. UIKit owns
focus, touch-surface momentum, directional holds, scrolling and cell reuse. A
custom layout queries intersecting channel rows; hourly gap focus targets are
computed on demand rather than allocated for every channel and hour. Cells reuse
the existing asynchronous row renderer. Channel rail and time ruler positions
follow native scrolling without a JS callback on each display frame.

The shared widget owns programme geometry, selection, actions, cache, prefetch and
playback. Native focus reports channel/time back to that widget. Visible windows
are reported in four-row/half-hour buckets with shared lookahead. Drawings are
limited to the visible channel/time window plus a margin. Android and web retain
the shared RN grid and its existing navigation.

Recycled rail views clear their image immediately, cancel the old request, and
accept a completion only when its channel/URL identity still matches. That key
comes from the same pure helper as Expo Image's RN recycling key. Asynchronous
programme drawings independently reject stale generations.

For device measurements, opt in with `EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS=1` and
optionally `EXPO_PUBLIC_VELA_GUIDE_REPORT_URL`. Normal Release builds leave these
unset. The existing display-link probe reports UI intervals and missed display
opportunities separately from JS RAF timing; it does not measure GPU/compositor
presentation. Native scrolling, focus restoration, time/day controls, logo reuse,
and preview retuning must be inspected on the physical Apple TV before claiming
runtime verification.

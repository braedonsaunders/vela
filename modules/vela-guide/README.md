# Apple TV guide

The optional `GuideSurface` hosts a two-axis UICollectionView on tvOS. UIKit owns
focus, touch momentum, directional holds, scrolling and cell reuse. Focus targets
use a stable minute coordinate: vertical targets align across channel rows and
horizontal targets follow programme boundaries. Programme widths do not make an
edge click skip channels. Only eligible targets in the requested rectangle have
views; minute coordinates are virtual indices, not a view for every minute.

The existing asynchronous row renderer paints once per visible channel. Its
layers are composed behind the focus cells without placing passive Expo views
in UIKit's focus hierarchy (those views otherwise obscure focus candidates).
The native rail and ruler follow scrolling without per-frame JS callbacks.
Recycled rail views clear images, cancel old requests and check channel/URL
identity before accepting a completion. That identity also keys RN Expo Image.

Shared TypeScript owns programme facts, selection, cache, prefetch and playback.
Native focus and four-row/half-hour viewport buckets report back to it. Detail
updates settle after 250 ms; activation always uses the current native target.
Stable lineup metadata crosses the bridge once, independently of programme
updates. Visible row drawings and geometry use an opaque JSON prop decoded off
main, with generations rejecting stale decodes. Presentation updates coalesce
until a gesture settles. Native geometry retention is bounded to 256 channels.
Android and web retain the shared RN guide.

The react-native-tvos hosting root retains an explicit preferred focus target.
Crossing into UIKit uses that root's public preferred-focus contract after view
attachment; initial props may precede attachment. Native focus restoration keeps
the selected time coordinate when listings arrive or the timeline origin moves.

Device diagnostics opt in with `EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS=1`. Normal
Release builds leave this unset. The existing native display-link probe reports
UI callback intervals and missed opportunities, not GPU presentation timings.
Optional focus, motion, layout-query and drawing-update logs contain coordinates
and counts only. Apple player logs separately record display-criteria policy,
criteria changes, system mode-switch events and retained/first preview frames.

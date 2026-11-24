# @vela/fold

A foldable's posture for the app's layout, platform-neutral (`src/model.ts`):

- `flat`: one surface. Folded shut, fully open, or a device that does not fold.
- `book`: partly open with the fold upright, held like a book.
- `tabletop`: partly open with the fold across, the lower half resting like a laptop's keyboard.

While partly open, `division` is where the window divides, in window points from its top left (like
safe-area insets): the fold plus the margins interactive content keeps clear of.

On an iPhone Duo (iOS 27.1) `ios/VelaFoldModule.swift` reads `UIView.reservedRegions(kind: .division)`.
iOS reports the division region only while the hinge is partly open, so a fully open Duo is `flat`
and its layout is chosen by width like any tablet's. It re-reads on every layout pass of an invisible
window-sized view and on `UIHingeInteraction` updates. The podspec is iPhone-only, so autolinking
skips it on tvOS. There is no Android or web implementation yet; both read `flat`. Jetpack
WindowManager's `FoldingFeature` (state `HALF_OPENED`, its bounds and orientation) maps onto the
same shape.

The app puts the state on the skin host's `Viewport.fold` (apps/vela/src/vela.tsx), leaving it out
when flat. The watch route uses it to give a tabletop's upper half to the picture and its lower half
to the controls (packages/skin/src/widgets/player/fold-layout.ts).

// @vela/player: VelaPlayerView and VelaPlayer behind the player view contract (packages/player-api).
// VelaPlayerView.tsx is the native implementation (Aether on Apple, Media3 on Android);
// VelaPlayerView.web.tsx is the web one. Both export the same shape.
export { VelaPlayer, VelaPlayerView, claimPlayPause, sampleUIFrames } from './VelaPlayerView';
export type { MediaAccess, VelaPlayerViewProps } from './VelaPlayerView';

// @vela/player: VelaPlayerView and VelaPlayer behind the player view contract (packages/player-api).
// VelaPlayerView.tsx is the native implementation (libmpv on Apple; Android later);
// VelaPlayerView.web.tsx is the web one. Both export the same shape.
export { VelaPlayer, VelaPlayerView } from './VelaPlayerView';
export type { MediaAccess, VelaPlayerViewProps } from './VelaPlayerView';

// Live overlays (Sports): the score bug (also drawn per multiview tile), the scores ticker, and
// favourite-team alert toasts, all drawn by Vela over the picture and the app.
export { ScoreBug, useFollowedEvent, type ScoreBugProps, type ScoreBugSize } from './score-bug';
export { LiveTicker, tickerHeight } from './ticker';
export { AppAlertToasts, PlayerAlertToasts, useAlertFollow } from './alerts';
export { LiveOverlayContext, takeAlertKey, useTickerPreference, type LiveOverlayActions } from './context';
export { PlayerLiveOverlays, usePlayerLiveOverlay, type PlayerLiveOverlay } from './player';
export { alertWatch, bugModel, scoreChange, tickerItems, toastQueue, type BugModel, type BugSide, type TickerItem } from './model';

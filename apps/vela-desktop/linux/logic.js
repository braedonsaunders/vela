'use strict';
function acceptPlan(previous, next) {
  return !!next && (previous?.sessionId !== next.sessionId ||
    (next.sourceGeneration >= previous.sourceGeneration && next.seekGeneration >= previous.seekGeneration));
}
function physicalBounds(content, rect, scale) {
  return { x: Math.round((content.x + rect.x) * scale), y: Math.round((content.y + rect.y) * scale),
    width: Math.max(0, Math.round(rect.width * scale)), height: Math.max(0, Math.round(rect.height * scale)) };
}
function playbackRate(plan, requested) {
  return plan?.channelId || plan?.live || plan?.livePolicy ? 1 : Math.max(.25,Math.min(4,Number.isFinite(requested) ? requested : 1));
}
module.exports = { acceptPlan, physicalBounds, playbackRate };

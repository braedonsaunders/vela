export const PHONE_PLAY_WIDTH = 48;
export const PLAYER_BUTTON_WIDTH = 44;
export const PHONE_CONTROL_GAP = 4;
const PHONE_GUTTER = 16;
const BASE_CONTROLS = 4; // Play, mute, captions, more.
const STEP_CONTROLS = 2;
const PHONE_BREAKPOINT = 720;

function rowWidth(controls: number): number {
  return PHONE_PLAY_WIDTH + (controls - 1) * (PLAYER_BUTTON_WIDTH + PHONE_CONTROL_GAP);
}

/** A portrait iPhone's horizontal status strip inset can persist after hiding the status bar
 * on the Duo cover display. Watch fills that display and keeps its vertical system insets. */
export function watchSideInsets(width: number, height: number, portraitIPhone: boolean, left: number, right: number) {
  return portraitIPhone && height > width ? { left: 0, right: 0 } : { left, right };
}

export function phoneControlLayout(width: number, height: number, handheld: boolean, tv: boolean, windowWidth = width, windowHeight = height) {
  const compact = !tv && (width < PHONE_BREAKPOINT || (handheld && Math.min(windowWidth, windowHeight) < PHONE_BREAKPOINT));
  const gutter = compact ? PHONE_GUTTER : 40;
  const available = width - gutter * 2;
  const showSteps = available >= rowWidth(BASE_CONTROLS + STEP_CONTROLS);
  return {
    compact,
    gutter,
    showSteps,
    rowWidth: rowWidth(showSteps ? BASE_CONTROLS + STEP_CONTROLS : BASE_CONTROLS),
    short: compact && height < 420,
  };
}

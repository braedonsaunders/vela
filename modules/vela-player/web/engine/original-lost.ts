export const ORIGINAL_LOST_MESSAGE = 'Original source was lost';

export function originalLostResponse(response: Pick<Response, 'status' | 'headers'>): boolean {
  return response.status === 409 && response.headers.get('X-Ether-Playback-Error') === 'original_lost';
}

/** A finite VOD ending materially before the duration described by its plan is a truncated file,
 * not a completed watch. The two-second allowance covers container duration rounding. */
export function originalEndedEarly(position: number, duration: number | null | undefined): boolean {
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 2 &&
    Number.isFinite(position) && position < duration - 2;
}

export function originalLostError(detail: 'refused' | 'truncated'): TypeError {
  return new TypeError(`${ORIGINAL_LOST_MESSAGE}: ${detail}`);
}

export function isOriginalLostError(reason: unknown): boolean {
  return typeof reason === 'string' ? reason.startsWith(ORIGINAL_LOST_MESSAGE)
    : reason instanceof Error && reason.message.startsWith(ORIGINAL_LOST_MESSAGE);
}

/** A single local decoder fallback per pinned source/seek, before broker HLS. */
export interface DecoderRetry { audio: boolean; video: boolean }
export function decoderRetry(reason: string): DecoderRetry | null {
  // Never repeat range/policy/source/network failures against the same original.
  if (!reason.startsWith('Original decode: decode-failed') && !reason.startsWith('Original first-frame deadline')) return null;
  // The worker reports one decode failure kind for both codec pipelines. Prepare
  // software audio and the video package when one exists; native H.264/VP9 stay
  // native because this reviewed package set has no alternative video decoder.
  return {audio:true,video:true};
}

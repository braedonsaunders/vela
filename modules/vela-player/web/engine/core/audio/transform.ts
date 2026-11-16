/** Core-only adaptation of the pinned component protocol. Forty-millisecond
 * output chunks need more than eight credits to prefill a cold-start reserve.
 * The worker derives its maximum chunk size as 96,000 frames / credits, so 48
 * credits retain the SAME two-second frame/channel-buffer bound (2,000 frames
 * each), above its 1,920-frame minimum. Host and workers must be built together. */
export function transformCoreAudio(path:string,source:string):string|null{
  if(!path.replaceAll('\\','/').endsWith('/src/pipeline/DecodeWorkerProtocol.ts'))return null;
  const anchor='export const MAX_DECODED_AUDIO_SAMPLE_CREDITS = 8;';
  if(source.split(anchor).length!==2)throw new Error('Pinned core audio credit window changed');
  return source.replace(anchor,'export const MAX_DECODED_AUDIO_SAMPLE_CREDITS = 48;');
}

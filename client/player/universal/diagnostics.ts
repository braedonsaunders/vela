/** Bounded scalar metadata diagnostics, never URLs, private bytes or credentials. */
export function metadataDifference(notes: string[], field: string, declared: unknown, actual: unknown) {
  if (declared === undefined || declared === null || actual === undefined || actual === null || declared === actual) return;
  const scalar = (value: unknown) => String(value).replace(/[^\w .:+-]/g,'?').slice(0,48);
  const note = `${field}: broker=${scalar(declared)} container=${scalar(actual)}`;
  if (notes.length < 32 && !notes.includes(note)) notes.push(note);
}
export function audioDifferences(notes: string[], declared: import('./source').OriginalAudio | undefined, actual: import('./source').OriginalAudio) {
  if (!declared) return;
  for (const key of ['codec','channels','sampleRate','channelMask','language','streamIndex'] as const)
    metadataDifference(notes,`audio.${key}`,declared[key],actual[key]);
}

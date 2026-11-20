/** Empty means server resume policy; zero is an explicit restart. */
export function startPosition(value: string | undefined): number | undefined {
  if (value === undefined || !value.trim()) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function playParams(arg: string) {
  const [id = '', mediaSourceId, audioTrackId, start, versionId] = arg.split('|');
  const positionSeconds = startPosition(start);
  return { id, ...(mediaSourceId ? { mediaSourceId } : {}), ...(audioTrackId ? { audioTrackId } : {}),
    ...(positionSeconds !== undefined ? { positionSeconds: String(positionSeconds) } : {}), ...(versionId ? { versionId } : {}) };
}

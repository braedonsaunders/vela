/** Unambiguous image identity: recycled views must clear even when a name or URL changes. */
export function logoIdentity(channel: string, uri: string): string {
  return JSON.stringify([channel, uri]);
}

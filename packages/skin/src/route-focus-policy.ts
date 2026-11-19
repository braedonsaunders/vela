/** Native touch screens must not move TV focus back over a newly focused input. */
export function restoreRouteFocus(platform: string, tv: boolean): boolean {
  return tv || platform === 'web';
}

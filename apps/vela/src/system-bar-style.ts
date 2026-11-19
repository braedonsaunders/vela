/** Choose the stronger black/white contrast against an Android ARGB page colour. */
export function systemBarStyle(colour: number | undefined): 'dark' | 'light' {
  if (colour === undefined) return 'light';
  const channels = [16, 8, 0].map(shift => ((colour >>> shift) & 255) / 255);
  const luminance = channels.reduce((sum, channel, i) => sum +
    (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!, 0);
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? 'dark' : 'light';
}

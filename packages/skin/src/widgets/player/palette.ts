// Video has no page palette. Every bar uses a dark scrim whose translucent plateau
// covers its controls; check inks against both black and white behind that scrim.
const surface = {
  page: '#101318', raised: '#20262e', inkInverse: '#101318',
  onAccent: '#101318', control: '#ffffff24', controlHover: '#ffffff38',
  glass: '#101318f5', glassEdge: '#ffffff45', glassEdgeStrong: '#ffffff75',
  popover: '#101318fa', scrim: '#000000bf', track: '#ffffff70', trackStrong: '#ffffffa0',
  focusHalo: '#ffffff66', shadow: '#000000cc',
};
function rgba(value: string): number[] | undefined {
  const hex = /^#([a-f\d]{6})([a-f\d]{2})?$/i.exec(value);
  if (!hex) {
    const fn = /^rgba?\(([^)]+)\)$/.exec(value);
    const parts = fn?.[1]?.split(',').map(Number);
    return parts && (parts.length === 3 || parts.length === 4) && parts.every(Number.isFinite)
      && parts.slice(0, 3).every(c => c >= 0 && c <= 255) && (parts[3] === undefined || (parts[3] >= 0 && parts[3] <= 1))
      ? parts.slice(0, 3).map(c => c / 255).concat(parts[3] ?? 1) : undefined;
  }
  return [0, 2, 4].map(i => parseInt(hex[1]!.slice(i, i + 2), 16) / 255).concat(hex[2] ? parseInt(hex[2], 16) / 255 : 1);
}
function luminance(rgb: number[]): number {
  return rgb.slice(0, 3).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
}
/** WCAG contrast after compositing an ink (including its alpha) onto a surface. */
export function playerContrast(ink: string, background: string): number {
  const fg = rgba(ink), bg = rgba(background);
  if (!fg || !bg) return 0;
  const a = luminance(fg.map((c, i) => c * fg[3]! + bg[i]! * (1 - fg[3]!)));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function playerPalette(input: Record<string, string>) {
  const result: Record<string, string> = { ...surface };
  for (const key of ['ink', 'inkSecondary', 'inkQuiet', 'inkHover', 'accent']) {
    const value = input[key] ?? '';
    // #404040 is white video through the translucent black scrim. Raised menus
    // and filled controls also need readable ink; unknown formats fail closed.
    result[key] = ['#000000', '#404040', surface.raised].every(bg => playerContrast(value, bg) >= 4.5)
      && playerContrast(value, surface.inkInverse) >= 4.5 ? value : '#ffffff';
  }
  return result;
}

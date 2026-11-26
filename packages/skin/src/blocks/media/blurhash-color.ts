type RGB = readonly [number, number, number];

const BASE83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const linear = (byte: number) => {
  const color = byte / 255;
  return color <= 0.04045 ? color / 12.92 : ((color + 0.055) / 1.055) ** 2.4;
};
const srgb = (linear: number) => {
  const color = clamp(linear, 0, 1);
  return Math.round(255 * (color <= 0.0031308 ? 12.92 * color : 1.055 * color ** (1 / 2.4) - 0.055));
};
const signedPower = (value: number, exponent: number) => Math.sign(value) * Math.abs(value) ** exponent;

function decode83(value: string): number {
  let decoded = 0;
  for (const char of value) decoded = 83 * decoded + BASE83.indexOf(char);
  return decoded;
}

function encode83(value: number, length: number): string {
  return Array.from({ length }, (_, index) => BASE83[Math.floor(value / 83 ** (length - index - 1)) % 83]).join('');
}

/** Increase chroma around linear-light luminance, leaving neutral colors and brightness alone. */
export function saturateLinearColor([red, green, blue]: RGB, saturation: number): RGB {
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return [
    luminance + (red - luminance) * saturation,
    luminance + (green - luminance) * saturation,
    luminance + (blue - luminance) * saturation,
  ];
}

/** Recolor the BlurHash coefficients without adding any spatial detail to the backdrop. */
export function saturateBlurhash(hash: string, saturation: number): string {
  if (!Number.isFinite(saturation) || saturation === 1 || saturation < 0 || [...hash].some(char => !BASE83.includes(char))) return hash;
  const size = BASE83.indexOf(hash[0] ?? '');
  const count = (size % 9 + 1) * (Math.floor(size / 9) + 1);
  if (size < 0 || size > 80 || hash.length !== 4 + 2 * count) return hash;
  const dc = decode83(hash.slice(2, 6));
  const average = saturateLinearColor([linear(dc >> 16), linear((dc >> 8) & 255), linear(dc & 255)], saturation);
  const packedAverage = 65536 * srgb(average[0]) + 256 * srgb(average[1]) + srgb(average[2]);
  const oldRange = (decode83(hash[1]!) + 1) / 166;
  const expand = (sample: number) => signedPower((sample - 9) / 9, 2) * oldRange;
  const colors = Array.from({ length: count - 1 }, (_, index) => {
    const offset = 6 + index * 2;
    const packed = decode83(hash.slice(offset, offset + 2));
    return saturateLinearColor([expand(Math.floor(packed / 361)), expand(Math.floor(packed / 19) % 19), expand(packed % 19)], saturation);
  });
  const peak = Math.max(0, ...colors.flat().map(Math.abs));
  const maximum = clamp(Math.floor(166 * peak - 0.5), 0, 82);
  const range = (maximum + 1) / 166;
  const quantize = (value: number) => clamp(Math.round(signedPower(value / range, 0.5) * 9 + 9), 0, 18);
  const details = colors.map(([r, g, b]) => encode83(361 * quantize(r) + 19 * quantize(g) + quantize(b), 2));
  return hash[0] + encode83(maximum, 1) + encode83(packedAverage, 4) + details.join('');
}

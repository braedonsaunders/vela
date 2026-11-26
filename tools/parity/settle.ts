import { decodePng, type Image } from './png';

/** A sleeping display is a stable solid frame. Look for visible contrast before settling it. */
export function captureHasContent({ width, height, data }: Image): boolean {
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 200));
  let darkest = 255, lightest = 0;
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
    const i = (y * width + x) * 4;
    const luminance = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    darkest = Math.min(darkest, luminance);
    lightest = Math.max(lightest, luminance);
    if (lightest - darkest >= 30) return true;
  }
  return false;
}

/** The frozen Read fixtures use light paper. The opening title alone puts very little ink in the
 * page interior. Leave out the toolbars and the device edges when checking for rendered content. */
export function readerHasContent({ width, height, data }: Image): boolean {
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 200));
  let ink = 0, samples = 0;
  for (let y = Math.ceil(height * 0.14); y < height * 0.85; y += stride) {
    for (let x = Math.ceil(width * 0.04); x < width * 0.9; x += stride) {
      const i = (y * width + x) * 4;
      const channels = [data[i]!, data[i + 1]!, data[i + 2]!];
      const high = Math.max(...channels);
      if (high < 210 || high - Math.min(...channels) > 35) ink++;
      samples++;
    }
  }
  return samples > 0 && ink / samples >= 0.015;
}

/** Two identical candidate frames precede the primary capture. If the primary changes again,
 * keep waiting. Compare decoded pixels when native PNG metadata differs. */
export async function settledFrames(
  shoot: () => Uint8Array,
  wait: () => Promise<void>,
  { reader = false, attempts = 30 } = {},
): Promise<{ primary: Uint8Array; confirmed: Uint8Array }> {
  let previous: Uint8Array | undefined;
  let previousImage: Image | undefined;
  let matches = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = shoot();
    const image = decodePng(current);
    if (!captureHasContent(image) || (reader && !readerHasContent(image))) {
      previous = previousImage = undefined;
      matches = 0;
    } else {
      const same = previousImage && previousImage.width === image.width && previousImage.height === image.height
        && Buffer.from(previousImage.data).equals(image.data);
      matches = same ? matches + 1 : 0;
      if (matches >= 2) return { primary: current, confirmed: previous! };
      previous = current;
      previousImage = image;
    }
    await wait();
  }
  throw new Error(reader ? 'reader content did not settle' : 'the capture did not settle');
}

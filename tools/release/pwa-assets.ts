import { copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
export async function writePwaAssets(dist: string, brand = resolve(import.meta.dir, '../../brand')) {
  await copyFile(join(brand, 'svg/vela-icon.svg'), join(dist, 'vela-icon.svg'));
  await copyFile(join(brand, 'png/apple-touch-icon-180.png'), join(dist, 'vela-icon-180.png'));
  for (const size of [16,32,48]) await copyFile(join(brand, `png/favicon-${size}.png`), join(dist, `favicon-${size}.png`));
  for (const size of [192,512]) {
    await copyFile(join(brand, `png/vela-icon-${size}.png`), join(dist, `vela-icon-${size}.png`));
    await copyFile(join(brand, `png/vela-icon-maskable-${size}.png`), join(dist, `vela-icon-maskable-${size}.png`));
  }
}
export const pwaIcons = [192,512].flatMap(size => ['any','maskable'].map(purpose => ({src:`/vela/vela-icon-${purpose === 'maskable' ? 'maskable-' : ''}${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose})));

/** Source-complete, offline installation. Source input is prepared from the pinned URLs in assets.json. */
import {readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import manifest from './assets.json';
export async function installSubtitleAssets(destination:string,from:string){
  destination=resolve(destination);from=resolve(from);
  for(const [name,fact] of Object.entries(manifest.files)){
    const bytes=await readFile(join(from,name));
    if(bytes.length!==fact.bytes||createHash('sha256').update(bytes).digest('hex')!==fact.sha256)throw new Error(`Subtitle distribution integrity mismatch: ${name}`);
  }
  await mkdir(destination,{recursive:true});
  for(const name of Object.keys(manifest.files))await copyFile(join(from,name),join(destination,name));
  await writeFile(join(destination,'assets.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(join(destination,'SOURCE-OFFER.txt'),`Vela subtitle assets ${manifest.assetKey}\nJASSUB 1.8.8 wrapper: MIT. libass: ISC; FriBidi: LGPL-2.1-or-later; FreeType: FTL (elected); HarfBuzz: MIT/NTP; Brotli: MIT. Full dependency notices are in JASSUB-COPYRIGHT.txt. Fallback Noto Sans: SIL OFL1.1, see NotoSans-OFL.txt.\nThe independently loaded WASM can be replaced/rebuilt from the included exact JASSUB and dependency source archives and build scripts. JS release source matches tag ca27d60a672612b2b8a80d0728092c2164e32a07. Source pins and hashes are in assets.json. The unused Fontconfig and Expat targets are disabled in that build's Makefile. No caption or font supplied by a media source is included in this distribution.\n`);
}
if(import.meta.main){
  const [destination,...args]=process.argv.slice(2);const from=args.find(arg=>arg.startsWith('--from='))?.slice(7);
  if(!destination||!from)throw new Error('Usage: bun subtitles/install.ts <destination> --from=<source-complete prepared directory>');
  await installSubtitleAssets(destination,from);console.log(`Installed subtitle assets ${manifest.assetKey}`);
}

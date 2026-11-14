/** One local release containing supported static Exact engine builds. Never publishes. */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { stageUniversalAssets } from './universal-assets';
import { ENGINES } from '../engine';
import { finalizeEngineRoot } from './engine-root';
import { writePwaAssets, pwaIcons } from './pwa-assets';
const root = resolve(import.meta.dir, '../..'), output = join(root, '.artifacts/release');
const assetArgument = process.argv.find(arg => arg.startsWith('--universal-assets='));
if (!assetArgument || assetArgument === '--universal-assets=' || process.argv.includes('--universal-assets')) throw new Error('Production releases require --universal-assets=<verified player payload directory>');
const version = (await readFile(join(import.meta.dir, 'VERSION'), 'utf8')).trim();
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
async function run(cmd: string[], cwd = root) { const child = Bun.spawn(cmd, { cwd, env: { ...process.env, COPYFILE_DISABLE: '1' }, stdout: 'inherit', stderr: 'inherit' }); if (await child.exited) throw new Error(`${cmd[0]} failed`); }
const revision = (await new Response(Bun.spawn(['git','rev-parse','HEAD'], {cwd:root, stdout:'pipe'}).stdout).text()).trim();
await mkdir(output, {recursive:true});
const archiveName = `vela-${version}.tar.gz`, manifestName = `vela-${version}.manifest.json`;
for (const name of [archiveName,manifestName]) if (await Bun.file(join(output,name)).exists()) throw new Error(`${name} exists; release versions are immutable`);
const work = await mkdtemp(join(output,'.multi-'));
try {
  const dist = join(work,'dist'); await mkdir(dist);
  const universalAssets = await stageUniversalAssets(assetArgument.slice('--universal-assets='.length), dist);
  const engines: Record<string,{base:string;appBytes:number;appGzipBytes:number}> = {};
  for (const engine of ENGINES) {
    const stem = `vela-${version}-${engine}`, childManifest = join(output,`${stem}.manifest.json`);
    if (!await Bun.file(childManifest).exists()) await run([process.execPath,join(import.meta.dir,'engine-build.ts'),'--committed','--engine',engine,...process.argv.includes('--map-report')?['--map-report']:[]]);
    const metadata = await Bun.file(childManifest).json();
    if (metadata.sourceDirty || metadata.sourceRevision !== revision) throw new Error(`Stale/dirty engine ${engine}`);
    const target = join(dist,'engines',engine,version); await mkdir(target,{recursive:true});
    await run(['tar','-xf',join(output,`${stem}.tar.gz`),'-C',target]);
    const base = await finalizeEngineRoot(target,engine,version);
    // A single root worker owns the entire install. Engines never register independent workers.
    for (const name of ['sw.js','pwa.js','offline.html']) await rm(join(target,name),{force:true});
    const entry = await readFile(join(target,'app.js'));
    engines[engine] = {base,appBytes:entry.length,appGzipBytes:gzipSync(entry,{level:9}).length};
  }
  await writePwaAssets(dist);
  await copyFile(join(import.meta.dir,'pwa.js'),join(dist,'pwa.js'));
  const loader = await readFile(join(import.meta.dir,'loader.js'));
  const loaderName = `loader-${hash(loader).slice(0,20)}.js`; await writeFile(join(dist,loaderName),loader);
  const pwaHash = hash(await readFile(join(dist,'pwa.js'))), pwaUrl = `/vela/pwa.js?v=${pwaHash}`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#090B0E"><link rel="manifest" href="/vela/manifest.json"><link rel="icon" href="/vela/vela-icon.svg"><link rel="apple-touch-icon" href="/vela/vela-icon-180.png"><title>Vela</title><style>body{margin:0;background:#090B0E;color:#f2e9d6;font:16px system-ui;min-height:100vh;display:grid;place-items:center}</style><p role="status">Opening Vela…</p><script type="module" src="/vela/${loaderName}"></script></html>`;
  await writeFile(join(dist,'index.html'),html);
  await writeFile(join(dist,'offline.html'),'<!doctype html><meta charset="utf-8"><title>Vela · Offline</title><style>body{background:#090B0E;color:#f2e9d6;font:18px system-ui;padding:3rem}</style><h1>You’re offline</h1><p>Reconnect to browse and play.</p><a href="/vela">Try again</a>');
  await writeFile(join(dist,'engines.json'),JSON.stringify({version,engines,universalAssets:{baseURL:universalAssets.baseURL,assetKey:universalAssets.assetKey}})+'\n');
  await writeFile(join(dist,'app.version.json'),JSON.stringify({version})+'\n');
  await writeFile(join(dist,'manifest.json'),JSON.stringify({id:'/vela',name:'Vela',short_name:'Vela',start_url:'/vela',scope:'/vela',display:'standalone',theme_color:'#090B0E',background_color:'#090B0E',icons:pwaIcons})+'\n');
  const files: {path:string;bytes:number;sha256:string}[]=[];
  async function inventory(dir:string) {for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {const path=join(dir,e.name);if(e.isDirectory())await inventory(path);else {const b=await readFile(path);files.push({path:relative(dist,path).split('\\').join('/'),bytes:b.length,sha256:hash(b)});}}}
  await inventory(dist);
  const rootFiles=[{url:`/vela/${loaderName}`,sha256:hash(loader)},{url:pwaUrl,sha256:pwaHash},...files.filter(f=>f.path==='offline.html').map(f=>({url:`/vela/${f.path}`,sha256:f.sha256}))];
  const engineFiles=files.filter(f=>f.path.startsWith('engines/') || f.path.startsWith('universal/')).flatMap(f=>[{url:`/vela/${f.path}`,sha256:f.sha256}, ...(f.path.startsWith('universal/') ? [{url:`/vela/${f.path}?v=${universalAssets.assetKey}`,sha256:f.sha256}] : [])]);
  const shell={version,digest:hash(JSON.stringify(files)).slice(0,16),offlineUrl:'/vela/offline.html',files:rootFiles,engineFiles};
  const sw=(await readFile(join(import.meta.dir,'sw.js'),'utf8')).replace('const shell = __VELA_SHELL__;',`const shell = ${JSON.stringify(shell)};`);
  await writeFile(join(dist,'sw.js'),sw);const swBytes=await readFile(join(dist,'sw.js'));files.push({path:'sw.js',bytes:swBytes.length,sha256:hash(swBytes)});
  await run(['tar','--format=ustar','-czf',join(output,archiveName),'-C',dist,'.']);
  const archive=await readFile(join(output,archiveName));
  const manifest={schemaVersion:1,version,protocolVersions:[0],exactRevision:(await readFile(join(root,'EXACT_REVISION'),'utf8')).trim(),buildTime:new Date().toISOString(),sourceRevision:revision,sourceDirty:false,apiOrigin:'same-origin',basePath:'/vela/',serviceWorker:{path:'/vela/sw.js',scope:'/vela',headers:{'Service-Worker-Allowed':'/vela','Cache-Control':'no-cache'}},engines,universalAssets,archive:{file:archiveName,bytes:archive.length,sha256:hash(archive)},files};
  const json=JSON.stringify(manifest,null,2)+'\n';await writeFile(join(output,manifestName),json);
  await writeFile(join(output,`${archiveName}.sha256`),`${hash(archive)}  ${archiveName}\n`);await writeFile(join(output,`${manifestName}.sha256`),`${hash(json)}  ${manifestName}\n`);
  console.log(JSON.stringify({archive:join(output,archiveName),sha256:hash(archive),manifest:join(output,manifestName),manifestSha256:hash(json),engines},null,2));
} finally {await rm(work,{recursive:true,force:true});}

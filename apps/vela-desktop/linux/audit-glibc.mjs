import {openSync,readSync,closeSync,readdirSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import abi from './abi.js';
export function auditFiles(inputs, ceiling='2.35') {
  const results=[];
  const visit=file=>{
    if(statSync(file).isDirectory()) {for(const name of readdirSync(file))visit(join(file,name));return;}
    const fd=openSync(file,'r');const magic=Buffer.alloc(4);
    try {if(readSync(fd,magic,0,4,0)!==4 || !magic.equals(Buffer.from([0x7f,0x45,0x4c,0x46])))return;}
    finally {closeSync(fd);}
    const symbols=spawnSync('objdump',['-T',file],{encoding:'utf8',maxBuffer:8*1024*1024});
    if(symbols.status!==0)throw new Error(`objdump failed for ${file}`);
    let version;
    try {version=abi.glibcRequirement(symbols.stdout,ceiling);} catch(error) {throw new Error(`${file}: ${error.message}`);}
    results.push({file,version});
  };
  for(const input of inputs)visit(resolve(input));
  if(!results.length)throw new Error('No ELF files found to audit');
  const maximum=results.map(r=>r.version).filter(Boolean).sort(abi.compareVersions).at(-1) || null;
  return {ceiling,maximum,files:results};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const inputs=process.argv.slice(2).filter(a=>a!=='--json');
  if(!inputs.length)throw new Error('Usage: node linux/audit-glibc.mjs [--json] <ELF file or directory>...');
  const report=auditFiles(inputs);
  console.log(process.argv.includes('--json')?JSON.stringify(report,null,2):`Audited ${report.files.length} ELF files; maximum GLIBC_${report.maximum}; ceiling GLIBC_${report.ceiling}`);
}

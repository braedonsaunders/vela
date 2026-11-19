'use strict';
function compareVersions(a, b) {
  const left=a.split('.').map(Number), right=b.split('.').map(Number);
  for(let i=0;i<Math.max(left.length,right.length);i++) {
    const difference=(left[i] || 0)-(right[i] || 0);
    if(difference) return Math.sign(difference);
  }
  return 0;
}
function glibcRequirement(symbols, ceiling='2.35') {
  if (/\bGLIBC_(?:PRIVATE|ABI_\w+)\b/.test(symbols)) throw new Error('Unsupported private or additional GLIBC ABI requirement');
  const versions=[...symbols.matchAll(/\bGLIBC_(\d+(?:\.\d+)+)\b/g)].map(match=>match[1]);
  const maximum=versions.sort(compareVersions).at(-1) || null;
  if(maximum && compareVersions(maximum,ceiling)>0) throw new Error(`Requires GLIBC_${maximum}; baseline is GLIBC_${ceiling}`);
  return maximum;
}
module.exports={compareVersions,glibcRequirement};

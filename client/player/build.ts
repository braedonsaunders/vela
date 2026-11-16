// Exact copies this complete artifact directory; it does not transpile it.
const result = await Bun.build({
  entrypoints: [import.meta.dir + '/web-module.ts'],
  outdir: import.meta.dir + '/../modules/web',
  naming: 'index.js',
  target: 'browser',
  format: 'esm',
  minify: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
export {};

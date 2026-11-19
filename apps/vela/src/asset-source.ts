/** Resolve bundled assets before considering the selected media server. */
export function resolveAssetSource(
  path: string,
  serverOrigin: string,
  assets: Record<string, string | number>,
): string | number | undefined {
  if (!path) return undefined;
  if (assets[path] !== undefined) return assets[path];
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/')) return `${serverOrigin}${path}`;
  return undefined;
}

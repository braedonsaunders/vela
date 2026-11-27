/** Resolve bundled assets before considering the selected media server. Anything else loads only
 * from that server's own origin: a skin or a catalogue value never sends a request elsewhere. */
export function resolveAssetSource(
  path: string,
  serverOrigin: string,
  assets: Record<string, string | number>,
): string | number | undefined {
  if (!path) return undefined;
  if (assets[path] !== undefined) return assets[path];
  if (!serverOrigin) return undefined;
  if (path.startsWith('/') && !path.startsWith('//')) return `${serverOrigin}${path}`;
  if (path.startsWith(`${serverOrigin}/`)) return path;
  if (/^https?:\/\//i.test(path)) {
    try {
      // The same origin written differently (letter case, a default port).
      const url = new URL(path);
      if (url.origin === new URL(serverOrigin).origin && !url.username && !url.password) return url.href;
    } catch { /* Not a URL. */ }
  }
  return undefined;
}

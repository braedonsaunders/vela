/** Parse a captured fragment without retaining it in location, history or storage. */
export function parseWebHandoff(fragment: string, origin: string): { code?: string; consoleUrl?: string } {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  return {
    code: params.has('code') ? params.get('code')! : undefined,
    consoleUrl: consoleURL(params.get('console'), origin),
  };
}

/** Ether's console can use another port on the same machine. Never accept another host,
 * credentials embedded in a URL, or a non-HTTP scheme. */
export function consoleURL(value: string | null | undefined, origin: string): string | undefined {
  if (!value) return undefined;
  try {
    const target = new URL(value), page = new URL(origin);
    if (!['http:', 'https:'].includes(target.protocol) || target.hostname !== page.hostname || target.username || target.password) return undefined;
    return target.href;
  } catch { return undefined; }
}

/** The Ether server a page's own origin implies: only a page served over http(s) came from one.
 * A desktop shell serves the bundle from its own scheme (vela-app://app); if the page ever runs
 * there without the shell's declaration, it is standalone, never a server at that origin. */
export function pageServerOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch { return undefined; }
}

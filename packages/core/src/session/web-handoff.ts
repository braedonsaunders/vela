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

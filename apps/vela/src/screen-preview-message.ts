// Ether Studio's and `tools/skin.ts serve`'s reload message (screen-preview.tsx):
// `{type: 'vela:screen-preview:reload', screen?, page?, skin?, document?, rev?}`,
// accepted only from the window framing Vela and only from the connected Ether origin
// (or the same-origin preview host).

export interface PreviewReloadMessage {
  screen?: string;
  page?: string;
  skin?: string;
  document?: Record<string, unknown>;
  rev?: number;
}

export function acceptReload(
  event: { source: unknown; origin: string; data: unknown },
  parent: unknown,
  origin: string | undefined,
  extraAllowedOrigin?: string,
): PreviewReloadMessage | undefined {
  const allowed = !!origin && event.origin === origin || (!!extraAllowedOrigin && event.origin === extraAllowedOrigin);
  if (!allowed || event.source !== parent) return undefined;
  const data = event.data as {
    type?: unknown;
    screen?: unknown;
    page?: unknown;
    skin?: unknown;
    document?: unknown;
    rev?: unknown;
  } | null;
  if (!data || typeof data !== 'object' || data.type !== 'vela:screen-preview:reload') return undefined;
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  const doc = data.document && typeof data.document === 'object' && !Array.isArray(data.document)
    ? (data.document as Record<string, unknown>)
    : undefined;
  const rev = typeof data.rev === 'number' && Number.isFinite(data.rev) ? data.rev : undefined;
  return {
    screen: text(data.screen),
    page: text(data.page),
    ...(text(data.skin) ? { skin: text(data.skin) } : {}),
    ...(doc ? { document: doc } : {}),
    ...(rev !== undefined ? { rev } : {}),
  };
}

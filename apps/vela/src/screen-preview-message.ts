// Ether Studio's reload message (screen-preview.tsx): `{type: 'vela:screen-preview:reload', screen?, page?}`,
// accepted only from the window framing Vela and only from the connected Ether origin.

export function acceptReload(event: { source: unknown; origin: string; data: unknown }, parent: unknown, origin: string | undefined): { screen?: string; page?: string } | undefined {
  if (!origin || event.source !== parent || event.origin !== origin) return undefined;
  const data = event.data as { type?: unknown; screen?: unknown; page?: unknown } | null;
  if (!data || typeof data !== 'object' || data.type !== 'vela:screen-preview:reload') return undefined;
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  return { screen: text(data.screen), page: text(data.page) };
}

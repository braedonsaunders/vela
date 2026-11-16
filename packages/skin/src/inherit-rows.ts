/** Resolve CSS inherit before translating text styles for native and web. */
export function inheritRows(parent: Record<string, string>, child: Record<string, string>): Record<string, string> {
  const rows = { ...parent };
  for (const [key, value] of Object.entries(child)) {
    if (value.trim().toLowerCase() !== 'inherit') rows[key] = value;
  }
  return rows;
}

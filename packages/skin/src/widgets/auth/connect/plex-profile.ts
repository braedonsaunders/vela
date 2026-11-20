/** Profile columns follow the full viewport; the auth card has room for all four on desktop. */
export function profileGridColumns(width: number): 2 | 3 | 4 {
  return width < 520 ? 2 : width < 1000 ? 3 : 4;
}

export function profileInitials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]!.toLocaleUpperCase()).join('') || '?';
}

export function nextProfilePin(pin: string, key: string): string {
  if (key === 'delete') return pin.slice(0, -1);
  return /^\d$/.test(key) && pin.length < 4 ? pin + key : pin;
}

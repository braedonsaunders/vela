/** Only app-local routes may survive an authentication round trip. */
export function safeReturnTo(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  const pathname = candidate.split(/[?#]/, 1)[0];
  return pathname === '/sign-in' || pathname === '/connect' ? '/' : candidate;
}

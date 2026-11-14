import { catalogs } from './catalogs';

export interface LocaleContext { locale: string; formatLocale: string; resolvedLocale: string; timeZone: string; utcOffset: number }
let current: LocaleContext = { locale: 'en', formatLocale: 'en', resolvedLocale: 'en', timeZone: 'UTC', utcOffset: 0 };
export function setLocale(json: string): void {
  const value = JSON.parse(json) as LocaleContext;
  if (!value || typeof value.locale !== 'string' || typeof value.formatLocale !== 'string' || typeof value.resolvedLocale !== 'string' || typeof value.timeZone !== 'string' || typeof value.utcOffset !== 'number') throw new Error('Invalid locale context');
  // Validate before replacing the context: invalid native settings must not poison rendering.
  new Intl.NumberFormat(value.formatLocale);
  new Intl.DateTimeFormat(value.formatLocale, { timeZone: value.timeZone });
  current = value;
}
export function localeContext(): LocaleContext { return current; }
/** A request projects synchronously under its own locale without changing the session locale. */
export function withLocale<T>(json: string | undefined, run: () => T): T {
  if (!json) return run();
  const previous = current;
  setLocale(json);
  try { return run(); } finally { current = previous; }
}
export function msg(key: string, params: Record<string, string | number> = {}): string {
  const name = current.resolvedLocale.toLowerCase();
  const found = Object.keys(catalogs).find(k => k.toLowerCase() === name) ?? Object.keys(catalogs).find(k => k.toLowerCase() === name.split('-')[0]) ?? 'en';
  const other = key.replace(/\.(zero|one|two|few|many)$/, '.other');
  const template = catalogs[found]?.[key] ?? catalogs[found]?.[other] ?? catalogs.en?.[key] ?? catalogs.en?.[other] ?? key;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (all, name: string) => name in params ? String(params[name]) : all);
}
export function number(value: number, options?: Intl.NumberFormatOptions): string { return new Intl.NumberFormat(current.formatLocale, options).format(value); }
export function plural(value: number): string {
  return typeof Intl.PluralRules === 'function' ? new Intl.PluralRules(current.resolvedLocale).select(value) : value === 1 ? 'one' : 'other';
}
export function minute(value: number): string { return number(value, { style: 'unit', unit: 'minute', unitDisplay: 'short' }); }
export function time(value: number): string { return new Intl.DateTimeFormat(current.formatLocale, { timeZone: current.timeZone, hour: 'numeric', minute: '2-digit' }).format(value); }
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${number(Math.floor(whole / 60), { useGrouping: false })}:${number(whole % 60, { minimumIntegerDigits: 2, useGrouping: false })}`;
}

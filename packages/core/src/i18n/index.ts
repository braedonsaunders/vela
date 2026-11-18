import { catalogs } from './catalogs';

export interface LocaleContext { locale: string; formatLocale: string; resolvedLocale: string; timeZone: string; utcOffset: number }
/** The device's own locale and time zone: the context until a host or server sets another. Times
 * (a clock, a guide, air dates) read in the viewer's zone, never UTC by default. */
export function deviceLocale(): LocaleContext {
  try {
    const options = new Intl.DateTimeFormat().resolvedOptions();
    const locale = options.locale || 'en';
    const timeZone = options.timeZone || 'UTC';
    new Intl.DateTimeFormat(locale, { timeZone });
    return { locale, formatLocale: locale, resolvedLocale: locale, timeZone, utcOffset: -new Date().getTimezoneOffset() };
  } catch {
    return { locale: 'en', formatLocale: 'en', resolvedLocale: 'en', timeZone: 'UTC', utcOffset: 0 };
  }
}
let current: LocaleContext = deviceLocale();
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
/** Intl construction is expensive on TV; keep a bounded cache separated by locale/options. */
function formatter<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = create(); cache.set(key, value);
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  return value;
}
const numbers = new Map<string, Intl.NumberFormat>();
const clocks = new Map<string, Intl.DateTimeFormat>();
const plurals = new Map<string, Intl.PluralRules>();
export function number(value: number, options?: Intl.NumberFormatOptions): string { return formatter(numbers, `${current.formatLocale}|${JSON.stringify(options)}`, () => new Intl.NumberFormat(current.formatLocale, options)).format(value); }
export function plural(value: number): string {
  return typeof Intl.PluralRules === 'function' ? formatter(plurals, current.resolvedLocale, () => new Intl.PluralRules(current.resolvedLocale)).select(value) : value === 1 ? 'one' : 'other';
}

// Durations and percentages are catalog strings around a plain number, never Intl's `unit` or
// `percent` styles: Hermes on Apple formats those through the platform's measurement formatter
// in base units (90 minutes drew as "5,400s").
export function minute(value: number): string {
  return msg(`unit.minute.${plural(value)}`, { count: number(value) });
}
export function second(value: number, maximumFractionDigits = 0): string {
  return msg(`unit.second.${plural(value)}`, { count: number(value, { maximumFractionDigits }) });
}
/** A fraction (0.42) as a whole percentage ("42%"). */
export function percent(fraction: number): string {
  return msg('unit.percent', { value: number(Math.round(fraction * 100)) });
}
export function time(value: number): string { return formatter(clocks, `${current.formatLocale}|${current.timeZone}`, () => new Intl.DateTimeFormat(current.formatLocale, { timeZone: current.timeZone, hour: 'numeric', minute: '2-digit' })).format(value); }
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${number(Math.floor(whole / 60), { useGrouping: false })}:${number(whole % 60, { minimumIntegerDigits: 2, useGrouping: false })}`;
}

import type { ArtworkRef } from '../wire';

/** How the selected server addresses artwork. Ether resolves relative grants on its origin;
 * a native server sizes its own image URLs for each slot (`sized`), which may carry an
 * in-memory transient credential and is never persisted or logged. */
export interface Images {
  origin: string;
  sized?: (url: URL, width: number, height: number) => string | undefined;
  /** Ask Ether's proxy for widths between the advertised sizes. */
  fitProxyWidth?: boolean;
}

/** Select the smallest supplied image that covers the requested display size. */
export function artworkURL(artwork: ArtworkRef, width: number, height: number, images?: Images): string | undefined {
  const sizes = [...artwork.sizes].sort((a, b) => a.width * a.height - b.width * b.height);
  const size = sizes.find(size => size.width >= width && size.height >= height) ?? sizes[sizes.length - 1];
  const url = size?.url;
  if (!url || !images) return url;
  // Every card resolves several of these: the WHATWG URL parser is JavaScript in React Native, and on a
  // 32-bit TV box it cost seconds of a cold start. A plain address takes a string path with the same result.
  return (images.sized ? undefined : quickArtworkURL(url, size, sizes, width, height, images))
    ?? urlArtworkURL(url, size, sizes, width, height, images);
}

type Size = ArtworkRef['sizes'][number];

/** The reference resolution (URL objects): every address the quick path does not take. */
export function urlArtworkURL(url: string, size: Size, sizes: Size[], width: number, height: number, images: Images): string | undefined {
  const origin = images.origin;
  const resolved = new URL(url, `${origin.replace(/\/$/, '')}/`);
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
  if (images.sized) return images.sized(resolved, Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  // Keep signed query parameters byte-for-byte. Only Ether's same-server image proxy offers
  // dynamic sizing; other URLs and adapters keep their own width semantics.
  if (resolved.origin === new URL(origin).origin && resolved.pathname.startsWith('/vela/v0/images/')) {
    const widths = resolved.searchParams.getAll('w');
    if (!widths.length) {
      const target = proxyWidth(sizes, width);
      resolved.search = `${resolved.search}${resolved.search ? '&' : '?'}w=${target}`;
    } else if (images.fitProxyWidth && widths.length === 1) {
      const target = fitWidth(size, width, height);
      const advertised = Number(widths[0]);
      if (!Number.isFinite(advertised) || advertised <= 0 || target < advertised) {
        resolved.search = resolved.search.replace(/([?&]w=)[^&]*(?=&|$)/, (_, prefix) => prefix + target);
      }
    }
  }
  return resolved.href;
}

/** The width asked of the proxy when the address names none: the request, at most the largest size. */
function proxyWidth(sizes: Size[], width: number): number {
  const maximum = Math.max(0, ...sizes.map(size => size.width));
  return Math.max(1, Math.ceil(maximum > 0 ? Math.min(width, maximum) : width));
}

/** A cover crop also needs enough source rows to fill the requested height. */
function fitWidth(size: Size, width: number, height: number): number {
  const cover = size.width > 0 && size.height > 0 ? height * size.width / size.height : width;
  return Math.ceil(Math.max(1, width, cover));
}

/** Characters the URL parser leaves as they are in a path and query. */
const PLAIN = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*$/;
/** A dot segment, which the parser would resolve away. */
const DOT_SEGMENT = /\/\.\.?(?=\/|\?|$)/;
/** An absolute address the parser would not change: lowercase scheme and host, no credentials. */
const ABSOLUTE = /^(https?):\/\/([a-z0-9.-]+)(:\d+)?(\/.*)$/;
const origins = new Map<string, string | null>();

/** The configured origin as URL serialises it (scheme://host[:port]), parsed once per origin. */
function normalOrigin(origin: string): string | null {
  let known = origins.get(origin);
  if (known === undefined) {
    try {
      const parsed = new URL(`${origin.replace(/\/$/, '')}/`);
      known = parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
    } catch {
      known = null;
    }
    origins.set(origin, known);
  }
  return known;
}

/** The quick path: a root-relative or plain absolute address, resolved and sized with string work only.
 * undefined for anything the URL parser might rewrite, which then takes urlArtworkURL. */
export function quickArtworkURL(url: string, size: Size, sizes: Size[], width: number, height: number, images: Images): string | undefined {
  const origin = normalOrigin(images.origin);
  if (!origin || !PLAIN.test(url) || url.endsWith('?')) return undefined;
  let href: string, path: string;
  if (url.startsWith('/') && !url.startsWith('//')) {
    href = origin + url;
    path = url;
  } else {
    const absolute = ABSOLUTE.exec(url);
    if (!absolute) return undefined;
    const [, scheme, , port, rest] = absolute;
    if ((scheme === 'http' && port === ':80') || (scheme === 'https' && port === ':443')) return undefined;
    href = url;
    path = rest!;
  }
  const query = path.indexOf('?');
  const pathname = query < 0 ? path : path.slice(0, query);
  if (DOT_SEGMENT.test(pathname)) return undefined;
  if (!href.startsWith(`${origin}/`) || !pathname.startsWith('/vela/v0/images/')) return href;
  const search = query < 0 ? '' : path.slice(query);
  // URLSearchParams decodes names and values; a w written with escapes takes the reference path.
  const pairs = search ? search.slice(1).split('&') : [];
  if (pairs.some(pair => /[%+]/.test(pair.split('=')[0]!))) return undefined;
  const widths = pairs.filter(pair => pair.split('=')[0] === 'w').map(pair => pair.slice(2));
  if (widths.some(value => /[%+]/.test(value))) return undefined;
  const base = href.slice(0, href.length - search.length);
  if (!widths.length) return `${base}${search}${search ? '&' : '?'}w=${proxyWidth(sizes, width)}`;
  if (images.fitProxyWidth && widths.length === 1) {
    const target = fitWidth(size, width, height);
    const advertised = Number(widths[0]);
    if (!Number.isFinite(advertised) || advertised <= 0 || target < advertised) {
      return base + search.replace(/([?&]w=)[^&]*(?=&|$)/, (_, prefix) => prefix + target);
    }
  }
  return href;
}

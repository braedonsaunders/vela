// Pure action argument validation and normalisation for renderer-19 plugin screens (`docs/plugin-screens.md` §7).
// Tested without a React renderer via `bun:test`.

export type BuiltinScreenRoute = 'title' | 'live' | 'guide' | 'search' | 'home' | 'library';

const BUILTIN_ROUTES = new Set<BuiltinScreenRoute>(['title', 'live', 'guide', 'search', 'home', 'library']);

export type ValidatedScreenAction =
  | {
      kind: 'navigatePage';
      screenId: string;
      page: string;
      params: Record<string, string>;
    }
  | {
      kind: 'navigateRoute';
      route: BuiltinScreenRoute;
      id?: string;
      channel?: string;
      query?: string;
    }
  | {
      kind: 'setParam';
      param: string;
      value: string;
      clear: string[];
    }
  | {
      kind: 'flag';
      op: 'toggle' | 'only' | 'open' | 'close';
      flag: string;
    }
  | {
      kind: 'playChannel';
      channelId: string;
    }
  | {
      kind: 'playProgramme';
      programmeId: string;
      channelId: string;
      from: 'live' | 'start';
    }
  | {
      kind: 'playItem';
      itemId: string;
    }
  | {
      kind: 'multiview';
      channelId: string;
    }
  | {
      kind: 'plugin';
      name: string;
      args: Record<string, string>;
    }
  | {
      kind: 'openLink';
      href: string;
    }
  | {
      kind: 'back';
    }
  | {
      kind: 'retry';
    };

/** Strips a record prefix (`"channel:ch-fox"` -> `"ch-fox"`, `"p:p1"` / `"programme:p1"` -> `"p1"`, `"item:m1"` -> `"m1"`). */
export function stripRecordPrefix(value: string, expectedPrefix?: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (expectedPrefix && trimmed.startsWith(`${expectedPrefix}:`)) {
    return trimmed.slice(expectedPrefix.length + 1).trim();
  }
  const colon = trimmed.indexOf(':');
  if (colon > 0 && /^[a-zA-Z][\w-]*$/.test(trimmed.slice(0, colon))) {
    return trimmed.slice(colon + 1).trim();
  }
  return trimmed;
}

/**
 * Validates that an `openLink` target:
 * 1. Is never allowed on TV (`isTV === false`).
 * 2. Is a valid `https:` URL.
 * 3. Appears verbatim in the page's `$link` envelope set (`allowedLinks`), which core collects
 *    from `{ href, host }` objects produced by Ether's `$link` unwrapping. A literal URL in a
 *    document or an arbitrary string field in a source is refused.
 */
export function validateOpenLinkHref(
  href: string | undefined,
  allowedLinks: ReadonlySet<string> | undefined,
  isTV = false,
): string | null {
  if (isTV) return null;
  const candidate = (href ?? '').trim();
  if (!candidate) return null;
  if (!/^https:\/\//i.test(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  if (!allowedLinks || !allowedLinks.has(candidate)) return null;
  return candidate;
}

export interface ValidateActionContext {
  currentScreenId?: string;
  allowedLinks?: ReadonlySet<string>;
  isTV?: boolean;
  canMultiview?: boolean;
}

/**
 * Validates and normalizes a screen press action (`action`, `arg`, `args`) into a strongly-typed
 * `ValidatedScreenAction`, or returns `null` when the arguments are missing, invalid, or forbidden.
 */
export function validateScreenAction(
  action: string,
  arg: string | undefined,
  args: Record<string, string> | undefined,
  context: ValidateActionContext = {},
): ValidatedScreenAction | null {
  const a = args ?? {};
  switch (action) {
    case 'navigate': {
      const page = (a.page ?? '').trim();
      const route = (a.route ?? '').trim() as BuiltinScreenRoute;
      if (page) {
        const screenId = (a.screen ?? context.currentScreenId ?? '').trim();
        if (!screenId) return null;
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(a)) {
          if (k === 'page' || k === 'screen' || k === 'route') continue;
          if (v !== '') params[k] = v;
        }
        return { kind: 'navigatePage', screenId, page, params };
      }
      if (route && BUILTIN_ROUTES.has(route)) {
        const id = a.id ? stripRecordPrefix(a.id, 'item') : undefined;
        const channel = a.channel ? stripRecordPrefix(a.channel, 'channel') : undefined;
        const query = a.query !== undefined ? a.query : undefined;
        if (route === 'title' && !id) return null;
        return { kind: 'navigateRoute', route, id, channel, query };
      }
      return null;
    }

    case 'setParam': {
      const param = (a.param ?? arg ?? '').trim();
      if (!param) return null;
      const value = a.value ?? '';
      const clearRaw = (a.clear ?? '').trim();
      const clear = clearRaw ? clearRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
      return { kind: 'setParam', param, value, clear };
    }

    case 'toggle':
    case 'only':
    case 'open':
    case 'close': {
      const flag = (a.flag ?? arg ?? '').trim();
      if (!flag) return null;
      return { kind: 'flag', op: action, flag };
    }

    case 'play': {
      const programmeRaw = (a.programme ?? '').trim();
      const channelRaw = (a.channel ?? '').trim();
      const itemRaw = (a.item ?? '').trim();
      if (programmeRaw && channelRaw) {
        const programmeId = stripRecordPrefix(programmeRaw);
        const channelId = stripRecordPrefix(channelRaw, 'channel');
        if (!programmeId || !channelId) return null;
        const from = a.from === 'start' ? 'start' : 'live';
        return { kind: 'playProgramme', programmeId, channelId, from };
      }
      if (channelRaw) {
        const channelId = stripRecordPrefix(channelRaw, 'channel');
        if (!channelId) return null;
        return { kind: 'playChannel', channelId };
      }
      if (itemRaw) {
        const itemId = stripRecordPrefix(itemRaw, 'item');
        if (!itemId) return null;
        return { kind: 'playItem', itemId };
      }
      return null;
    }

    case 'multiview': {
      if (context.canMultiview === false) return null;
      const channelRaw = (a.channel ?? arg ?? '').trim();
      const channelId = stripRecordPrefix(channelRaw, 'channel');
      if (!channelId) return null;
      return { kind: 'multiview', channelId };
    }

    case 'plugin': {
      const name = (arg ?? a.name ?? '').trim();
      if (!name) return null;
      const pluginArgs: Record<string, string> = {};
      for (const [k, v] of Object.entries(a)) {
        pluginArgs[k] = v;
      }
      return { kind: 'plugin', name, args: pluginArgs };
    }

    case 'openLink': {
      const rawHref = a.href ?? arg;
      const href = validateOpenLinkHref(rawHref, context.allowedLinks, context.isTV);
      if (!href) return null;
      return { kind: 'openLink', href };
    }

    case 'back':
      return { kind: 'back' };

    case 'retry':
      return { kind: 'retry' };

    default:
      return null;
  }
}

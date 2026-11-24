import { describe, expect, test } from 'bun:test';
import {
  stripRecordPrefix,
  validateOpenLinkHref,
  validateScreenAction,
} from '../src/blocks/action-validation';
import {
  luminance,
  pathLength,
  probabilityPath,
  readableSeriesColor,
} from '../src/blocks/graph-math';
import {
  FIRST_SECTIONS,
  applyStableOrder,
  chunkGridRows,
  initialStreamedCount,
  nextStreamedCount,
  parseItemWidth,
  parsePoints,
  resolveActiveTabValue,
  resolveShelfItemWidth,
} from '../src/blocks/layout-math';
import {
  fitTable,
  fitTextMetrics,
  normalizeTableData,
  numericColumn,
  tableNaturalWidth,
  textWidth,
} from '../src/blocks/table-fit';

const idPx = (n: number) => n;

describe('table-fit (textWidth, numericColumn, fitTable, normalizeTableData)', () => {
  test('textWidth scales with font size and bold weight', () => {
    const plain = textWidth('Arsenal', 13, false);
    const bold = textWidth('Arsenal', 13, true);
    expect(plain).toBeGreaterThan(40);
    expect(bold).toBeCloseTo(plain * 1.06, 5);
    // Tabular digits have uniform width
    expect(textWidth('1234', 13)).toBeCloseTo(textWidth('5678', 13), 5);
  });

  test('numericColumn identifies numbers, records, percentages, even par E, and dashes', () => {
    const rows = [
      ['1', 'Kansas City Chiefs', '11', '1', '.917', '-', '+84', 'W5'],
      ['2', 'Buffalo Bills', '10', '2', '.833', '1.0', '+112', 'L1'],
      ['3', 'Baltimore Ravens', '8', '4', '.667', '3.0', '+59', 'E'],
    ];
    expect(numericColumn(rows, 0)).toBe(true); // position
    expect(numericColumn(rows, 1)).toBe(false); // team names
    expect(numericColumn(rows, 2)).toBe(true); // W
    expect(numericColumn(rows, 3)).toBe(true); // L
    expect(numericColumn(rows, 4)).toBe(true); // PCT
    expect(numericColumn(rows, 5)).toBe(true); // GB with dash
    expect(numericColumn(rows, 6)).toBe(true); // DIFF with +/-
    expect(numericColumn(rows, 7)).toBe(true); // STRK / E
  });

  test('normalizeTableData accepts both string[] and { cells, highlight, entityId } rows', () => {
    const mixed = normalizeTableData({
      title: 'AFC East',
      columns: ['#', 'Team', 'W', 'L'],
      rows: [
        ['1', 'Buffalo Bills', '10', '2'],
        { cells: ['2', 'Miami Dolphins', '6', '6'], highlight: true, entityId: 'team:mia' },
      ],
    });
    expect(mixed).not.toBeNull();
    expect(mixed!.title).toBe('AFC East');
    expect(mixed!.rows).toHaveLength(2);
    expect(mixed!.rows[0]).toEqual({ cells: ['1', 'Buffalo Bills', '10', '2'], highlight: false });
    expect(mixed!.rows[1]).toEqual({
      cells: ['2', 'Miami Dolphins', '6', '6'],
      highlight: true,
      entityId: 'team:mia',
    });
  });

  test('fitTable preserves the names column, position, and key columns while dropping lower-priority columns on narrow widths', () => {
    const table = {
      columns: ['#', 'Team', 'W', 'L', 'PCT', 'GB', 'HOME', 'AWAY', 'STRK'],
      rows: [
        { cells: ['1', 'Boston Celtics', '48', '12', '.800', '-', '26-4', '22-8', 'W8'], highlight: true },
        { cells: ['2', 'Cleveland Cavaliers', '44', '16', '.733', '4.0', '24-6', '20-10', 'W3'] },
        { cells: ['3', 'Milwaukee Bucks', '41', '19', '.683', '7.0', '23-7', '18-12', 'L1'] },
      ],
    };
    const metrics = fitTextMetrics(idPx, true);
    const full = fitTable(table, Infinity, metrics);
    expect(full.dropped).toEqual([]);
    expect(full.columns).toHaveLength(9);
    const nameCol = full.columns.find(c => c.name);
    expect(nameCol?.index).toBe(1);
    expect(nameCol?.align).toBe('left');
    // Leading position column aligns left even though numeric
    expect(full.columns[0]?.align).toBe('left');
    // Numeric W column aligns right
    expect(full.columns[2]?.align).toBe('right');

    // Constrain width tightly: non-key columns (STRK, AWAY, HOME) drop from the right before key columns (W, L, PCT, GB)
    const tight = fitTable(table, 280, metrics);
    expect(tight.dropped.length).toBeGreaterThan(0);
    // Names column (1) and position column (0) are never dropped
    expect(tight.columns.some(c => c.index === 0)).toBe(true);
    expect(tight.columns.some(c => c.index === 1)).toBe(true);
    // Total fitted width matches available width
    const sumWidth = tight.columns.reduce((s, c) => s + c.width, 0);
    expect(sumWidth).toBe(280);
  });

  test('tableNaturalWidth matches fitTable natural column sum', () => {
    const table = {
      columns: ['Team', 'W', 'L'],
      rows: [['Arsenal', '20', '4']],
    };
    const fit = fitTable(table, Infinity, fitTextMetrics(idPx, true));
    expect(tableNaturalWidth(idPx, table, true)).toBe(fit.natural);
  });
});

describe('layout-math (itemWidth, streaming sections, stableOrder, tabs binding, grid chunks)', () => {
  test('parseItemWidth and resolveShelfItemWidth handle auto, fixed, percent, and fit min..max', () => {
    expect(parseItemWidth(undefined, idPx)).toEqual({ kind: 'auto' });
    expect(parseItemWidth('auto', idPx)).toEqual({ kind: 'auto' });
    expect(resolveShelfItemWidth({ kind: 'auto' }, 1200)).toBeUndefined();

    const fixed = parseItemWidth('286px', idPx);
    expect(fixed).toEqual({ kind: 'fixed', width: 286 });
    expect(resolveShelfItemWidth(fixed, 1200)).toBe(286);

    const pct = parseItemWidth('100%', idPx, 800);
    expect(pct).toEqual({ kind: 'percent', percent: 100 });
    expect(resolveShelfItemWidth(pct, 800)).toBe(800);

    const fit = parseItemWidth('fit 320px..640px', idPx, 1200);
    expect(fit).toEqual({ kind: 'fit', min: 320, max: 640 });
    // Clamps to min when natural is smaller
    expect(resolveShelfItemWidth(fit, 1200, 250)).toBe(320);
    // Uses natural when within [320, 640]
    expect(resolveShelfItemWidth(fit, 1200, 480.4)).toBe(480);
    // Clamps to max when natural exceeds 640
    expect(resolveShelfItemWidth(fit, 1200, 790)).toBe(640);
    // Clamps to availableInnerWidth on a small phone screen (e.g. 339px wide)
    expect(resolveShelfItemWidth(fit, 339, 520)).toBe(339);
  });

  test('parsePoints parses px and rem values with fallback', () => {
    expect(parsePoints('14px', idPx, 10)).toBe(14);
    expect(parsePoints('1.5rem', idPx, 10)).toBe(24);
    expect(parsePoints(undefined, idPx, 26)).toBe(26);
  });

  test('initialStreamedCount and nextStreamedCount mount first 3 sections then stream +1 per frame', () => {
    expect(FIRST_SECTIONS).toBe(3);
    expect(initialStreamedCount(2)).toBe(2);
    expect(initialStreamedCount(7)).toBe(3);
    expect(nextStreamedCount(3, 7)).toBe(4);
    expect(nextStreamedCount(4, 7)).toBe(5);
    expect(nextStreamedCount(7, 7)).toBe(7);
  });

  test('applyStableOrder preserves first-seen key order when items reshuffle', () => {
    const seen = new Map<string, number>();
    const initial = [
      { id: 'team:bos', fav: true },
      { id: 'team:nyk', fav: false },
      { id: 'team:phi', fav: false },
    ];
    const firstPass = applyStableOrder(initial, x => x.id, seen);
    expect(firstPass.map(x => x.id)).toEqual(['team:bos', 'team:nyk', 'team:phi']);

    // Server re-sorts phi to front after user favourites it; shelf keeps order stable while mounted
    const reshuffledFromServer = [
      { id: 'team:bos', fav: true },
      { id: 'team:phi', fav: true },
      { id: 'team:nyk', fav: false },
    ];
    const secondPass = applyStableOrder(reshuffledFromServer, x => x.id, seen);
    expect(secondPass.map(x => x.id)).toEqual(['team:bos', 'team:nyk', 'team:phi']);
  });

  test('resolveActiveTabValue selects param, default, all, or first option', () => {
    // Explicit param wins
    expect(
      resolveActiveTabValue({
        paramValue: 'nba',
        defaultValue: 'nfl',
        hasAllOption: true,
        optionValues: ['nfl', 'nba', 'epl'],
      }),
    ).toBe('nba');

    // Empty param with no default selects All ("") when hasAllOption is true
    expect(
      resolveActiveTabValue({
        paramValue: '',
        defaultValue: '',
        hasAllOption: true,
        optionValues: ['nfl', 'nba', 'epl'],
      }),
    ).toBe('');

    // Empty param with default (e.g. schedule date or teams opening league) selects default
    expect(
      resolveActiveTabValue({
        paramValue: '',
        defaultValue: '2026-11-24',
        hasAllOption: false,
        optionValues: ['2026-11-23', '2026-11-24', '2026-11-25'],
      }),
    ).toBe('2026-11-24');

    // Empty param with no default and no All selects first option
    expect(
      resolveActiveTabValue({
        paramValue: '',
        defaultValue: '',
        hasAllOption: false,
        optionValues: ['nfl', 'nba'],
      }),
    ).toBe('nfl');
  });

  test('chunkGridRows splits items into rows of N columns', () => {
    expect(chunkGridRows(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });
});

describe('graph-math (probabilityPath, pathLength, luminance, readableSeriesColor)', () => {
  test('normalizeSeriesPoints and probabilityPath produce clamped cubic Bézier SVG paths', () => {
    const series = [{ p: 0.5 }, { p: 0.65 }, { p: 0.42 }, { p: 0.88 }];
    const res = probabilityPath(series, 400, 120, 1);
    expect(res.line.startsWith('M0,60 C')).toBe(true);
    expect(res.area.endsWith('L400,120 L0,120 Z')).toBe(true);
    expect(res.end).toBeDefined();
    expect(res.end!.x).toBe(400);
    expect(res.end!.y).toBeCloseTo(120 * (1 - 0.88), 2);

    // Subject 0 flips the vertical coordinate (1 - p)
    const flipped = probabilityPath(series, 400, 120, 0);
    expect(flipped.end!.y).toBeCloseTo(120 * 0.88, 2);

    const len = pathLength(series, 400, 120, 1);
    expect(len).toBeGreaterThan(400);
  });

  test('luminance and readableSeriesColor adjust low-contrast colours', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 4);
    expect(luminance('#ffffff')).toBeCloseTo(1, 4);
    // Very dark navy on dark surface gets lightened or falls back to altColor
    const adjusted = readableSeriesColor({ color: '#040507', altColor: '#3b82f6' }, false, '#dcb998');
    expect(adjusted).toBe('#3b82f6');
  });
});

describe('action-validation (navigate, setParam, play, multiview, plugin, openLink $link rule)', () => {
  test('stripRecordPrefix strips typed prefixes cleanly', () => {
    expect(stripRecordPrefix('channel:ch-fox', 'channel')).toBe('ch-fox');
    expect(stripRecordPrefix('p:prog-1')).toBe('prog-1');
    expect(stripRecordPrefix('programme:prog-1', 'programme')).toBe('prog-1');
    expect(stripRecordPrefix('item:mov-42', 'item')).toBe('mov-42');
    expect(stripRecordPrefix('ch-fox', 'channel')).toBe('ch-fox');
  });

  test('validateScreenAction validates navigate to plugin page and built-in routes', () => {
    expect(
      validateScreenAction('navigate', undefined, { page: 'game', event: 'event:kc-buf' }, { currentScreenId: 'sports' }),
    ).toEqual({
      kind: 'navigatePage',
      screenId: 'sports',
      page: 'game',
      params: { event: 'event:kc-buf' },
    });

    expect(
      validateScreenAction('navigate', undefined, { route: 'title', id: 'item:movie-1' }),
    ).toEqual({
      kind: 'navigateRoute',
      route: 'title',
      id: 'movie-1',
      channel: undefined,
      query: undefined,
    });

    // Built-in title route without id is rejected
    expect(validateScreenAction('navigate', undefined, { route: 'title' })).toBeNull();
  });

  test('validateScreenAction validates setParam with clear list', () => {
    expect(
      validateScreenAction('setParam', undefined, { param: 'league', value: 'nfl', clear: 'date,team' }),
    ).toEqual({
      kind: 'setParam',
      param: 'league',
      value: 'nfl',
      clear: ['date', 'team'],
    });
  });

  test('validateScreenAction validates play for channel, programme+channel+from, and item', () => {
    expect(
      validateScreenAction('play', undefined, { channel: 'channel:ch-cbs' }),
    ).toEqual({
      kind: 'playChannel',
      channelId: 'ch-cbs',
    });

    expect(
      validateScreenAction('play', undefined, {
        programme: 'p:p-100',
        channel: 'channel:ch-cbs',
        from: 'start',
      }),
    ).toEqual({
      kind: 'playProgramme',
      programmeId: 'p-100',
      channelId: 'ch-cbs',
      from: 'start',
    });

    expect(
      validateScreenAction('play', undefined, { item: 'item:ep-9' }),
    ).toEqual({
      kind: 'playItem',
      itemId: 'ep-9',
    });
  });

  test('validateOpenLinkHref enforces https, non-TV, and presence in the page $link envelope set', () => {
    const allowed = new Set(['https://www.espn.com/nfl/game/_/gameId/401']);

    // Allowed $link href on web/mobile
    expect(validateOpenLinkHref('https://www.espn.com/nfl/game/_/gameId/401', allowed, false)).toBe(
      'https://www.espn.com/nfl/game/_/gameId/401',
    );

    // Refused on TV even when in allowed set
    expect(validateOpenLinkHref('https://www.espn.com/nfl/game/_/gameId/401', allowed, true)).toBeNull();

    // Refused when literal URL is not in the server's $link envelope set
    expect(validateOpenLinkHref('https://evil.example.com/phish', allowed, false)).toBeNull();

    // Refused when non-https scheme even if somehow in set
    const withHttp = new Set(['http://www.espn.com/nfl']);
    expect(validateOpenLinkHref('http://www.espn.com/nfl', withHttp, false)).toBeNull();
  });
});

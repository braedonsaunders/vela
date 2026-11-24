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
  hasFocusableChild,
  initialStreamedCount,
  marqueeScrolls,
  marqueeStep,
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
  type RawTableData,
} from '../src/blocks/table-fit';

const idPx = (n: number) => n;

const nfl: RawTableData = {
  title: 'AFC',
  columns: ['#', 'Team', 'W', 'L', 'T', 'PCT', 'PF', 'PA', 'DIFF', 'STRK'],
  rows: [
    ['1', 'Buffalo Bills', '8', '1', '0', '.889', '287', '199', '+88', 'W5'],
    ['2', 'Kansas City Chiefs', '7', '2', '0', '.778', '237', '156', '+81', 'W2'],
    ['3', 'Jacksonville Jaguars', '7', '2', '0', '.778', '269', '144', '+125', 'W3'],
  ],
};
const soccer: RawTableData = {
  title: 'Premier League',
  columns: ['#', 'Team', 'GP', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'P'],
  rows: [
    ['1', 'Arsenal', '12', '9', '2', '1', '25', '8', '+17', '29'],
    ['2', 'Manchester City', '12', '8', '2', '2', '27', '12', '+15', '26'],
  ],
};
const text = { size: 13.5, headerSize: 11.5, gap: 10 };
const colNames = (fit: ReturnType<typeof fitTable>, table: RawTableData) => fit.columns.map(c => table.columns[c.index]);

describe('table-fit (textWidth, numericColumn, fitTable, normalizeTableData)', () => {
  test('textWidth scales with font size and bold weight', () => {
    const plain = textWidth('Arsenal', 13, false);
    const bold = textWidth('Arsenal', 13, true);
    expect(plain).toBeGreaterThan(40);
    expect(bold).toBeCloseTo(plain * 1.06, 5);
    expect(textWidth('1234', 13)).toBeCloseTo(textWidth('5678', 13), 5);
  });

  test('numbers, percentages, differences and streaks are numeric; names are not', () => {
    expect(nfl.columns.map((_, n) => numericColumn(nfl.rows as readonly (readonly string[])[], n))).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  test('a table with room keeps every column and gives the names their full width', () => {
    const fit = fitTable(nfl, Infinity, text);
    expect(fit.dropped).toEqual([]);
    const team = fit.columns.find(c => c.name)!;
    expect(nfl.columns[team.index]).toBe('Team');
    expect(team.width).toBeGreaterThanOrEqual(Math.floor(textWidth('Jacksonville Jaguars', 13.5, true)));
    for (const c of fit.columns.filter(c => !c.name && c.index > 0)) expect(c.width).toBeLessThan(team.width / 2);
  });

  test('a narrow table drops the least useful columns from the right before cutting a name', () => {
    const natural = fitTable(nfl, Infinity, text).natural;
    const fit = fitTable(nfl, natural - 150, text);
    expect(fit.dropped.length).toBeGreaterThan(0);
    expect(fit.dropped).toContain(9); // STRK goes first
    expect(colNames(fit, nfl).slice(0, 4)).toEqual(['#', 'Team', 'W', 'L']);
    const team = fit.columns.find(c => c.name)!;
    expect(team.width).toBeGreaterThanOrEqual(Math.floor(textWidth('Jacksonville Jaguars', 13.5, true)));
  });

  test('a phone keeps position, names, wins and losses; points stay over goals', () => {
    const nflFit = fitTable(nfl, 300, text);
    expect(colNames(nflFit, nfl)).toEqual(expect.arrayContaining(['#', 'Team', 'W', 'L', 'PCT']));
    expect(colNames(nflFit, nfl)).not.toContain('STRK');
    expect(nflFit.columns.find(c => c.name)!.width).toBeGreaterThanOrEqual(
      Math.floor(textWidth('Jacksonville Jaguars', 13.5, true)),
    );
    const soccerFit = fitTable(soccer, 300, text);
    expect(colNames(soccerFit, soccer)).toEqual(expect.arrayContaining(['#', 'Team', 'W', 'D', 'L', 'GD', 'P']));
    expect(colNames(soccerFit, soccer)).not.toContain('GA');
    expect(soccerFit.columns.reduce((s, c) => s + c.width, 0)).toBeLessThanOrEqual(300);
  });

  test('position aligns left, numbers right, names left', () => {
    const fit = fitTable(nfl, Infinity, text);
    expect(fit.columns[0]!.align).toBe('left');
    expect(fit.columns.find(c => c.name)!.align).toBe('left');
    expect(fit.columns.at(-1)!.align).toBe('right');
  });

  test('a box score names its first column even when it is short', () => {
    const box: RawTableData = {
      title: 'Linescore',
      columns: ['', '1', '2', 'T'],
      rows: [
        ['NYG', '7', '3', '10'],
        ['PHI', '0', '14', '14'],
      ],
    };
    const fit = fitTable(box, 280, text);
    expect(fit.dropped).toEqual([]);
    expect(fit.columns[0]!.name).toBe(true);
    expect(fit.columns[0]!.width).toBeGreaterThan(100);
  });

  test('short words align left like words, and a wide table keeps its numbers near the names', () => {
    const f1: RawTableData = {
      title: 'Race',
      columns: ['Pos', 'Driver', 'Code', 'Country'],
      rows: [
        ['1', 'Max Verstappen', 'VER', 'Netherlands'],
        ['2', 'Lando Norris', 'NOR', 'Britain'],
      ],
    };
    const fit = fitTable(f1, 1200, text);
    expect(fit.columns.map(c => c.align)).toEqual(['left', 'left', 'left', 'left']);
    const wide = fitTable(nfl, 1200, text);
    const team = wide.columns.find(c => c.name)!;
    expect(wide.columns.reduce((s, c) => s + c.width, 0)).toBe(1200);
    expect(wide.columns[2]!.width).toBeGreaterThan(fitTable(nfl, Infinity, text).columns[2]!.width);
    expect(team.width).toBeLessThan(1200 - 9 * 20);
  });

  test('with room, number columns share one width', () => {
    const golf: RawTableData = {
      title: 'Leaderboard',
      columns: ['Pos', 'Player', 'Score', 'R1', 'R2', 'R3', 'R4'],
      rows: [
        ['1', 'Michael Thorbjornsen', '-10', '-6', '-3', '-1', '-'],
        ['2', 'Max Greyserman', '-9', '-7', 'E', '-2', '-'],
      ],
    };
    const fit = fitTable(golf, 1500, text);
    const widths = fit.columns
      .filter(c => ['R1', 'R2', 'R3', 'R4'].includes(golf.columns[c.index]!))
      .map(c => c.width);
    expect(new Set(widths).size).toBe(1);
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
    expect(resolveShelfItemWidth(fit, 1200, 250)).toBe(320);
    expect(resolveShelfItemWidth(fit, 1200, 480.4)).toBe(480);
    expect(resolveShelfItemWidth(fit, 1200, 790)).toBe(640);
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

    const reshuffledFromServer = [
      { id: 'team:bos', fav: true },
      { id: 'team:phi', fav: true },
      { id: 'team:nyk', fav: false },
    ];
    const secondPass = applyStableOrder(reshuffledFromServer, x => x.id, seen);
    expect(secondPass.map(x => x.id)).toEqual(['team:bos', 'team:nyk', 'team:phi']);
  });

  test('resolveActiveTabValue selects param, default, all, or first option', () => {
    expect(
      resolveActiveTabValue({
        paramValue: 'nba',
        defaultValue: 'nfl',
        hasAllOption: true,
        optionValues: ['nfl', 'nba', 'epl'],
      }),
    ).toBe('nba');

    expect(
      resolveActiveTabValue({
        paramValue: '',
        defaultValue: '',
        hasAllOption: true,
        optionValues: ['nfl', 'nba', 'epl'],
      }),
    ).toBe('');

    expect(
      resolveActiveTabValue({
        paramValue: '',
        defaultValue: '2026-11-24',
        hasAllOption: false,
        optionValues: ['2026-11-23', '2026-11-24', '2026-11-25'],
      }),
    ).toBe('2026-11-24');

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

  test('hasFocusableChild detects pressable boxes, readingStop, tabs, focusRows tables, and skips static sections', () => {
    expect(hasFocusableChild({ kind: 'text' })).toBe(false);
    expect(hasFocusableChild({ kind: 'lineGraph' })).toBe(false);
    expect(hasFocusableChild({ kind: 'table', focusRows: undefined })).toBe(false);
    expect(hasFocusableChild({ kind: 'table', focusRows: 10 })).toBe(true);
    expect(hasFocusableChild({ kind: 'tabs' })).toBe(true);
    expect(
      hasFocusableChild({
        kind: 'box',
        children: [{ kind: 'text' }, { kind: 'lineGraph' }],
      }),
    ).toBe(false);
    expect(
      hasFocusableChild({
        kind: 'box',
        children: [{ kind: 'shelf', item: { kind: 'box', press: { action: 'navigate' } } }],
      }),
    ).toBe(true);
    expect(
      hasFocusableChild({
        kind: 'box',
        children: [{ kind: 'repeat', item: { kind: 'box', readingStop: true } }],
      }),
    ).toBe(true);
  });

  test('marqueeScrolls and marqueeStep loop continuously without resetting when content width shifts', () => {
    expect(marqueeScrolls(400, 600)).toBe(false);
    expect(marqueeScrolls(800, 600)).toBe(true);
    expect(marqueeStep(100, 500, 64, 500)).toBe(132);
    expect(marqueeStep(490, 500, 64, 500)).toBe(22);
    expect(marqueeStep(100, 500, 64, 0)).toBe(0);
  });
});

describe('graph-math (probabilityPath, pathLength, luminance, readableSeriesColor)', () => {
  test('the probability path is a smooth curve inside its box', () => {
    const series = [{ t: 0, value: 0.5 }, { t: 0.25, value: 0.9 }, { t: 0.5, value: 0.1 }, { t: 1, value: 0.6 }];
    const { line, area, end } = probabilityPath(series, 300, 100);
    expect(line.startsWith('M0,50 C')).toBe(true);
    expect(line.split('C').length - 1).toBe(3);
    for (const n of line.match(/-?\d+(\.\d+)?/g)!.map(Number)) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(300);
    }
    expect(area.endsWith('Z')).toBe(true);
    expect(end).toEqual({ x: 300, y: 40 });
    expect(pathLength(series, 300, 100)).toBeGreaterThan(300);
    expect(probabilityPath([], 300, 100).line).toBe('');
  });

  test('normalizeSeriesPoints and probabilityPath support subject 0 and 1', () => {
    const series = [{ p: 0.5 }, { p: 0.65 }, { p: 0.42 }, { p: 0.88 }];
    const res = probabilityPath(series, 400, 120, 1);
    expect(res.line.startsWith('M0,60 C')).toBe(true);
    expect(res.area.endsWith('L400,120 L0,120 Z')).toBe(true);
    expect(res.end).toBeDefined();
    expect(res.end!.x).toBe(400);
    expect(res.end!.y).toBeCloseTo(120 * (1 - 0.88), 2);

    const flipped = probabilityPath(series, 400, 120, 0);
    expect(flipped.end!.y).toBeCloseTo(120 * 0.88, 2);

    const len = pathLength(series, 400, 120, 1);
    expect(len).toBeGreaterThan(400);
  });

  test('luminance and readableSeriesColor adjust low-contrast colours', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 4);
    expect(luminance('#ffffff')).toBeCloseTo(1, 4);
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

    expect(validateOpenLinkHref('https://www.espn.com/nfl/game/_/gameId/401', allowed, false)).toBe(
      'https://www.espn.com/nfl/game/_/gameId/401',
    );
    expect(validateOpenLinkHref('https://www.espn.com/nfl/game/_/gameId/401', allowed, true)).toBeNull();
    expect(validateOpenLinkHref('https://evil.example.com/phish', allowed, false)).toBeNull();

    const withHttp = new Set(['http://www.espn.com/nfl']);
    expect(validateOpenLinkHref('http://www.espn.com/nfl', withHttp, false)).toBeNull();
  });
});

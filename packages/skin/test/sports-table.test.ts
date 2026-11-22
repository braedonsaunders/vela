import { expect, test } from 'bun:test';
import type { LiveTable } from '@vela/core';
import { fitTable, numericColumn, textWidth } from '../src/widgets/sports/table';

const nfl: LiveTable = {
  title: 'AFC',
  columns: ['#', 'Team', 'W', 'L', 'T', 'PCT', 'PF', 'PA', 'DIFF', 'STRK'],
  rows: [
    ['1', 'Buffalo Bills', '8', '1', '0', '.889', '287', '199', '+88', 'W5'],
    ['2', 'Kansas City Chiefs', '7', '2', '0', '.778', '237', '156', '+81', 'W2'],
    ['3', 'Jacksonville Jaguars', '7', '2', '0', '.778', '269', '144', '+125', 'W3'],
  ],
};
const soccer: LiveTable = {
  title: 'Premier League',
  columns: ['#', 'Team', 'GP', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'P'],
  rows: [['1', 'Arsenal', '12', '9', '2', '1', '25', '8', '+17', '29'], ['2', 'Manchester City', '12', '8', '2', '2', '27', '12', '+15', '26']],
};
const text = { size: 13.5, headerSize: 11.5, gap: 10 };
const names = (fit: ReturnType<typeof fitTable>, table: LiveTable) => fit.columns.map(c => table.columns[c.index]);

test('numbers, percentages, differences and streaks are numeric; names are not', () => {
  expect(table(nfl).map((_, n) => numericColumn(nfl.rows, n))).toEqual([true, false, true, true, true, true, true, true, true, true]);
  function table(t: LiveTable) { return t.columns; }
});

test('a table with room keeps every column and gives the names their full width', () => {
  const fit = fitTable(nfl, Infinity, text);
  expect(fit.dropped).toEqual([]);
  const team = fit.columns.find(c => c.name)!;
  expect(nfl.columns[team.index]).toBe('Team');
  expect(team.width).toBeGreaterThanOrEqual(Math.floor(textWidth('Jacksonville Jaguars', 13.5, true)));
  // Numeric columns are tight: far narrower than the names.
  for (const c of fit.columns.filter(c => !c.name && c.index > 0)) expect(c.width).toBeLessThan(team.width / 2);
});

test('a narrow table drops the least useful columns from the right before cutting a name', () => {
  const natural = fitTable(nfl, Infinity, text).natural;
  const fit = fitTable(nfl, natural - 150, text);
  expect(fit.dropped.length).toBeGreaterThan(0);
  expect(fit.dropped).toContain(9); // STRK goes first
  expect(names(fit, nfl).slice(0, 4)).toEqual(['#', 'Team', 'W', 'L']);
  const team = fit.columns.find(c => c.name)!;
  expect(team.width).toBeGreaterThanOrEqual(Math.floor(textWidth('Jacksonville Jaguars', 13.5, true)));
});

test('a phone keeps position, names, wins and losses; points stay over goals', () => {
  const nflFit = fitTable(nfl, 300, text);
  expect(names(nflFit, nfl)).toEqual(expect.arrayContaining(['#', 'Team', 'W', 'L', 'PCT']));
  expect(names(nflFit, nfl)).not.toContain('STRK');
  expect(nflFit.columns.find(c => c.name)!.width).toBeGreaterThanOrEqual(Math.floor(textWidth('Jacksonville Jaguars', 13.5, true)));
  const soccerFit = fitTable(soccer, 300, text);
  expect(names(soccerFit, soccer)).toEqual(expect.arrayContaining(['#', 'Team', 'W', 'D', 'L', 'GD', 'P']));
  expect(names(soccerFit, soccer)).not.toContain('GA');
  expect(soccerFit.columns.reduce((s, c) => s + c.width, 0)).toBeLessThanOrEqual(300);
});

test('position aligns left, numbers right, names left', () => {
  const fit = fitTable(nfl, Infinity, text);
  expect(fit.columns[0]!.align).toBe('left');
  expect(fit.columns.find(c => c.name)!.align).toBe('left');
  expect(fit.columns.at(-1)!.align).toBe('right');
});

test('a box score names its first column even when it is short', () => {
  const box: LiveTable = { title: 'Linescore', columns: ['', '1', '2', 'T'], rows: [['NYG', '7', '3', '10'], ['PHI', '0', '14', '14']] };
  const fit = fitTable(box, 280, text);
  expect(fit.dropped).toEqual([]);
  expect(fit.columns[0]!.name).toBe(true);
  expect(fit.columns[0]!.width).toBeGreaterThan(100);
});

test('short words align left like words, and a wide table keeps its numbers near the names', () => {
  const f1: LiveTable = { title: 'Race', columns: ['Pos', 'Driver', 'Code', 'Country'], rows: [['1', 'Max Verstappen', 'VER', 'Netherlands'], ['2', 'Lando Norris', 'NOR', 'Britain']] };
  const fit = fitTable(f1, 1200, text);
  expect(fit.columns.map(c => c.align)).toEqual(['left', 'left', 'left', 'left']);
  const wide = fitTable(nfl, 1200, text);
  const team = wide.columns.find(c => c.name)!;
  expect(wide.columns.reduce((s, c) => s + c.width, 0)).toBe(1200);
  // The numbers took some of the room, not just the names.
  expect(wide.columns[2]!.width).toBeGreaterThan(fitTable(nfl, Infinity, text).columns[2]!.width);
  expect(team.width).toBeLessThan(1200 - 9 * 20);
});

test('with room, number columns share one width', () => {
  const golf: LiveTable = { title: 'Leaderboard', columns: ['Pos', 'Player', 'Score', 'R1', 'R2', 'R3', 'R4'], rows: [['1', 'Michael Thorbjornsen', '-10', '-6', '-3', '-1', '-'], ['2', 'Max Greyserman', '-9', '-7', 'E', '-2', '-']] };
  const fit = fitTable(golf, 1500, text);
  const widths = fit.columns.filter(c => ['R1', 'R2', 'R3', 'R4'].includes(golf.columns[c.index]!)).map(c => c.width);
  expect(new Set(widths).size).toBe(1);
});

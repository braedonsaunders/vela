import { expect, test } from 'bun:test';
import type { LiveEntity, LiveLeague } from '@vela/core';
import { leagueTeams, openingLeague, pickerLeagues } from '../src/widgets/sports/teams';

const team = (id: string, league: string, favorite = false): LiveEntity => ({ id, key: `p:sports:team:${id}`, kind: 'team', name: id, league, favorite });
const leagues: LiveLeague[] = [{ id: 'nfl', name: 'NFL' }, { id: 'epl', name: 'Premier League', abbr: 'EPL' }];
const followed = (entity: LiveEntity) => entity.favorite === true;

test('the picker offers the screen leagues, then any league only the teams name', () => {
  expect(pickerLeagues(leagues, [team('a', 'nfl'), team('b', 'mls')]).map(l => l.id)).toEqual(['nfl', 'epl', 'mls']);
});

test('the picker opens on the chosen league, else a followed team, else a league with teams', () => {
  const inline = [team('arsenal', 'epl'), team('eagles', 'nfl', true)];
  expect(openingLeague(leagues, inline, 'epl', followed)).toBe('epl');
  expect(openingLeague(leagues, inline, '', followed)).toBe('nfl');
  expect(openingLeague(leagues, [team('arsenal', 'epl')], '', followed)).toBe('epl');
  expect(openingLeague(leagues, [], '', followed)).toBe('nfl');
});

test("a league's teams list the followed first, then by name", () => {
  const inline = [team('Giants', 'nfl'), team('Eagles', 'nfl', true), team('Bills', 'nfl'), team('Arsenal', 'epl')];
  const { teams, needsRead } = leagueTeams('nfl', inline, undefined, followed);
  expect(teams.map(t => t.id)).toEqual(['Eagles', 'Bills', 'Giants']);
  expect(needsRead).toBe(false);
});

test('a league the screen did not carry (or carried only followed teams of) is read', () => {
  expect(leagueTeams('epl', [team('Eagles', 'nfl')], undefined, followed).needsRead).toBe(true);
  expect(leagueTeams('nfl', [team('Eagles', 'nfl', true)], undefined, followed).needsRead).toBe(true);
  const read = leagueTeams('nfl', [team('Eagles', 'nfl', true)], [team('Eagles', 'nfl'), team('Bills', 'nfl')], followed);
  expect(read.needsRead).toBe(false);
  expect(read.teams.map(t => [t.id, t.favorite])).toEqual([['Eagles', true], ['Bills', false]]);
});

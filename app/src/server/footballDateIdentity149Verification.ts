import assert from 'node:assert/strict';
import { parseNflScoreboard, filterNflScheduleDate } from './nflAdapter.js';
import { parseNcaafScoreboard, filterNcaafScheduleDate } from './ncaafAdapter.js';
import { marketMatcher, ProviderRawEvent } from './marketMatcher.js';
import { selectDecisionBoardSlateRows } from './decisionBoardService.js';
import { selectPropSlateGames } from './propsSlateService.js';
import { scheduleDateForStartTime } from './scheduleDateIdentity.js';
import { NormalizedApexGame } from '../types.js';

function event(id: string, date: string, away = 'Arizona Cardinals', home = 'Los Angeles Chargers') {
  return {
    id,
    date,
    competitions: [{
      date,
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, description: 'Scheduled' } },
      competitors: [
        { homeAway: 'away', team: { id: `${id}a`, displayName: away, abbreviation: 'AWY' } },
        { homeAway: 'home', team: { id: `${id}h`, displayName: home, abbreviation: 'HME' } },
      ],
    }],
  };
}

const now = Date.parse('2026-09-01T12:00:00Z');
const nflRaw = {
  leagues: [{ abbreviation: 'NFL' }],
  events: [
    event('thu', '2026-09-18T00:15:00Z'), // Thu Sep 17 in Chicago
    event('sat', '2026-09-20T00:30:00Z'), // Sat Sep 19 in Chicago
    event('sun', '2026-09-20T17:00:00Z'), // Sun Sep 20 in Chicago
  ],
};
const parsedNfl = parseNflScoreboard(nflRaw, '2026-09-19', '2026-09-01T12:00:00Z', now);
assert.equal(scheduleDateForStartTime('2026-09-20T00:30:00Z'), '2026-09-19');
assert.deepEqual(filterNflScheduleDate(parsedNfl, '2026-09-19').map((g) => g.eventId), ['sat']);
assert.deepEqual(filterNflScheduleDate(parsedNfl, '2026-09-20').map((g) => g.eventId), ['sun']);

const ncaafRaw = { events: [
  event('cfbFri', '2026-09-19T00:00:00Z', 'College Away A', 'College Home A'), // Fri local
  event('cfbSat', '2026-09-20T02:00:00Z', 'College Away B', 'College Home B'), // Sat local
] };
const parsedNcaaf = parseNcaafScoreboard(ncaafRaw, '2026-09-19', '2026-09-01T12:00:00Z', now);
assert.deepEqual(filterNcaafScheduleDate(parsedNcaaf, '2026-09-19').map((g) => g.eventId), ['cfbSat']);

const satGame = filterNflScheduleDate(parsedNfl, '2026-09-19')[0];
assert.ok(satGame);
const boardRows = selectDecisionBoardSlateRows(parsedNfl, 'NFL', 12, now, '2026-09-19');
assert.deepEqual(boardRows.map((g) => g.eventId), ['sat']);
const propRows = selectPropSlateGames(parsedNfl, 'NFL', 8, '2026-09-19');
assert.deepEqual(propRows.selected.map((g) => g.eventId), ['sat']);

const wrongDateProvider: ProviderRawEvent = {
  id: 'wrong-week', sport_key: 'americanfootball_nfl', sport_title: 'NFL',
  commence_time: '2026-09-20T17:00:00Z', home_team: 'Los Angeles Chargers', away_team: 'Arizona Cardinals',
};
const exactDateProvider: ProviderRawEvent = {
  ...wrongDateProvider, id: 'exact-date', commence_time: '2026-09-20T00:30:00Z',
};
assert.equal(marketMatcher.findBestMatch(satGame as NormalizedApexGame, [wrongDateProvider]).matched, false);
assert.equal(marketMatcher.findBestMatch(satGame as NormalizedApexGame, [wrongDateProvider, exactDateProvider]).providerEvent?.id, 'exact-date');

console.log('PASS v1.14.9 football date identity verification');
console.log('- NFL weekly-scoreboard spillover is filtered to the selected America/Chicago slate date.');
console.log('- NCAAF neighboring-day spillover is filtered with the same calendar-date contract.');
console.log('- Decision-board and prop-slate selectors reject wrong-date football events.');
console.log('- Sportsbook provider event matching rejects same-team events from the wrong football date.');

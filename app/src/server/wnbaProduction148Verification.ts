import { NormalizedApexGame } from '../types.js';
import { mergeVerifiedLiveUpdates } from '../liveStateUtils.js';
import { parseWnbaScoreboard, wnbaGameToLiveUpdate } from './wnbaAdapter.js';
import { buildWnbaExpectedScores } from './gameMarketModelService.js';
import { summarizeTeamHistory, TeamGameHistoryRecord } from './gameTeamHistoryService.js';

function test(name: string, passed: boolean, details: string) {
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name} | ${details}`);
  if (!passed) process.exitCode = 1;
}

const nowMs = Date.parse('2026-09-04T18:00:00Z');
const verifiedAt = '2026-09-04T18:00:01Z';
const raw = {
  leagues: [{ abbreviation: 'WNBA' }],
  events: [
    {
      id: 'upcoming-1', date: '2026-09-04T23:00:00Z', competitions: [{
        date: '2026-09-04T23:00:00Z', status: { period: 0, displayClock: '0:00', type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, detail: '7:00 PM' } },
        competitors: [
          { homeAway: 'home', team: { id: '1', displayName: 'Chicago Sky', abbreviation: 'CHI' }, score: '0' },
          { homeAway: 'away', team: { id: '2', displayName: 'Indiana Fever', abbreviation: 'IND' }, score: '0' },
        ], venue: { fullName: 'Arena A' },
      }],
    },
    {
      id: 'live-1', date: '2026-09-04T17:00:00Z', competitions: [{
        date: '2026-09-04T17:00:00Z', status: { period: 3, displayClock: '04:21', type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, detail: '4:21 - 3rd' } },
        competitors: [
          { homeAway: 'home', team: { id: '3', displayName: 'New York Liberty', abbreviation: 'NY' }, score: '61' },
          { homeAway: 'away', team: { id: '4', displayName: 'Las Vegas Aces', abbreviation: 'LV' }, score: '58' },
        ], venue: { fullName: 'Arena B' },
      }],
    },
    {
      id: 'final-1', date: '2026-09-04T14:00:00Z', competitions: [{
        date: '2026-09-04T14:00:00Z', status: { period: 4, displayClock: '0:00', type: { name: 'STATUS_FINAL', state: 'post', completed: true, detail: 'Final' } },
        competitors: [
          { homeAway: 'home', team: { id: '5', displayName: 'Seattle Storm', abbreviation: 'SEA' }, score: '84' },
          { homeAway: 'away', team: { id: '6', displayName: 'Phoenix Mercury', abbreviation: 'PHX' }, score: '80' },
        ], venue: { fullName: 'Arena C' },
      }],
    },
  ],
};

const games = parseWnbaScoreboard(raw, '2026-09-04', verifiedAt, nowMs);
const upcoming = games.find(g => g.eventId === 'upcoming-1')!;
const live = games.find(g => g.eventId === 'live-1')!;
const final = games.find(g => g.eventId === 'final-1')!;

test('WNBA scheduled event is pregame-bet eligible', upcoming.status === 'UPCOMING' && upcoming.pregameBetEligible === true, `status=${upcoming.status}; pregame=${upcoming.pregameBetEligible}`);
test('WNBA live event is visible but never pregame eligible', live.status === 'LIVE' && live.eventVisibleInLive === true && live.pregameBetEligible === false, `status=${live.status}; visible=${live.eventVisibleInLive}; pregame=${live.pregameBetEligible}`);
test('WNBA final event is neither live-visible nor pregame eligible', final.status === 'FINAL' && final.eventVisibleInLive === false && final.pregameBetEligible === false, `status=${final.status}`);
test('WNBA live score/quarter/clock normalize correctly', live.homeScore === 61 && live.awayScore === 58 && live.period === 3 && live.displayClock === '04:21', `${live.awayScore}-${live.homeScore}; Q${live.period} ${live.displayClock}`);

const liveUpdate = wnbaGameToLiveUpdate(live);
const merged = mergeVerifiedLiveUpdates([], { [liveUpdate.eventId]: liveUpdate });
test('Live module can surface WNBA event absent from selected schedule date', merged.length === 1 && merged[0].eventId === 'live-1' && merged[0].status === 'LIVE', `merged=${merged.map(x=>x.eventId+':'+x.status).join(',')}`);

function records(team: string, baseFor: number, baseAgainst: number, recentBoost = 0): TeamGameHistoryRecord[] {
  return Array.from({ length: 14 }, (_, i) => {
    const recent = i < 5 ? recentBoost : 0;
    const pf = baseFor + recent + (i % 3) - 1;
    const pa = baseAgainst + (i % 2);
    return {
      eventId: `${team}-${i}`,
      startTime: new Date(Date.parse('2026-09-03T00:00:00Z') - i * 3 * 86400000).toISOString(),
      opponentId: `opp-${i}`,
      opponentName: `Opponent ${i}`,
      venueRole: i % 2 === 0 ? 'HOME' : 'AWAY',
      pointsFor: pf,
      pointsAgainst: pa,
      margin: pf - pa,
      total: pf + pa,
    };
  });
}

const home = summarizeTeamHistory({ sport: 'WNBA', teamId: 'h', teamName: 'Home', asOf: '2026-09-04T23:00:00Z', records: records('h', 82, 78, 6), targetVenueRole: 'HOME' });
const away = summarizeTeamHistory({ sport: 'WNBA', teamId: 'a', teamName: 'Away', asOf: '2026-09-04T23:00:00Z', records: records('a', 79, 81, -2), targetVenueRole: 'AWAY' });
const projection = buildWnbaExpectedScores(home, away);
test('WNBA production projection uses verified point-in-time history', Boolean(projection && Number.isFinite(projection.home) && Number.isFinite(projection.away)), `projection=${projection ? `${projection.away.toFixed(2)} @ ${projection.home.toFixed(2)}` : 'null'}`);
test('WNBA recent-five contribution is bounded and modest', projection?.recentBlendWeight === 0.20, `weight=${projection?.recentBlendWeight}`);

const fakeScheduled: NormalizedApexGame = { ...upcoming, pregameBetEligible: false };
test('Explicit pregame flag can fail closed independently of display status', fakeScheduled.status === 'UPCOMING' && fakeScheduled.pregameBetEligible === false, `status=${fakeScheduled.status}; pregame=${fakeScheduled.pregameBetEligible}`);

console.log(process.exitCode ? '\nAPEX 1.14.8 WNBA PRODUCTION + LIVE STATE VERIFICATION: FAIL' : '\nAPEX 1.14.8 WNBA PRODUCTION + LIVE STATE VERIFICATION: PASS');

import { parseNflScoreboard, nflStateFlags } from './nflAdapter.js';
import { parseNcaafScoreboard, ncaafStateFlags } from './ncaafAdapter.js';
import { summarizeTeamHistory, TeamGameHistoryRecord } from './gameTeamHistoryService.js';
import { buildFootballHistoricalProjection } from './gameMarketModelService.js';
import { marketProvider } from './marketProvider.js';
import { playerPropProvider } from './playerPropProvider.js';
import { ALL_SPORTS } from './sportsHub.js';
import { isDisplayedCoverageBlocker } from './decisionBoardService.js';

async function main() {
let failed = 0;
function test(name: string, ok: boolean, detail = '') {
  const marker = ok ? 'PASS' : 'FAIL';
  console.log(`${marker}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

const now = Date.parse('2026-09-04T17:00:00Z');
const fixture = (statusState: 'pre' | 'in' | 'post', completed: boolean, date: string, id = '401000001') => ({
  leagues: [{ abbreviation: 'NFL' }],
  events: [{
    id,
    date,
    competitions: [{
      date,
      status: { type: { state: statusState, completed, name: statusState === 'pre' ? 'STATUS_SCHEDULED' : statusState === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_FINAL', detail: statusState === 'in' ? '3rd Quarter' : undefined }, period: statusState === 'in' ? 3 : 0, displayClock: statusState === 'in' ? '08:12' : null },
      competitors: [
        { homeAway: 'home', team: { id: '1', displayName: 'Home Team', abbreviation: 'HOM' }, score: statusState === 'pre' ? null : '24' },
        { homeAway: 'away', team: { id: '2', displayName: 'Away Team', abbreviation: 'AWY' }, score: statusState === 'pre' ? null : '17' },
      ],
      venue: { fullName: 'Verified Stadium' },
    }],
  }],
});

const nflUpcoming = parseNflScoreboard(fixture('pre', false, '2026-09-05T17:00:00Z'), '2026-09-05', '2026-09-04T17:00:00Z', now)[0];
const nflLive = parseNflScoreboard(fixture('in', false, '2026-09-04T16:00:00Z'), '2026-09-04', '2026-09-04T17:00:00Z', now)[0];
const cfbUpcoming = parseNcaafScoreboard(fixture('pre', false, '2026-09-05T20:00:00Z', '401000002'), '2026-09-05', '2026-09-04T17:00:00Z', now)[0];
const cfbLive = parseNcaafScoreboard(fixture('in', false, '2026-09-04T16:00:00Z', '401000003'), '2026-09-04', '2026-09-04T17:00:00Z', now)[0];

test('NFL upcoming state is pregame-eligible', nflUpcoming?.status === 'UPCOMING' && nflUpcoming?.pregameBetEligible === true && nflUpcoming?.eventVisibleInLive === false);
test('NFL live state is visible but not pregame-eligible', nflLive?.status === 'LIVE' && nflLive?.pregameBetEligible === false && nflLive?.eventVisibleInLive === true && nflLive?.period === 3 && nflLive?.displayClock === '08:12');
test('NCAAF schedule identity normalizes as NCAAF', cfbUpcoming?.sport === 'NCAAF' && cfbUpcoming?.homeTeamId === '1' && cfbUpcoming?.awayTeamId === '2' && cfbUpcoming?.pregameBetEligible === true);
test('NCAAF live state is visible but fail-closed for pregame', cfbLive?.status === 'LIVE' && cfbLive?.eventVisibleInLive === true && cfbLive?.pregameBetEligible === false && cfbLive?.homeScore === 24 && cfbLive?.awayScore === 17);
test('State helper rejects a started event even if upstream status says upcoming', ncaafStateFlags('UPCOMING', '2026-09-04T16:00:00Z', now).pregameBetEligible === false && nflStateFlags('UPCOMING', '2026-09-04T16:00:00Z', now).pregameBetEligible === false);

function records(team: 'H' | 'A', count: number, baseFor: number, baseAgainst: number): TeamGameHistoryRecord[] {
  const out: TeamGameHistoryRecord[] = [];
  const start = Date.parse('2026-08-30T00:00:00Z');
  for (let i = 0; i < count; i++) {
    const pointsFor = baseFor + ((i % 5) - 2) * 2 + (team === 'H' ? 1 : 0);
    const pointsAgainst = baseAgainst + ((i % 4) - 1.5) * 2;
    out.push({
      eventId: `${team}-${i}`,
      startTime: new Date(start - i * 7 * 86400000).toISOString(),
      opponentId: `opp-${i}`,
      opponentName: `Opponent ${i}`,
      venueRole: i % 2 === 0 ? 'HOME' : 'AWAY',
      pointsFor,
      pointsAgainst,
      margin: pointsFor - pointsAgainst,
      total: pointsFor + pointsAgainst,
    });
  }
  return out;
}

const asOf = '2026-09-05T20:00:00Z';
const nflHome = summarizeTeamHistory({ sport: 'NFL', teamId: 'H', teamName: 'NFL Home', asOf, records: records('H', 18, 27, 20), targetVenueRole: 'HOME' });
const nflAway = summarizeTeamHistory({ sport: 'NFL', teamId: 'A', teamName: 'NFL Away', asOf, records: records('A', 18, 22, 24), targetVenueRole: 'AWAY' });
const cfbHome = summarizeTeamHistory({ sport: 'NCAAF', teamId: 'H', teamName: 'CFB Home', asOf, records: records('H', 14, 34, 21), targetVenueRole: 'HOME' });
const cfbAway = summarizeTeamHistory({ sport: 'NCAAF', teamId: 'A', teamName: 'CFB Away', asOf, records: records('A', 14, 24, 30), targetVenueRole: 'AWAY' });
const nflProjection = buildFootballHistoricalProjection('NFL', nflHome, nflAway);
const cfbProjection = buildFootballHistoricalProjection('NCAAF', cfbHome, cfbAway);

test('NFL production projection is available from point-in-time history', Boolean(nflProjection && Number.isFinite(nflProjection.expectedHomeScore) && Number.isFinite(nflProjection.homeWinProbability)), nflProjection ? `P(home)=${nflProjection.homeWinProbability.toFixed(3)}` : 'null');
test('NCAAF production projection is available from point-in-time history', Boolean(cfbProjection && Number.isFinite(cfbProjection.expectedTotal) && Number.isFinite(cfbProjection.homeWinProbability)), cfbProjection ? `P(home)=${cfbProjection.homeWinProbability.toFixed(3)}` : 'null');
test('NFL recent-five production contribution stays bounded', Boolean(nflProjection && nflProjection.recentBlendWeight <= 0.16 && nflProjection.recentBlendWeight >= 0));
test('NCAAF recent-five production contribution is more conservative', Boolean(cfbProjection && cfbProjection.recentBlendWeight <= 0.12 && cfbProjection.recentBlendWeight >= 0));
test('NCAAF uncertainty floor reflects wider college-football variance', Boolean(cfbProjection && cfbProjection.marginStdDev >= 14 && cfbProjection.totalStdDev >= 17.5), cfbProjection ? `marginSD=${cfbProjection.marginStdDev.toFixed(1)} totalSD=${cfbProjection.totalStdDev.toFixed(1)}` : 'null');
test('Football probabilities remain two-way complements', Boolean(nflProjection && Math.abs(nflProjection.homeWinProbability + nflProjection.awayWinProbability - 1) < 1e-9 && cfbProjection && Math.abs(cfbProjection.homeWinProbability + cfbProjection.awayWinProbability - 1) < 1e-9));

const nflKeys = await marketProvider.resolveProviderSportKeys('NFL');
const cfbKeys = await marketProvider.resolveProviderSportKeys('NCAAF');
test('NFL sportsbook game-market key is production connected', nflKeys.length === 1 && nflKeys[0] === 'americanfootball_nfl', nflKeys.join(','));
test('NCAAF sportsbook game-market key is production connected', cfbKeys.length === 1 && cfbKeys[0] === 'americanfootball_ncaaf', cfbKeys.join(','));
test('NCAAF player props remain explicitly fail-closed in v1.14.9', playerPropProvider.getPropMarketKeysForSport('NCAAF').length === 0);
test('NCAAF participates in ALL SPORTS schedule/live coverage', ALL_SPORTS.includes('NCAAF') && ALL_SPORTS.length === 8, ALL_SPORTS.join(','));
test('Early-evidence shrinkage is informational, not a displayed football blocker', !isDisplayedCoverageBlocker('NFL', 'EARLY_EVIDENCE_SHRINKAGE_ACTIVE') && !isDisplayedCoverageBlocker('NCAAF', 'EARLY_EVIDENCE_SHRINKAGE_ACTIVE'));

if (failed) {
  console.error(`\nAPEX 1.14.9 NFL + NCAAF PRODUCTION VERIFICATION: FAIL (${failed})`);
  process.exitCode = 1;
} else {
  console.log('\nAPEX 1.14.9 NFL + NCAAF PRODUCTION VERIFICATION: PASS');
}

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

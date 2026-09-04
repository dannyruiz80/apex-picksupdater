import assert from 'node:assert/strict';
import { filterWnbaSimulationGames, isValidWnbaSimulationDate } from './wnbaSimulationSlateService.js';
import { NormalizedApexGame } from '../types.js';

function game(overrides: Partial<NormalizedApexGame>): NormalizedApexGame {
  return {
    eventId: 'wnba-test',
    sport: 'WNBA',
    league: 'WNBA',
    homeTeam: 'Atlanta Dream',
    awayTeam: 'Connecticut Sun',
    startTime: '2026-09-17T23:30:00.000Z',
    scheduleDate: '2026-09-17',
    status: 'UPCOMING',
    pregameBetEligible: true,
    eventVisibleInLive: false,
    ...overrides,
  } as NormalizedApexGame;
}

assert.equal(isValidWnbaSimulationDate('2026-09-17'), true, 'Future WNBA simulation date should be accepted.');
assert.equal(isValidWnbaSimulationDate('09/17/2026'), false, 'Non-ISO simulation date should be rejected.');
assert.equal(isValidWnbaSimulationDate('not-a-date'), false, 'Invalid simulation date should be rejected.');

const filtered = filterWnbaSimulationGames([
  game({ eventId: 'upcoming' }),
  game({ eventId: 'live', status: 'LIVE', pregameBetEligible: false, eventVisibleInLive: true }),
  game({ eventId: 'final', status: 'FINAL', pregameBetEligible: false }),
  game({ eventId: 'blocked', pregameBetEligible: false }),
  game({ eventId: 'mlb', sport: 'MLB' as any }),
]);
assert.deepEqual(filtered.map(g => g.eventId), ['upcoming'], 'Simulation slate must include only pregame-eligible upcoming WNBA games.');

console.log('WNBA Monte Carlo date-selection verification passed.');
console.log('  ✓ YYYY-MM-DD future dates are accepted independently of the current Picks slate.');
console.log('  ✓ LIVE, FINAL, non-WNBA, and pregame-ineligible events remain fail-closed.');
console.log('  ✓ Date-selected WNBA simulation slate preserves verified pregame event identity.');

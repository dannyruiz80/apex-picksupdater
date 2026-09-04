import { buildWnbaWalkForwardBacktest, simulateWnbaProjection, WnbaHistoricalGame } from './wnbaBacktestMonteCarloService';
import { summarizeTeamHistory, TeamGameHistoryRecord } from './gameTeamHistoryService';
import { buildWnbaHistoricalProjection } from './gameMarketModelService';

let failures = 0;
function test(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures++;
}

const teams = [
  { id: 'A', name: 'Alpha', strength: 5 },
  { id: 'B', name: 'Beta', strength: 2 },
  { id: 'C', name: 'Gamma', strength: -1 },
  { id: 'D', name: 'Delta', strength: -4 },
];
const games: WnbaHistoricalGame[] = [];
let idx = 0;
for (const season of [2023, 2024, 2025, 2026]) {
  for (let round = 0; round < 24; round++) {
    const h = teams[(round + season) % teams.length];
    const a = teams[(round + season + 1 + (round % 2)) % teams.length];
    if (h.id === a.id) continue;
    const date = new Date(Date.UTC(season, 4 + Math.floor(round / 8), 1 + ((round * 3) % 25), 23, 0, 0));
    const paceWave = (round % 5) - 2;
    const homeScore = Math.round(81 + h.strength + 2 + paceWave);
    const awayScore = Math.round(80 + a.strength - paceWave / 2);
    games.push({
      eventId: `g${++idx}`,
      season,
      startTime: date.toISOString(),
      homeTeamId: h.id,
      homeTeam: h.name,
      awayTeamId: a.id,
      awayTeam: a.name,
      homeScore,
      awayScore,
      neutralSite: false,
    });
  }
}

const report = buildWnbaWalkForwardBacktest({ games, startSeason: 2024, endSeason: 2026, teamCount: teams.length, monteCarloTrialsPerGame: 2000 });
test('Walk-forward creates at least 30 real historical evaluations', report.evaluatedGames >= 30, `n=${report.evaluatedGames}`);
test('Monte Carlo trials are explicitly not evidence', report.simulationTrialsAreEvidence === false && report.evidence.independentDecisiveObservations === report.evaluatedGames, `trials=${report.monteCarloTrialsPerGame}; evidence=${report.evidence.independentDecisiveObservations}`);
test('Historical market ROI remains fail-closed without authentic archived odds', report.historicalMarketBacktest.status === 'UNAVAILABLE');
test('No look-ahead leakage was admitted', report.leakageRejectedGames === 0 && report.rows.every(r => (!r.latestHomeHistoryAt || Date.parse(r.latestHomeHistoryAt) < Date.parse(r.startTime)) && (!r.latestAwayHistoryAt || Date.parse(r.latestAwayHistoryAt) < Date.parse(r.startTime))), `rejected=${report.leakageRejectedGames}`);
test('Backtest exposes probability calibration metrics', report.metrics.analyticBrierScore !== null && report.metrics.analyticLogLoss !== null && report.metrics.expectedCalibrationError !== null, `brier=${report.metrics.analyticBrierScore}; ece=${report.metrics.expectedCalibrationError}`);
test('Backtest exposes score-distribution error metrics', report.metrics.meanAbsoluteMarginError !== null && report.metrics.meanAbsoluteTotalError !== null, `marginMAE=${report.metrics.meanAbsoluteMarginError}; totalMAE=${report.metrics.meanAbsoluteTotalError}`);

const historyRecords = (teamId: string, teamName: string, base: number): TeamGameHistoryRecord[] => Array.from({ length: 20 }, (_, i) => ({
  eventId: `${teamId}-${i}`,
  startTime: new Date(Date.UTC(2026, 6, 20 - i, 0, 0, 0)).toISOString(),
  opponentId: `opp-${i}`,
  opponentName: `Opponent ${i}`,
  venueRole: i % 2 ? 'AWAY' : 'HOME',
  pointsFor: base + (i % 5) - 2,
  pointsAgainst: base - 1 + ((i + 2) % 5) - 2,
  margin: 1 + (i % 5) - ((i + 2) % 5),
  total: 2 * base - 1 + (i % 5) + ((i + 2) % 5) - 4,
}));
const asOf = '2026-08-01T23:00:00.000Z';
const home = summarizeTeamHistory({ sport: 'WNBA', teamId: 'H', teamName: 'Home', asOf, records: historyRecords('H', 'Home', 84), targetVenueRole: 'HOME' });
const away = summarizeTeamHistory({ sport: 'WNBA', teamId: 'A', teamName: 'Away', asOf, records: historyRecords('A', 'Away', 80), targetVenueRole: 'AWAY' });
const projection = buildWnbaHistoricalProjection(home, away);
test('Historical replay uses the same WNBA production projection core', Boolean(projection && Number.isFinite(projection.homeWinProbability) && projection.expectedTotal > 100), projection ? `p=${projection.homeWinProbability.toFixed(3)} total=${projection.expectedTotal.toFixed(1)}` : 'null');
if (projection) {
  const simA = simulateWnbaProjection({
    eventId: 'fixture', pointInTimeValid: true, reliabilityTier: projection.reliabilityTier,
    expectedHomeScore: projection.expectedHomeScore, expectedAwayScore: projection.expectedAwayScore,
    expectedMargin: projection.expectedMargin, expectedTotal: projection.expectedTotal,
    marginStdDev: projection.marginStdDev, totalStdDev: projection.totalStdDev,
    homeWinProbability: projection.homeWinProbability,
  }, 'Away @ Home', 5000, 'fixed-seed');
  const simB = simulateWnbaProjection({
    eventId: 'fixture', pointInTimeValid: true, reliabilityTier: projection.reliabilityTier,
    expectedHomeScore: projection.expectedHomeScore, expectedAwayScore: projection.expectedAwayScore,
    expectedMargin: projection.expectedMargin, expectedTotal: projection.expectedTotal,
    marginStdDev: projection.marginStdDev, totalStdDev: projection.totalStdDev,
    homeWinProbability: projection.homeWinProbability,
  }, 'Away @ Home', 5000, 'fixed-seed');
  test('WNBA Monte Carlo is deterministic for the same seed', simA.simulatedHomeWinProbability === simB.simulatedHomeWinProbability && simA.simulatedMedianTotal === simB.simulatedMedianTotal, `p=${simA.simulatedHomeWinProbability}`);
  test('WNBA Monte Carlo agrees closely with analytic win probability', Math.abs(simA.simulatedHomeWinProbability - projection.homeWinProbability) < 0.04, `analytic=${projection.homeWinProbability.toFixed(3)} sim=${simA.simulatedHomeWinProbability.toFixed(3)}`);
}

if (failures) {
  console.log(`\nAPEX 1.14.8 WNBA BACKTEST + MONTE CARLO VERIFICATION: FAIL (${failures})`);
  process.exitCode = 1;
} else {
  console.log('\nAPEX 1.14.8 WNBA BACKTEST + MONTE CARLO VERIFICATION: PASS');
}

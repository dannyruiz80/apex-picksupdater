import { NormalizedApexEventMarkets, NormalizedApexGame } from '../types.js';
import { isDisplayedCoverageBlocker, selectDecisionBoardSlateRows } from './decisionBoardService.js';
import {
  TennisMatchWinnerProjection,
  TennisPlayerHistorySummary,
  estimateTennisWinProbability,
  evaluateTennisMoneylineMarkets,
} from './tennisMatchWinnerModelService.js';

function test(name: string, passed: boolean, details: string) {
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name} | ${details}`);
  if (!passed) process.exitCode = 1;
}

const now = Date.now();
const future = new Date(now + 4 * 60 * 60 * 1000).toISOString();
const game: NormalizedApexGame = {
  eventId: 'tennis-1144-fixture',
  sport: 'TENNIS',
  league: 'ATP Tour',
  competition: 'ATP Test',
  scheduleDate: future.slice(0, 10),
  startTime: future,
  awayTeamId: 'a',
  awayTeam: 'Player Alpha',
  awayAbbreviation: 'ALP',
  homeTeamId: 'b',
  homeTeam: 'Player Beta',
  homeAbbreviation: 'BET',
  status: 'UPCOMING',
  statusDetail: 'Scheduled',
  awayScore: null,
  homeScore: null,
  tour: 'ATP',
  tournamentId: 't1',
  tournamentName: 'ATP Test Open',
  round: 'Quarterfinal',
  court: null,
  surface: 'Hard',
  playerAId: 'a',
  playerAName: 'Player Alpha',
  playerACountry: null,
  playerBId: 'b',
  playerBName: 'Player Beta',
  playerBCountry: null,
  setsWonA: null,
  setsWonB: null,
  setScores: null,
  currentSet: null,
  winner: null,
  venue: null,
  source: 'ESPN',
  lastVerifiedAt: new Date().toISOString(),
};

const selected = selectDecisionBoardSlateRows([game], 'ALL', 8, now);
test(
  'Tennis is eligible for broad decision-board scan without a player-prop connector',
  selected.length === 1 && selected[0].sport === 'TENNIS',
  `selected=${selected.length}`,
);

test(
  'Soccer early-evidence shrinkage is informational, not a displayed blocker',
  isDisplayedCoverageBlocker('SOCCER', 'EARLY_EVIDENCE_SHRINKAGE_ACTIVE') === false,
  'EARLY_EVIDENCE_SHRINKAGE_ACTIVE hidden from Soccer rejection count',
);

test(
  'Actual Soccer value failure remains visible',
  isDisplayedCoverageBlocker('SOCCER', 'EDGE_BELOW_3PP') === true,
  'EDGE_BELOW_3PP remains a blocker',
);

const summary = (name: string, rate: number): TennisPlayerHistorySummary => ({
  playerId: name,
  playerName: name,
  sampleCount: 12,
  wins: Math.round(rate * 12),
  losses: 12 - Math.round(rate * 12),
  weightedWinRate: rate,
  surfaceSampleCount: 6,
  surfaceWeightedWinRate: rate,
  latestCompletedMatchAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
  pointInTimeValid: true,
});
const estimated = estimateTennisWinProbability(summary('A', 0.70), summary('B', 0.40));
test(
  'Independent tennis history produces directional match-winner probability',
  (estimated.playerA ?? 0) > 0.5 && Math.abs((estimated.playerA ?? 0) + (estimated.playerB ?? 0) - 1) < 1e-9,
  `pA=${estimated.playerA?.toFixed(4)} pB=${estimated.playerB?.toFixed(4)}`,
);

const projection: TennisMatchWinnerProjection = {
  modelVersion: 'APEX_TENNIS_MATCH_WINNER_V1',
  generatedAt: new Date().toISOString(),
  asOf: future,
  eventId: game.eventId,
  status: 'AVAILABLE',
  reason: null,
  validationStatus: 'EARLY_EVIDENCE',
  source: 'ESPN_TENNIS_SCOREBOARD_HISTORY',
  pointInTimeValid: true,
  reliabilityTier: 'STRONG',
  playerAProbability: 0.57,
  playerBProbability: 0.43,
  playerAHistory: summary('Player Alpha', 0.64),
  playerBHistory: summary('Player Beta', 0.52),
  targetSurface: 'Hard',
  notes: [],
};

const stamp = new Date().toISOString();
const markets: NormalizedApexEventMarkets = {
  apexEventId: game.eventId,
  providerEventId: 'provider-1',
  sport: 'TENNIS',
  league: 'ATP Test Open',
  homeTeamOrPlayerA: 'Player Alpha',
  awayTeamOrPlayerB: 'Player Beta',
  scheduledDate: future,
  retrievedAt: stamp,
  cacheStatus: 'HIT',
  source: 'fixture',
  bookmakers: ['Book One', 'Book Two'].map((title, i) => ({
    key: `book${i + 1}`,
    title,
    lastUpdate: stamp,
    markets: [
      {
        key: 'h2h',
        marketType: 'MONEYLINE',
        lastUpdate: stamp,
        outcomes: [
          { name: 'Player Alpha', price: -100, americanOdds: -100, decimalOdds: 2.0, point: null },
          { name: 'Player Beta', price: -100, americanOdds: -100, decimalOdds: 2.0, point: null },
        ],
      },
      {
        key: 'spreads',
        marketType: 'SPREAD',
        lastUpdate: stamp,
        outcomes: [
          { name: 'Player Alpha', price: -110, americanOdds: -110, decimalOdds: 1.909, point: -2.5 },
          { name: 'Player Beta', price: -110, americanOdds: -110, decimalOdds: 1.909, point: 2.5 },
        ],
      },
      {
        key: 'totals',
        marketType: 'TOTAL',
        lastUpdate: stamp,
        outcomes: [
          { name: 'Over', price: -110, americanOdds: -110, decimalOdds: 1.909, point: 22.5 },
          { name: 'Under', price: -110, americanOdds: -110, decimalOdds: 1.909, point: 22.5 },
        ],
      },
    ],
  })),
};

const evaluation = evaluateTennisMoneylineMarkets(game, markets, projection);
test(
  'Tennis match-winner can qualify without lowering 3pp edge / 3% EV thresholds',
  evaluation.picks.length === 1 && evaluation.picks[0].marketCategory === 'MATCH_WINNER' && evaluation.picks[0].side === 'AWAY',
  `picks=${evaluation.picks.length} edge=${evaluation.picks[0]?.edgePercentagePoints.toFixed(2) ?? 'n/a'} ev=${evaluation.picks[0]?.expectedValuePercent.toFixed(2) ?? 'n/a'}`,
);

test(
  'Tennis spreads and totals remain fail-closed',
  evaluation.candidateCount === 2 && evaluation.picks.every((p) => p.gameMarketType === 'MONEYLINE'),
  `moneylineCandidates=${evaluation.candidateCount} pickTypes=${evaluation.picks.map((p) => p.gameMarketType).join(',')}`,
);

console.log(process.exitCode ? '\nAPEX 1.14.4 CROSS-SPORT TENNIS VERIFICATION: FAIL' : '\nAPEX 1.14.4 CROSS-SPORT TENNIS VERIFICATION: PASS');

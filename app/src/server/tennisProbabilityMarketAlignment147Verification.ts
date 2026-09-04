import { NormalizedApexEventMarkets, NormalizedApexGame } from '../types.js';
import {
  TennisMatchWinnerProjection,
  TennisPlayerHistorySummary,
  auditTennisModelMarketAlignment,
  evaluateTennisMoneylineMarkets,
} from './tennisMatchWinnerModelService.js';

function test(name: string, passed: boolean, details: string) {
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name} | ${details}`);
  if (!passed) process.exitCode = 1;
}

const now = Date.now();
const future = new Date(now + 6 * 60 * 60 * 1000).toISOString();
const stamp = new Date().toISOString();

function tennisGame(overrides: Partial<NormalizedApexGame> = {}): NormalizedApexGame {
  return {
    eventId: 'tennis-147-fixture',
    sport: 'TENNIS',
    league: 'WTA Tour',
    competition: 'US Open',
    scheduleDate: future.slice(0, 10),
    startTime: future,
    awayTeamId: 'a',
    awayTeam: 'Paula Alpha',
    awayAbbreviation: 'ALP',
    homeTeamId: 'b',
    homeTeam: 'Bianca Beta',
    homeAbbreviation: 'BET',
    status: 'UPCOMING',
    statusDetail: 'Scheduled',
    awayScore: null,
    homeScore: null,
    tour: 'WTA',
    tournamentId: '189',
    tournamentName: 'US Open',
    round: 'Round 3',
    court: null,
    surface: 'Hard',
    tennisMatchFormat: 'SINGLES',
    playerAId: 'a',
    playerAName: 'Paula Alpha',
    playerACountry: null,
    playerBId: 'b',
    playerBName: 'Bianca Beta',
    playerBCountry: null,
    setsWonA: null,
    setsWonB: null,
    setScores: null,
    currentSet: null,
    winner: null,
    venue: 'New York, USA',
    source: 'ESPN',
    lastVerifiedAt: stamp,
    ...overrides,
  };
}

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

function projection(overrides: Partial<TennisMatchWinnerProjection> = {}): TennisMatchWinnerProjection {
  return {
    modelVersion: 'APEX_TENNIS_MATCH_WINNER_V1',
    generatedAt: stamp,
    asOf: future,
    eventId: 'tennis-147-fixture',
    status: 'AVAILABLE',
    reason: null,
    validationStatus: 'EARLY_EVIDENCE',
    source: 'ESPN_TENNIS_SCOREBOARD_HISTORY',
    pointInTimeValid: true,
    reliabilityTier: 'STRONG',
    playerAProbability: 0.57,
    playerBProbability: 0.43,
    playerAHistory: summary('Paula Alpha', 0.63),
    playerBHistory: summary('Bianca Beta', 0.52),
    targetSurface: 'Hard',
    notes: [],
    ...overrides,
  };
}

type BookLine = { title: string; aName: string; aOdds: number; bName: string; bOdds: number; reverse?: boolean };
function markets(lines: BookLine[], game = tennisGame()): NormalizedApexEventMarkets {
  return {
    apexEventId: game.eventId,
    providerEventId: 'provider-147',
    sport: 'TENNIS',
    league: 'WTA US Open',
    homeTeamOrPlayerA: game.playerAName || game.awayTeam,
    awayTeamOrPlayerB: game.playerBName || game.homeTeam,
    scheduledDate: future,
    retrievedAt: stamp,
    cacheStatus: 'HIT',
    source: 'fixture',
    bookmakers: lines.map((line, i) => {
      const outcomes = [
        { name: line.aName, price: line.aOdds, americanOdds: line.aOdds, decimalOdds: 2.0, point: null },
        { name: line.bName, price: line.bOdds, americanOdds: line.bOdds, decimalOdds: 2.0, point: null },
      ];
      if (line.reverse) outcomes.reverse();
      return {
        key: `book${i + 1}`,
        title: line.title,
        lastUpdate: stamp,
        markets: [{ key: 'h2h', marketType: 'MONEYLINE' as const, lastUpdate: stamp, outcomes }],
      };
    }),
  };
}

const game = tennisGame();
const normalMarkets = markets([
  { title: 'Book One', aName: 'P. Alpha', aOdds: -100, bName: 'B. Beta', bOdds: -100 },
  { title: 'Book Two', aName: 'P. Alpha', aOdds: -102, bName: 'B. Beta', bOdds: -98, reverse: true },
]);
const baseProjection = projection();
const audit = auditTennisModelMarketAlignment(game, normalMarkets, baseProjection);
const baseEval = evaluateTennisMoneylineMarkets(game, normalMarkets, baseProjection);

test('Alignment audit passes verified player-side mapping', audit.status === 'PASS', `status=${audit.status}; reasons=${audit.reasons.join(',') || 'none'}`);
test('Model probabilities are complementary', audit.modelProbabilitySum !== null && Math.abs(audit.modelProbabilitySum - 1) < 0.0001, `sum=${audit.modelProbabilitySum}`);
test('No-vig market consensus is complementary', audit.marketConsensusSum !== null && Math.abs(audit.marketConsensusSum - 1) < 0.0001, `sum=${audit.marketConsensusSum}`);
test('Sportsbook outcome order cannot invert Tennis side identity', audit.recognizedBookPairs === 2 && baseEval.candidateCount === 2, `pairs=${audit.recognizedBookPairs}; candidates=${baseEval.candidateCount}`);
test('3pp edge / 3% EV production gates remain unchanged', baseEval.picks.length === 1 && baseEval.picks[0].edgePercentagePoints >= 3 && baseEval.picks[0].expectedValuePercent >= 3, `picks=${baseEval.picks.length}`);

const extremeProjection = projection({ playerAProbability: 0.80, playerBProbability: 0.20 });
const extremeEval = evaluateTennisMoneylineMarkets(game, normalMarkets, extremeProjection);
test(
  'Extreme model-market disagreement remains fail-closed',
  extremeEval.picks.length === 0 && (extremeEval.rejectionReasons.MODEL_MARKET_DISAGREEMENT_EXTREME || 0) === 1,
  `reasons=${JSON.stringify(extremeEval.rejectionReasons)}`,
);
test(
  'Symmetric disagreement is counted once per event instead of once per side',
  extremeEval.alignmentAudit.eventDisagreementPP !== null && (extremeEval.rejectionReasons.MODEL_MARKET_DISAGREEMENT_EXTREME || 0) === 1,
  `disagreement=${extremeEval.alignmentAudit.eventDisagreementPP}; count=${extremeEval.rejectionReasons.MODEL_MARKET_DISAGREEMENT_EXTREME || 0}`,
);

const dispersedMarkets = markets([
  { title: 'Book Sharp A', aName: 'P. Alpha', aOdds: -300, bName: 'B. Beta', bOdds: 240 },
  { title: 'Book Sharp B', aName: 'P. Alpha', aOdds: 130, bName: 'B. Beta', bOdds: -150 },
]);
const dispersedEval = evaluateTennisMoneylineMarkets(game, dispersedMarkets, baseProjection);
test(
  'Cross-book no-vig dispersion above 8pp fails closed',
  dispersedEval.picks.length === 0 && (dispersedEval.rejectionReasons.TENNIS_MARKET_CONSENSUS_DISPERSED || 0) === 1,
  `dispersion=${dispersedEval.alignmentAudit.marketDispersionPP}; reasons=${JSON.stringify(dispersedEval.rejectionReasons)}`,
);

const smithGame = tennisGame({
  eventId: 'smith-v-smith',
  awayTeam: 'Alex Smith',
  homeTeam: 'Ben Smith',
  playerAId: 'alex-smith',
  playerAName: 'Alex Smith',
  playerBId: 'ben-smith',
  playerBName: 'Ben Smith',
});
const smithProjection = projection({
  eventId: smithGame.eventId,
  playerAProbability: 0.55,
  playerBProbability: 0.45,
  playerAHistory: summary('Alex Smith', 0.60),
  playerBHistory: summary('Ben Smith', 0.55),
});
const ambiguousMarkets = markets([
  { title: 'Book One', aName: 'Smith', aOdds: -110, bName: 'B. Smith', bOdds: -110 },
  { title: 'Book Two', aName: 'Smith', aOdds: -108, bName: 'B. Smith', bOdds: -112 },
], smithGame);
const ambiguousEval = evaluateTennisMoneylineMarkets(smithGame, ambiguousMarkets, smithProjection);
test(
  'Ambiguous surname-only sportsbook identity remains fail-closed',
  ambiguousEval.picks.length === 0 && (ambiguousEval.rejectionReasons.TENNIS_MARKET_SIDE_IDENTITY_UNRESOLVED || 0) === 1,
  `reasons=${JSON.stringify(ambiguousEval.rejectionReasons)}`,
);

const invertedGame = tennisGame({ awayTeam: 'Bianca Beta', homeTeam: 'Paula Alpha' });
const invertedEval = evaluateTennisMoneylineMarkets(invertedGame, normalMarkets, baseProjection);
test(
  'Adapter/player side inversion is detected before recommendation',
  invertedEval.picks.length === 0 && (invertedEval.rejectionReasons.TENNIS_MODEL_SIDE_IDENTITY_UNVERIFIED || 0) === 1,
  `reasons=${JSON.stringify(invertedEval.rejectionReasons)}`,
);

const invalidComplement = projection({ playerAProbability: 0.60, playerBProbability: 0.45 });
const invalidEval = evaluateTennisMoneylineMarkets(game, normalMarkets, invalidComplement);
test(
  'Invalid model probability complement fails closed',
  invalidEval.picks.length === 0 && (invalidEval.rejectionReasons.TENNIS_MODEL_COMPLEMENT_INVALID || 0) === 1,
  `sum=${invalidEval.alignmentAudit.modelProbabilitySum}; reasons=${JSON.stringify(invalidEval.rejectionReasons)}`,
);

console.log(process.exitCode ? '\nAPEX 1.14.7 TENNIS PROBABILITY/MARKET ALIGNMENT VERIFICATION: FAIL' : '\nAPEX 1.14.7 TENNIS PROBABILITY/MARKET ALIGNMENT VERIFICATION: PASS');

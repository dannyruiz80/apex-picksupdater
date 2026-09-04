import { NormalizedApexEventMarkets, NormalizedApexGame } from '../types.js';
import { isTennisDecisionBoardEligible, selectDecisionBoardSlateRows } from './decisionBoardService.js';
import { ProviderSportDiscovery, rankTennisProviderSportKeys } from './marketProvider.js';
import {
  TennisMatchWinnerProjection,
  TennisPlayerHistorySummary,
  evaluateTennisMoneylineMarkets,
} from './tennisMatchWinnerModelService.js';

function test(name: string, passed: boolean, details: string) {
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name} | ${details}`);
  if (!passed) process.exitCode = 1;
}

const now = Date.now();
const future = new Date(now + 6 * 60 * 60 * 1000).toISOString();

function tennisGame(overrides: Partial<NormalizedApexGame> = {}): NormalizedApexGame {
  return {
    eventId: 'tennis-146-fixture',
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
    lastVerifiedAt: new Date().toISOString(),
    ...overrides,
  };
}

const singles = tennisGame();
const doubles = tennisGame({
  eventId: 'doubles',
  tennisMatchFormat: 'DOUBLES',
  playerAName: 'Paula Alpha / Amy Partner',
  awayTeam: 'Paula Alpha / Amy Partner',
  playerBName: 'Bianca Beta / Beth Partner',
  homeTeam: 'Bianca Beta / Beth Partner',
});
const tbd = tennisGame({ eventId: 'tbd', playerAName: 'TBD', awayTeam: 'TBD' });

test('Known singles match is decision-board eligible', isTennisDecisionBoardEligible(singles), 'singles=true');
test('Doubles are fail-closed before model/odds requests', !isTennisDecisionBoardEligible(doubles), 'doubles=false');
test('TBD bracket placeholders are fail-closed before model/odds requests', !isTennisDecisionBoardEligible(tbd), 'tbd=false');

const selected = selectDecisionBoardSlateRows([doubles, tbd, singles], 'TENNIS', 30, now);
test('Tennis scan selector consumes only resolved singles', selected.length === 1 && selected[0].eventId === singles.eventId, `selected=${selected.map((g) => g.eventId).join(',')}`);

const discovery: ProviderSportDiscovery[] = [
  { key: 'tennis_atp_us_open', group: 'Tennis', title: 'ATP US Open', description: 'US Open men', active: true, has_outrights: false },
  { key: 'tennis_wta_us_open', group: 'Tennis', title: 'WTA US Open', description: 'US Open women', active: true, has_outrights: false },
  { key: 'tennis_wta_guadalajara', group: 'Tennis', title: 'WTA Guadalajara Open', description: 'Guadalajara', active: true, has_outrights: false },
];
const wtaKeys = rankTennisProviderSportKeys(discovery, singles);
test('WTA event resolves WTA tournament key and never ATP key', wtaKeys[0] === 'tennis_wta_us_open' && !wtaKeys.some((k) => k.includes('tennis_atp_')), `keys=${wtaKeys.join(',')}`);

const atpCincy = tennisGame({ tour: 'ATP', league: 'ATP Tour', tournamentName: 'Cincinnati Open', competition: 'Cincinnati Open' });
const genericDiscovery: ProviderSportDiscovery[] = [
  { key: 'tennis_atp_cincinnati_open', group: 'Tennis', title: 'ATP Cincinnati Open', description: 'Cincinnati', active: true, has_outrights: false },
  { key: 'tennis_atp_montreal', group: 'Tennis', title: 'ATP Montreal', description: 'Montreal', active: true, has_outrights: false },
  { key: 'tennis_wta_cincinnati_open', group: 'Tennis', title: 'WTA Cincinnati Open', description: 'Cincinnati', active: true, has_outrights: false },
];
const atpKeys = rankTennisProviderSportKeys(genericDiscovery, atpCincy);
test('Generic tournament matching is tour-aware without hardcoded tournament list', atpKeys[0] === 'tennis_atp_cincinnati_open', `keys=${atpKeys.join(',')}`);

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

const projection: TennisMatchWinnerProjection = {
  modelVersion: 'APEX_TENNIS_MATCH_WINNER_V1',
  generatedAt: new Date().toISOString(),
  asOf: future,
  eventId: singles.eventId,
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
};

const stamp = new Date().toISOString();
const abbreviatedMarkets: NormalizedApexEventMarkets = {
  apexEventId: singles.eventId,
  providerEventId: 'provider-146',
  sport: 'TENNIS',
  league: 'WTA US Open',
  homeTeamOrPlayerA: 'Paula Alpha',
  awayTeamOrPlayerB: 'Bianca Beta',
  scheduledDate: future,
  retrievedAt: stamp,
  cacheStatus: 'HIT',
  source: 'fixture',
  bookmakers: ['Book One', 'Book Two'].map((title, i) => ({
    key: `book${i + 1}`,
    title,
    lastUpdate: stamp,
    markets: [{
      key: 'h2h',
      marketType: 'MONEYLINE',
      lastUpdate: stamp,
      outcomes: [
        { name: 'P. Alpha', price: -100, americanOdds: -100, decimalOdds: 2.0, point: null },
        { name: 'B. Beta', price: -100, americanOdds: -100, decimalOdds: 2.0, point: null },
      ],
    }],
  })),
};
const abbreviatedEval = evaluateTennisMoneylineMarkets(singles, abbreviatedMarkets, projection);
test('Abbreviated sportsbook player names resolve with ambiguity guard intact', abbreviatedEval.candidateCount === 2, `candidates=${abbreviatedEval.candidateCount}`);
test('3pp edge / 3% EV gates are unchanged', abbreviatedEval.picks.length === 1 && abbreviatedEval.picks[0].edgePercentagePoints >= 3 && abbreviatedEval.picks[0].expectedValuePercent >= 3, `picks=${abbreviatedEval.picks.length}`);

const extremeProjection: TennisMatchWinnerProjection = { ...projection, playerAProbability: 0.80, playerBProbability: 0.20 };
const extremeEval = evaluateTennisMoneylineMarkets(singles, abbreviatedMarkets, extremeProjection);
test('Extreme model-market disagreement remains VERIFY/fail-closed', extremeEval.picks.length === 0 && (extremeEval.rejectionReasons.MODEL_MARKET_DISAGREEMENT_EXTREME || 0) > 0, `extremeReasons=${JSON.stringify(extremeEval.rejectionReasons)}`);

console.log(process.exitCode ? '\nAPEX 1.14.6 TENNIS MARKET/MODEL COVERAGE VERIFICATION: FAIL' : '\nAPEX 1.14.6 TENNIS MARKET/MODEL COVERAGE VERIFICATION: PASS');

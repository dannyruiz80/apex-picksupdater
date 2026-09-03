import {
  MlbPitcherKFeatureVectorV3,
  NormalizedPlayerPropQuote,
  PlayerGameLogRecord,
} from '../types';
import { buildMlbPitcherKFeatureVectorV3 } from './mlbPitcherKFeatureService';
import { evaluateMlbPitcherKNegativeBinomial } from './mlbPitcherKNegativeBinomialService';
import {
  MlbPitcherKBoostedTrainingRow,
  trainMlbPitcherKBoostedForVerification,
} from './mlbPitcherKBoostedShadowService';
import { mlbPitcherStrikeoutV3Service } from './mlbPitcherStrikeoutV3Service';
import { marketQuotaGuard } from './marketQuotaGuard';

const AS_OF = new Date('2026-09-03T14:00:00.000Z');

function game(i: number, strikeouts: number, bf: number, innings = '6.0'): PlayerGameLogRecord {
  const day = String(28 - i * 3).padStart(2, '0');
  return {
    eventId: `g${i}`,
    gameDate: `2026-08-${day}T23:00:00.000Z`,
    opponent: `OPP${i}`,
    homeAway: i % 2 ? 'away' : 'home',
    statValue: strikeouts,
    statName: 'Strikeouts',
    resultAgainstLine: strikeouts > 5.5 ? 'OVER' : 'UNDER',
    rawStats: { strikeouts, battersFaced: bf, innings, hits: 5, walks: 2, hitByPitch: 0 },
  };
}

function makeQuote(overrides: Partial<NormalizedPlayerPropQuote> = {}): NormalizedPlayerPropQuote {
  const logs = [
    game(0, 8, 25), game(1, 7, 24), game(2, 6, 24), game(3, 9, 26), game(4, 5, 23),
    game(5, 7, 25), game(6, 6, 24), game(7, 8, 26), game(8, 4, 22), game(9, 7, 25),
  ];
  return {
    quoteId: 'q-v3-test',
    apexEventId: 'apex-test',
    providerEventId: 'provider-test',
    sport: 'MLB',
    league: 'MLB',
    playerId: 'espn-123',
    playerDisplayName: 'Verified Pitcher',
    verifiedTeam: 'Detroit Tigers',
    verifiedOpponent: 'Boston Red Sox',
    playerPosition: 'SP',
    marketCategory: 'Strikeouts',
    providerMarketKey: 'pitcher_strikeouts',
    line: 5.5,
    bookmakerKey: 'testbook',
    bookmakerTitle: 'Test Book',
    overOddsAmerican: -110,
    overOddsDecimal: 1.9091,
    underOddsAmerican: -110,
    underOddsDecimal: 1.9091,
    marketVerified: true,
    rosterVerified: true,
    rosterSource: 'VERIFIED_TEST_ROSTER',
    marketSource: 'VERIFIED_TEST_MARKET',
    providerTimestamp: '2026-09-03T13:55:00.000Z',
    retrievedAt: '2026-09-03T13:56:00.000Z',
    cacheStatus: 'MISS',
    eventStatus: 'UPCOMING',
    eventStartTime: '2026-09-04T00:00:00.000Z',
    historicalStats: {
      playerId: 'espn-123',
      playerDisplayName: 'Verified Pitcher',
      verifiedTeam: 'Detroit Tigers',
      sport: 'MLB',
      season: '2026 Regular Season',
      providerMarketKey: 'pitcher_strikeouts',
      statCategory: 'Strikeouts',
      targetLine: 5.5,
      status: 'STATS_VERIFIED',
      statusMessage: 'Verified test logs',
      source: 'VERIFIED_TEST_GAME_LOGS',
      totalGamesRetrieved: 10,
      validGamesUsed: 10,
      excludedDnpCount: 0,
      l5SampleCount: 5,
      l5Average: 7,
      l5Values: [8, 7, 6, 9, 5],
      l5OverHitRate: 0.8,
      l5UnderHitRate: 0.2,
      l5PushCount: 0,
      l5OverCount: 4,
      l5UnderCount: 1,
      l10SampleCount: 10,
      l10Average: 6.7,
      l10Values: logs.map((x) => x.statValue),
      l10OverHitRate: 0.8,
      l10UnderHitRate: 0.2,
      l10PushCount: 0,
      l10OverCount: 8,
      l10UnderCount: 2,
      seasonSampleCount: 10,
      seasonAverage: 6.7,
      seasonOverHitRate: 0.8,
      seasonUnderHitRate: 0.2,
      seasonPushCount: 0,
      seasonOverCount: 8,
      seasonUnderCount: 2,
      recentGameLogs: logs,
      modelGameLogs: logs,
      calculationVerified: true,
      retrievedAt: '2026-09-03T13:50:00.000Z',
      cacheStatus: 'MISS',
    },
    mlbPitcherKContext: {
      contextVersion: 'APEX_MLB_K_CONTEXT_V1',
      observedAt: '2026-09-03T13:58:00.000Z',
      sourceStatus: { mlbStats: 'AVAILABLE', statcast: 'AVAILABLE', gameEnvironment: 'AVAILABLE' },
      mlbPlayerId: 123,
      pitcherHandedness: 'L',
      opponentMlbTeamId: 111,
      opponentStrikeoutRate: 0.245,
      opponentPlateAppearances: 5000,
      officialWorkloadGames: logs.map((g) => ({ gameDate: g.gameDate, strikeouts: g.statValue, battersFaced: Number(g.rawStats.battersFaced), innings: 6, pitches: 95 })),
      recentSwStrRate: 0.142,
      recentCswRate: 0.308,
      averageFastballVelocityMph: 96.1,
      velocityDeltaMph: 0.4,
      dominantPitchShare: 0.48,
      daysRest: 5,
      venueName: 'Test Park',
      temperatureF: 72,
      windMph: 6,
      homePlateUmpire: 'Verified Umpire',
      parkFactor: null,
      umpireStrikeoutFactor: null,
      provenance: [],
      warnings: ['PARK_FACTOR_NOT_CONNECTED', 'UMPIRE_K_FACTOR_NOT_CONNECTED'],
    },
    ...overrides,
  };
}

function syntheticFeature(rate: number, line = 5.5): MlbPitcherKFeatureVectorV3 {
  return {
    featureVersion: 'APEX_MLB_K_FEATURES_V3',
    featureVectorId: `SYNTH-${rate}-${line}`,
    asOf: '2026-01-01T00:00:00.000Z',
    latestFeatureObservedAt: '2025-12-31T23:00:00.000Z',
    isPointInTimeValid: true,
    reasonCodes: [],
    dataQuality: 'ENRICHED',
    sampleStarts: 20,
    workloadStarts: 20,
    officialBattersFacedStarts: 20,
    derivedBattersFacedStarts: 0,
    workloadSource: 'OFFICIAL_BF',
    expectedBattersFaced: 24,
    expectedInnings: 6,
    seasonStrikeoutsPerBF: rate,
    l10StrikeoutsPerBF: rate,
    l5StrikeoutsPerBF: rate,
    workloadTrendBF: 0,
    strikeoutMean: rate * 24,
    strikeoutVariance: 6,
    opponentStrikeoutRate: rate,
    pitcherTeamVenueRole: 'HOME',
    pitcherHandedness: 'R',
    recentSwStrRate: rate / 2,
    recentCswRate: rate,
    averageFastballVelocityMph: 94,
    velocityDeltaMph: 0,
    dominantPitchShare: 0.5,
    daysRest: 5,
    temperatureF: 70,
    windMph: 5,
    parkFactor: null,
    umpireStrikeoutFactor: null,
    line,
  };
}

export function runMlbPitcherKV3VerificationSuite() {
  const tests: Array<{ name: string; passed: boolean; details: string }> = [];
  const initialQuota = marketQuotaGuard.getQuotaState().dailyUsed;

  const quote = makeQuote();
  const features = buildMlbPitcherKFeatureVectorV3(quote, AS_OF);
  tests.push({
    name: 'Verified workload feature construction',
    passed: features.isPointInTimeValid && features.workloadStarts === 10 && (features.expectedBattersFaced ?? 0) > 20,
    details: `quality=${features.dataQuality}; BF=${features.expectedBattersFaced}; starts=${features.workloadStarts}`,
  });

  const nb = evaluateMlbPitcherKNegativeBinomial(features);
  const nbSum = (nb.overProbability ?? 0) + (nb.underProbability ?? 0) + (nb.pushProbability ?? 0);
  tests.push({
    name: 'Negative-Binomial half-line normalization',
    passed: nb.isAvailable && Math.abs(nbSum - 1) < 0.00001 && nb.pushProbability === 0,
    details: `mu=${nb.expectedStrikeouts}; over=${nb.overProbability}; under=${nb.underProbability}; push=${nb.pushProbability}`,
  });

  const integerFeatures = { ...features, line: 6 } as MlbPitcherKFeatureVectorV3;
  const integerNb = evaluateMlbPitcherKNegativeBinomial(integerFeatures);
  const integerSum = (integerNb.overProbability ?? 0) + (integerNb.underProbability ?? 0) + (integerNb.pushProbability ?? 0);
  tests.push({
    name: 'Integer-line push probability',
    passed: integerNb.isAvailable && (integerNb.pushProbability ?? 0) > 0 && Math.abs(integerSum - 1) < 0.00001,
    details: `push=${integerNb.pushProbability}; sum=${integerSum}`,
  });

  const futureContextQuote = makeQuote({
    mlbPitcherKContext: { ...makeQuote().mlbPitcherKContext!, observedAt: '2026-09-03T15:00:00.000Z' },
  });
  const futureFeatures = buildMlbPitcherKFeatureVectorV3(futureContextQuote, AS_OF);
  tests.push({
    name: 'Future advanced context rejected',
    passed: !futureFeatures.isPointInTimeValid && futureFeatures.reasonCodes.includes('CONTEXT_FROM_FUTURE'),
    details: futureFeatures.reasonCodes.join(', '),
  });

  const derivedLogs = makeQuote().historicalStats!.modelGameLogs!.map((g) => ({
    ...g,
    rawStats: { innings: '6.0', hits: 5, walks: 2, hitByPitch: 0, strikeouts: g.statValue },
  }));
  const derivedQuote = makeQuote({ historicalStats: { ...makeQuote().historicalStats!, recentGameLogs: derivedLogs, modelGameLogs: derivedLogs }, mlbPitcherKContext: null });
  const derivedFeatures = buildMlbPitcherKFeatureVectorV3(derivedQuote, AS_OF);
  tests.push({
    name: 'Transparent BF derivation from verified box-score components',
    passed: derivedFeatures.workloadStarts === 10 && derivedFeatures.expectedBattersFaced !== null,
    details: `derived expected BF=${derivedFeatures.expectedBattersFaced}`,
  });

  const insufficient = trainMlbPitcherKBoostedForVerification([], features, nb.overProbability ?? 0.5);
  tests.push({
    name: 'Boosted challenger fails closed without evidence',
    passed: insufficient.status === 'INSUFFICIENT_EVIDENCE' && insufficient.probability === null,
    details: insufficient.reason,
  });

  const rows: MlbPitcherKBoostedTrainingRow[] = Array.from({ length: 120 }, (_, i) => {
    const high = i % 2 === 0;
    const rate = high ? 0.34 : 0.17;
    return {
      at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      y: high ? 1 : 0,
      baseProbability: 0.5,
      features: syntheticFeature(rate),
    };
  });
  const trained = trainMlbPitcherKBoostedForVerification(rows, syntheticFeature(0.34), 0.5);
  tests.push({
    name: 'Chronological boosted challenger can earn shadow activation',
    passed: trained.status === 'ACTIVE_SHADOW' && (trained.probability ?? 0) > 0.5 && trained.validation.boostedLogLoss! < trained.validation.baselineLogLoss!,
    details: `status=${trained.status}; baselineLL=${trained.validation.baselineLogLoss}; boostedLL=${trained.validation.boostedLogLoss}`,
  });

  const integerShadow = mlbPitcherStrikeoutV3Service.evaluateShadow(makeQuote({ line: 6 }), 'APEX_BASELINE_V1', 0.61, AS_OF);
  const integerShadowSum = (integerShadow.shadowOverProbability ?? 0) + (integerShadow.shadowUnderProbability ?? 0) + (integerShadow.shadowPushProbability ?? 0);
  tests.push({
    name: 'Shadow probabilities preserve integer-line push mass',
    passed: Math.abs(integerShadowSum - 1) < 0.00001 && (integerShadow.shadowPushProbability ?? 0) > 0 && integerShadow.boosted.probabilityBasis === 'OVER_GIVEN_NO_PUSH',
    details: `over=${integerShadow.shadowOverProbability}; under=${integerShadow.shadowUnderProbability}; push=${integerShadow.shadowPushProbability}; sum=${integerShadowSum}`,
  });

  const shadow = mlbPitcherStrikeoutV3Service.evaluateShadow(quote, 'APEX_BASELINE_V1', 0.61, AS_OF);
  tests.push({
    name: 'Production probability remains an immutable comparison input',
    passed: shadow.productionOverProbability === 0.61 && shadow.productionModelVersion === 'APEX_BASELINE_V1',
    details: `production=${shadow.productionOverProbability}; shadow=${shadow.shadowOverProbability}`,
  });

  const noContext = makeQuote({ mlbPitcherKContext: null });
  const noContextFeatures = buildMlbPitcherKFeatureVectorV3(noContext, AS_OF);
  tests.push({
    name: 'Missing advanced fields stay null instead of synthetic fallback',
    passed: noContextFeatures.opponentStrikeoutRate === null && noContextFeatures.recentSwStrRate === null && noContextFeatures.dataQuality === 'CORE_VERIFIED',
    details: `quality=${noContextFeatures.dataQuality}; oppK=${noContextFeatures.opponentStrikeoutRate}; swStr=${noContextFeatures.recentSwStrRate}`,
  });

  const finalQuota = marketQuotaGuard.getQuotaState().dailyUsed;
  tests.push({
    name: 'V3 verification consumes zero keyed odds-provider requests',
    passed: finalQuota === initialQuota,
    details: `dailyUsed before=${initialQuota}, after=${finalQuota}`,
  });

  return {
    suite: 'APEX MLB PITCHER K V3 SHADOW',
    shadowVersion: 'APEX_PITCHER_K_V3_SHADOW',
    passed: tests.filter((t) => t.passed).length,
    failed: tests.filter((t) => !t.passed).length,
    allPassed: tests.every((t) => t.passed),
    tests,
    timestamp: new Date().toISOString(),
  };
}

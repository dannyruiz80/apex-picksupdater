import { DurableHistoricalPropSnapshot, MlbPitcherKFeatureVectorV3 } from '../types';
import { buildChampionChallengerReportFromSnapshots } from './championChallengerService';
import { marketQuotaGuard } from './marketQuotaGuard';

function feature(i: number, home: boolean): MlbPitcherKFeatureVectorV3 {
  return {
    featureVersion: 'APEX_MLB_K_FEATURES_V3',
    featureVectorId: `V4-FEATURE-${i}`,
    asOf: new Date(Date.UTC(2026, 3, 1 + i, 12)).toISOString(),
    latestFeatureObservedAt: new Date(Date.UTC(2026, 3, 1 + i, 11, 55)).toISOString(),
    isPointInTimeValid: true,
    reasonCodes: [],
    dataQuality: 'ENRICHED',
    sampleStarts: 20,
    workloadStarts: 20,
    officialBattersFacedStarts: 20,
    derivedBattersFacedStarts: 0,
    workloadSource: 'OFFICIAL_BF',
    expectedBattersFaced: 23 + (i % 4),
    expectedInnings: 6,
    seasonStrikeoutsPerBF: 0.24,
    l10StrikeoutsPerBF: 0.25,
    l5StrikeoutsPerBF: 0.26,
    workloadTrendBF: 0.5,
    strikeoutMean: 6.1,
    strikeoutVariance: 4.2,
    opponentStrikeoutRate: 0.20 + (i % 4) * 0.02,
    pitcherTeamVenueRole: home ? 'HOME' : 'AWAY',
    pitcherHandedness: i % 2 ? 'L' : 'R',
    recentSwStrRate: 0.13,
    recentCswRate: 0.29,
    averageFastballVelocityMph: 95.1,
    velocityDeltaMph: 0.2,
    dominantPitchShare: 0.45,
    daysRest: 5,
    temperatureF: 72,
    windMph: 5,
    parkFactor: null,
    umpireStrikeoutFactor: null,
    line: 5.5,
  };
}

function snapshot(i: number, later = false): DurableHistoricalPropSnapshot {
  const overWins = i % 2 === 0;
  const day = 1 + i;
  const eventStart = new Date(Date.UTC(2026, 3, day, 20));
  const snapshotAt = new Date(eventStart.getTime() - (later ? 10 : 180) * 60_000);
  const gradingAt = new Date(eventStart.getTime() + 4 * 60 * 60_000);
  const line = i % 4 === 0 ? 4.5 : i % 4 === 1 ? 5.5 : i % 4 === 2 ? 6.5 : 7.5;
  const v3Over = overWins ? 0.96 : 0.04;
  const v3Under = 1 - v3Over;
  const productionOver = 0.50;
  const closeOverOdds = overWins ? -155 : 130;
  const closeUnderOdds = overWins ? 130 : -155;
  const overOdds = later ? closeOverOdds : -110;
  const underOdds = later ? closeUnderOdds : -110;
  const f = { ...feature(i, i % 2 === 0), line };

  return {
    snapshotId: `v4-${i}-${later ? 'close' : 'entry'}`,
    snapshotType: 'REAL_PREGAME',
    dedupFingerprint: `fp-${i}-${later ? 'close' : 'entry'}`,
    predictionId: `pred-${i}`,
    predictionContractVersion: 'APEX_PREDICTION_CONTRACT_V1',
    featureSnapshotId: `fs-${i}`,
    featureSnapshotVersion: 'APEX_FEATURE_SNAPSHOT_V1',
    featureAsOf: f.asOf,
    pointInTimeValid: true,
    calibrationVersion: 'APEX_PLATT_V1',
    calibrationStatus: 'INSUFFICIENT_EVIDENCE',
    eventId: `event-${i}`,
    providerEventId: `provider-event-${i}`,
    eventStartTime: eventStart.toISOString(),
    snapshotCreatedAt: snapshotAt.toISOString(),
    sportsbookQuoteTimestamp: new Date(snapshotAt.getTime() - 30_000).toISOString(),
    statisticsCutoffTimestamp: new Date(snapshotAt.getTime() - 60_000).toISOString(),
    playerId: `pitcher-${i}`,
    playerName: `Pitcher ${i}`,
    team: 'TEST',
    opponent: `OPP-${i % 10}`,
    sport: 'MLB',
    league: 'MLB',
    market: 'pitcher_strikeouts',
    line,
    side: 'OVER',
    sportsbook: 'TestBook',
    americanOdds: overOdds,
    decimalOdds: overOdds > 0 ? 1 + overOdds / 100 : 1 + 100 / Math.abs(overOdds),
    overOddsAmerican: overOdds,
    underOddsAmerican: underOdds,
    overAmericanOdds: overOdds,
    underAmericanOdds: underOdds,
    overDecimalOdds: overOdds > 0 ? 1 + overOdds / 100 : 1 + 100 / Math.abs(overOdds),
    underDecimalOdds: underOdds > 0 ? 1 + underOdds / 100 : 1 + 100 / Math.abs(underOdds),
    overApexProbability: productionOver,
    underApexProbability: 0.50,
    overRawProbability: productionOver,
    underRawProbability: 0.50,
    overCalibratedProbability: null,
    underCalibratedProbability: null,
    overBreakEvenProbability: 0.5238,
    underBreakEvenProbability: 0.5238,
    overEdge: -0.0238,
    underEdge: -0.0238,
    overEV: -4.55,
    underEV: -4.55,
    overDecision: 'NO_BET',
    underDecision: 'NO_BET',
    overReasonCodes: ['EDGE_BELOW_THRESHOLD'],
    underReasonCodes: ['EDGE_BELOW_THRESHOLD'],
    modelVersion: 'APEX_BASELINE_V1',
    valueEngineVersion: 'APEX_VALUE_V1',
    apexProbability: productionOver,
    breakEvenProbability: 0.5238,
    modelEdge: -0.0238,
    expectedValue: -4.55,
    reliabilityTier: 'STRONG',
    recommendation: 'NO_BET',
    reasonCodes: ['EDGE_BELOW_THRESHOLD'],
    verificationState: 'VERIFIED',
    historicalEligibility: 'ELIGIBLE',
    gradingStatus: 'GRADED',
    actualStatistic: overWins ? line + 2 : line - 2,
    gradedSideOutcome: overWins ? 'WIN' : 'LOSS',
    gradingTimestamp: gradingAt.toISOString(),
    netUnits: 0,
    unitsRisked: 0,
    dataSource: 'VERIFIED_TEST_RESULT',
    finalEventId: `event-${i}`,
    mlbPitcherKV3: {
      featureVector: f,
      negativeBinomialOverProbability: v3Over,
      negativeBinomialUnderProbability: v3Under,
      negativeBinomialPushProbability: 0,
      boostedConditionalOverProbability: v3Over,
      shadowOverProbability: v3Over,
      shadowUnderProbability: v3Under,
      shadowPushProbability: 0,
      productionPushProbability: 0,
    },
    modelInputs: {
      seasonMean: 6,
      seasonHitRate: 0.55,
      seasonSampleCount: 20,
      l10Mean: 6,
      l10HitRate: 0.55,
      l10SampleCount: 10,
      sampleReliabilityTier: 'STRONG',
      marketNoVigOver: 0.5,
      marketNoVigUnder: 0.5,
      isMarketBlended: true,
    },
  };
}

export function runChampionChallengerVerificationSuite() {
  const initialQuota = marketQuotaGuard.getQuotaState().dailyUsed;
  const snapshots: DurableHistoricalPropSnapshot[] = [];
  for (let i = 0; i < 130; i++) {
    snapshots.push(snapshot(i, false));
    snapshots.push(snapshot(i, true));
  }
  const report = buildChampionChallengerReportFromSnapshots(snapshots, new Date('2027-01-01T00:00:00.000Z'));

  const tests = [
    {
      name: 'Repeated refreshes are deduplicated for outcome scoring',
      passed: report.sourceSnapshotCount === 260 && report.deduplicatedObservationCount === 130,
      details: `source=${report.sourceSnapshotCount}; scored=${report.deduplicatedObservationCount}`,
    },
    {
      name: 'Challenger improves proper probability scores',
      passed:
        report.production.logLoss !== null && report.challenger.logLoss !== null &&
        report.challenger.logLoss < report.production.logLoss &&
        report.production.brierScore !== null && report.challenger.brierScore !== null &&
        report.challenger.brierScore < report.production.brierScore,
      details: `LL ${report.production.logLoss} -> ${report.challenger.logLoss}; Brier ${report.production.brierScore} -> ${report.challenger.brierScore}`,
    },
    {
      name: 'Latest observed pregame price movement is CLV evidence only',
      passed: report.challenger.clvSamples === 130 && (report.challenger.averageObservedClvProbabilityPoints ?? -1) > 0,
      details: `clvSamples=${report.challenger.clvSamples}; avgCLV=${report.challenger.averageObservedClvProbabilityPoints}`,
    },
    {
      name: 'Common recommendation thresholds produce challenger hypothetical plays',
      passed: report.challenger.hypotheticalQualifiedPlays === 130 && report.production.hypotheticalQualifiedPlays === 0,
      details: `production=${report.production.hypotheticalQualifiedPlays}; challenger=${report.challenger.hypotheticalQualifiedPlays}`,
    },
    {
      name: 'Cohort monitoring includes home/away and matchup buckets',
      passed:
        report.cohorts.some((c) => c.cohortType === 'HOME_AWAY' && c.cohort === 'HOME') &&
        report.cohorts.some((c) => c.cohortType === 'OPPONENT_K_RATE') &&
        report.cohorts.some((c) => c.cohortType === 'WORKLOAD'),
      details: `cohorts=${report.cohorts.length}`,
    },
    {
      name: 'Promotion can become review-eligible without automatic promotion',
      passed: report.promotion.status === 'REVIEW_ELIGIBLE' && report.promotion.automaticPromotionAllowed === false,
      details: `status=${report.promotion.status}; automatic=${report.promotion.automaticPromotionAllowed}`,
    },
    {
      name: 'All blocking promotion gates pass in strong synthetic evidence case',
      passed: report.promotion.gates.filter((g) => g.blocking).every((g) => g.passed),
      details: report.promotion.gates.map((g) => `${g.gate}:${g.passed ? 'PASS' : 'FAIL'}`).join(' | '),
    },
  ];

  const finalQuota = marketQuotaGuard.getQuotaState().dailyUsed;
  tests.push({
    name: 'Champion/challenger monitoring consumes zero keyed Odds API requests',
    passed: finalQuota === initialQuota,
    details: `initial=${initialQuota}; final=${finalQuota}; consumed=${finalQuota - initialQuota}`,
  });

  return {
    suite: 'APEX_CHAMPION_CHALLENGER_V1',
    generatedAt: new Date().toISOString(),
    totalTests: tests.length,
    passedTests: tests.filter((t) => t.passed).length,
    failedTests: tests.filter((t) => !t.passed).length,
    allPassed: tests.every((t) => t.passed),
    keyedRequestsConsumed: finalQuota - initialQuota,
    tests,
  };
}

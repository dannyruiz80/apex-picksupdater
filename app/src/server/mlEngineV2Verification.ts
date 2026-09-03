import { buildPointInTimeFeatureSnapshot } from './pointInTimeFeatureEngine';
import { applyPlatt, calculateCalibrationMetrics, fitPlattModel, CalibrationObservation, probabilityCalibrationService } from './probabilityCalibrationService';
import { buildWalkForwardPlan } from './walkForwardValidationService';
import { evaluateRecommendationGate } from './recommendationGate';

interface VerificationCase {
  testName: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

function makeQuote(): any {
  return {
    quoteId: 'pit-q1', apexEventId: 'event-2026-09-03', providerEventId: 'provider-event', sport: 'MLB', league: 'MLB',
    playerId: 'player-1', playerDisplayName: 'Verified Player', verifiedTeam: 'A', verifiedOpponent: 'B',
    marketCategory: 'Strikeouts', providerMarketKey: 'pitcher_strikeouts', line: 5.5,
    bookmakerKey: 'book', bookmakerTitle: 'Book', overOddsAmerican: 110, overOddsDecimal: 2.1,
    underOddsAmerican: -120, underOddsDecimal: 1.8333, marketVerified: true, rosterVerified: true,
    rosterSource: 'Official Roster', marketSource: 'Odds Provider', providerTimestamp: '2026-09-03T05:55:00.000Z',
    retrievedAt: '2026-09-03T05:56:00.000Z', cacheStatus: 'HIT', eventStatus: 'UPCOMING',
    eventStartTime: '2026-09-03T08:00:00.000Z',
    historicalStats: {
      playerId: 'player-1', playerDisplayName: 'Verified Player', verifiedTeam: 'A', sport: 'MLB', season: '2026',
      providerMarketKey: 'pitcher_strikeouts', statCategory: 'Strikeouts', targetLine: 5.5,
      status: 'STATS_VERIFIED', statusMessage: 'verified', source: 'Official Logs', totalGamesRetrieved: 20,
      validGamesUsed: 20, excludedDnpCount: 0, l5SampleCount: 5, l5Average: 6.4, l5Values: [6,7,5,8,6],
      l5OverHitRate: 0.8, l5UnderHitRate: 0.2, l5PushCount: 0, l5OverCount: 4, l5UnderCount: 1,
      l10SampleCount: 10, l10Average: 6.0, l10Values: [6,7,5,8,6,5,7,6,4,6], l10OverHitRate: 0.7,
      l10UnderHitRate: 0.3, l10PushCount: 0, l10OverCount: 7, l10UnderCount: 3,
      seasonSampleCount: 20, seasonAverage: 5.9, seasonOverHitRate: 0.65, seasonUnderHitRate: 0.35,
      seasonPushCount: 0, seasonOverCount: 13, seasonUnderCount: 7,
      recentGameLogs: [
        { eventId: 'g1', gameDate: '2026-09-01T00:00:00.000Z', opponent: 'X', statValue: 6, statName: 'Strikeouts', rawStats: {} },
        { eventId: 'g2', gameDate: '2026-08-27T00:00:00.000Z', opponent: 'Y', statValue: 7, statName: 'Strikeouts', rawStats: {} },
      ],
      calculationVerified: true, retrievedAt: '2026-09-03T05:56:00.000Z', cacheStatus: 'HIT',
    },
    probabilityAnalysis: {
      isAvailable: true, modelVersion: 'APEX_BASELINE_V1', calculatedAt: '2026-09-03T05:57:00.000Z',
      components: { sampleReliabilityTier: 'STRONG' },
      marketImplied: { noVigOverProbability: 0.49, noVigUnderProbability: 0.51 },
      pointInTimeAudit: { featureSnapshotVersion: 'APEX_FEATURE_SNAPSHOT_V1', featureSnapshotId: 'FS-good', asOf: '2026-09-03T05:57:00.000Z', isValid: true, reasonCodes: [], latestObservedAt: '2026-09-03T05:56:00.000Z', featureCount: 11 },
    },
  };
}

function fakeSnapshot(index: number, leaked = false): any {
  const day = String(index + 1).padStart(2, '0');
  const start = `2026-01-${day}T20:00:00.000Z`;
  const created = `2026-01-${day}T10:00:00.000Z`;
  return {
    snapshotId: `s${index}`,
    snapshotType: 'REAL_PREGAME', historicalEligibility: 'ELIGIBLE', pointInTimeValid: true, featureSnapshotId: `FS-s${index}`,
    eventStartTime: start, snapshotCreatedAt: created,
    sportsbookQuoteTimestamp: leaked ? `2026-01-${day}T21:00:00.000Z` : `2026-01-${day}T09:55:00.000Z`,
    statisticsCutoffTimestamp: `2026-01-${day}T09:50:00.000Z`,
  };
}

export function runMlEngineV2VerificationSuite(): { allPassed: boolean; passed: number; total: number; tests: VerificationCase[] } {
  const tests: VerificationCase[] = [];
  const push = (testName: string, ok: boolean, details: string) => tests.push({ testName, status: ok ? 'PASS' : 'FAIL', details });
  const asOf = new Date('2026-09-03T06:00:00.000Z');

  const valid = buildPointInTimeFeatureSnapshot(makeQuote(), asOf);
  push('Point-in-time feature snapshot accepts fully historical inputs', valid.isValid && valid.featureCount >= 8, `valid=${valid.isValid}; features=${valid.featureCount}; reasons=${valid.reasonCodes.join('|')}`);

  const futureStatsQuote = makeQuote();
  futureStatsQuote.historicalStats.retrievedAt = '2026-09-03T06:05:00.000Z';
  const futureStats = buildPointInTimeFeatureSnapshot(futureStatsQuote, asOf);
  push('Future-dated stats are rejected', !futureStats.isValid && futureStats.reasonCodes.some((r) => r.startsWith('FUTURE_OBSERVATION:stats.')), futureStats.reasonCodes.join('|'));

  const futureGameQuote = makeQuote();
  futureGameQuote.historicalStats.recentGameLogs.push({ eventId: 'future-game', gameDate: '2026-09-04T00:00:00.000Z', opponent: 'Z', statValue: 9, statName: 'Strikeouts', rawStats: {} });
  const futureGame = buildPointInTimeFeatureSnapshot(futureGameQuote, asOf);
  push('Future game logs are rejected', !futureGame.isValid && futureGame.reasonCodes.includes('FUTURE_GAME_LOG:future-game'), futureGame.reasonCodes.join('|'));

  const snaps = Array.from({ length: 31 }, (_, i) => fakeSnapshot(i));
  // January only has 31 days; use a leaked duplicate that is rejected rather than extending dates.
  const leaked = fakeSnapshot(30, true); leaked.snapshotId = 'leaked';
  const plan = buildWalkForwardPlan([...snaps, leaked], 20, 5);
  push('Walk-forward folds are chronological and reject leaked snapshots', plan.allLeakageFree && plan.folds.length > 0 && plan.rejectedSnapshotIds.includes('leaked'), `folds=${plan.folds.length}; rejected=${plan.rejectedSnapshotIds.join(',')}`);

  const observations: CalibrationObservation[] = [];
  const probs = [0.1,0.2,0.3,0.4,0.6,0.7,0.8,0.9];
  for (let i = 0; i < 320; i++) {
    const p = probs[i % probs.length];
    const trueP = 0.5 + (p - 0.5) * 0.55; // deliberately overconfident raw predictions
    const u = ((i * 73) % 997) / 997;
    observations.push({ snapshotId: `c${i}`, eventStartTime: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(), gradingTimestamp: new Date(Date.UTC(2025, 0, 2 + i)).toISOString(), probability: p, label: u < trueP ? 1 : 0 });
  }
  const model = fitPlattModel(observations);
  const rawMetrics = calculateCalibrationMetrics(observations);
  const calMetrics = calculateCalibrationMetrics(observations, (p) => applyPlatt(model, p));
  push('Platt calibration improves deliberately overconfident probabilities', calMetrics.logLoss < rawMetrics.logLoss && calMetrics.brier < rawMetrics.brier, `rawLL=${rawMetrics.logLoss.toFixed(5)} calLL=${calMetrics.logLoss.toFixed(5)} rawBrier=${rawMetrics.brier.toFixed(5)} calBrier=${calMetrics.brier.toFixed(5)}`);

  const calibrationSnapshots: any[] = [];
  for (let i = 0; i < 80; i++) {
    const p = probs[i % probs.length];
    const trueP = 0.5 + (p - 0.5) * 0.55;
    const u = ((i * 73) % 997) / 997;
    const overWon = u < trueP;
    const eventStart = new Date(Date.UTC(2025, 0, 1 + i, 20)).toISOString();
    const created = new Date(Date.UTC(2025, 0, 1 + i, 10)).toISOString();
    const graded = new Date(Date.UTC(2025, 0, 2 + i, 1)).toISOString();
    calibrationSnapshots.push({
      snapshotId: `svc-${i}`, snapshotType: 'REAL_PREGAME', historicalEligibility: 'ELIGIBLE', gradingStatus: 'GRADED',
      pointInTimeValid: true, featureSnapshotId: `FS-svc-${i}`, sport: 'MLB', market: 'pitcher_strikeouts', modelVersion: 'APEX_BASELINE_V1',
      eventStartTime: eventStart, snapshotCreatedAt: created, sportsbookQuoteTimestamp: new Date(Date.UTC(2025,0,1+i,9,55)).toISOString(),
      statisticsCutoffTimestamp: new Date(Date.UTC(2025,0,1+i,9,50)).toISOString(), gradingTimestamp: graded,
      line: 5.5, actualStatistic: overWon ? 6 : 5, overRawProbability: p, underRawProbability: 1-p,
      overApexProbability: p, underApexProbability: 1-p,
    });
  }
  // Make one otherwise-valid snapshot unavailable at prediction time by grading it in the future.
  calibrationSnapshots[79].gradingTimestamp = '2027-01-01T00:00:00.000Z';
  const serviceCalibration = probabilityCalibrationService.calibratePairFromSnapshots({
    sport: 'MLB', market: 'pitcher_strikeouts', modelVersion: 'APEX_BASELINE_V1', rawOverProbability: 0.8, rawUnderProbability: 0.2,
    pushProbability: 0, asOf: new Date('2026-01-01T00:00:00.000Z'),
  }, calibrationSnapshots as any);
  push('Calibration service excludes outcomes not known before prediction time', serviceCalibration.info.trainingSnapshots + serviceCalibration.info.validationSnapshots === 79 && serviceCalibration.status !== 'INSUFFICIENT_EVIDENCE', `status=${serviceCalibration.status}; train=${serviceCalibration.info.trainingSnapshots}; validation=${serviceCalibration.info.validationSnapshots}; rawLL=${serviceCalibration.info.rawValidationLogLoss}; calLL=${serviceCalibration.info.calibratedValidationLogLoss}`);

  const noPit = makeQuote();
  noPit.probabilityAnalysis.pointInTimeAudit.isValid = false;
  const gate = evaluateRecommendationGate({
    quote: noPit, probability: 0.60, modelEdge: 0.08, expectedValue: 0.15, expectedValuePercent: 15,
    reliabilityTier: 'STRONG', thresholds: { minReliabilityTier: 'MODERATE', minModelEdge: 0.03, minEVPercent: 3, positiveEVRequired: true, maxQuoteAgeMs: 10 * 60 * 1000 }, now: asOf,
  });
  push('Central recommendation gate blocks point-in-time-invalid predictions', !gate.qualifies && gate.reasonCodes.includes('POINT_IN_TIME_INVALID'), gate.reasonCodes.join('|'));

  const passed = tests.filter((t) => t.status === 'PASS').length;
  return { allPassed: passed === tests.length, passed, total: tests.length, tests };
}

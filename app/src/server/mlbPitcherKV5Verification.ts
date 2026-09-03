import { DurableHistoricalPropSnapshot, MlbPitcherKFeatureVectorV3, MlbPitcherKNegativeBinomialResult } from '../types';
import { aggregateCountScores, countScoreRowFromNegativeBinomial, scoreNegativeBinomialCount } from './mlbPitcherKCountScoringService';
import { buildMlbPitcherKFastLearningEvidence } from './mlbPitcherKFastLearningService';
import { MlbPitcherKBoostedTrainingRow, trainMlbPitcherKBoostedForVerification } from './mlbPitcherKBoostedShadowService';
import { marketQuotaGuard } from './marketQuotaGuard';
import { MlbPitcherKStarterShadowRepository } from './mlbPitcherKStarterShadowRepository';
import fs from 'fs';

function feature(id: string, at: string, line: number, rate = 0.25): MlbPitcherKFeatureVectorV3 {
  return {
    featureVersion: 'APEX_MLB_K_FEATURES_V3', featureVectorId: id, asOf: at, latestFeatureObservedAt: at,
    isPointInTimeValid: true, reasonCodes: [], dataQuality: 'CORE_VERIFIED', sampleStarts: 20, workloadStarts: 20,
    officialBattersFacedStarts: 20, derivedBattersFacedStarts: 0, workloadSource: 'OFFICIAL_BF', expectedBattersFaced: 24,
    expectedInnings: 6, seasonStrikeoutsPerBF: rate, l10StrikeoutsPerBF: rate, l5StrikeoutsPerBF: rate,
    workloadTrendBF: 0, strikeoutMean: 6, strikeoutVariance: 7, opponentStrikeoutRate: 0.23,
    pitcherTeamVenueRole: 'HOME', pitcherHandedness: 'R', recentSwStrRate: null, recentCswRate: null,
    averageFastballVelocityMph: null, velocityDeltaMph: null, dominantPitchShare: null, daysRest: 5,
    temperatureF: null, windMph: null, parkFactor: null, umpireStrikeoutFactor: null, line,
  };
}

function snapshot(start: number, line: number, high: boolean): DurableHistoricalPropSnapshot {
  const eventStart = new Date(Date.UTC(2026, 5, 1 + start, 20));
  const quoteAt = new Date(eventStart.getTime() - 3 * 3600000);
  const actual = high ? 9 : 3;
  const challengerOver = high ? 0.82 : 0.18;
  const f = feature(`V5-${start}-${line}`, quoteAt.toISOString(), line, high ? 0.32 : 0.18);
  return {
    snapshotId: `v5-${start}-${line}`, snapshotType: 'REAL_PREGAME', dedupFingerprint: `fp-${start}-${line}`,
    eventId: `event-${start}`, providerEventId: `event-${start}`, eventStartTime: eventStart.toISOString(),
    snapshotCreatedAt: quoteAt.toISOString(), sportsbookQuoteTimestamp: quoteAt.toISOString(), statisticsCutoffTimestamp: quoteAt.toISOString(),
    playerId: `pitcher-${start}`, playerName: `Pitcher ${start}`, team: 'AAA', opponent: 'BBB', sport: 'MLB', league: 'MLB',
    market: 'pitcher_strikeouts', line, side: 'OVER', sportsbook: 'TestBook', americanOdds: -110, decimalOdds: 1.909,
    overOddsAmerican: -110, underOddsAmerican: -110, modelVersion: 'APEX_BASELINE_V1', valueEngineVersion: 'APEX_VALUE_V1',
    apexProbability: 0.5, overApexProbability: 0.5, underApexProbability: 0.5, breakEvenProbability: 0.5238,
    modelEdge: -0.0238, expectedValue: -0.0455, reliabilityTier: 'STRONG', recommendation: 'NO_BET', reasonCodes: ['EDGE_BELOW_THRESHOLD'],
    verificationState: 'VERIFIED', historicalEligibility: 'ELIGIBLE', gradingStatus: 'GRADED', actualStatistic: actual,
    gradedSideOutcome: high ? 'WIN' : 'LOSS', gradingTimestamp: new Date(eventStart.getTime() + 4 * 3600000).toISOString(),
    pointInTimeValid: true,
    mlbPitcherKV3: {
      featureVector: f,
      negativeBinomialOverProbability: challengerOver,
      negativeBinomialUnderProbability: 1 - challengerOver,
      negativeBinomialPushProbability: 0,
      boostedConditionalOverProbability: challengerOver,
      shadowOverProbability: challengerOver,
      shadowUnderProbability: 1 - challengerOver,
      shadowPushProbability: 0,
      productionPushProbability: 0,
    },
    modelInputs: { seasonMean: 6, seasonHitRate: 0.5, seasonSampleCount: 20, l10Mean: 6, l10HitRate: 0.5, l10SampleCount: 10, sampleReliabilityTier: 'STRONG', marketNoVigOver: 0.5, marketNoVigUnder: 0.5, isMarketBlended: true },
  } as DurableHistoricalPropSnapshot;
}

function boostedRows(clusters: number): MlbPitcherKBoostedTrainingRow[] {
  const out: MlbPitcherKBoostedTrainingRow[] = [];
  for (let i = 0; i < clusters; i++) {
    const high = i % 2 === 0;
    const at = new Date(Date.UTC(2025, 0, 1 + i)).toISOString();
    for (const line of [5.5, 6.5, 7.5]) {
      out.push({
        at, y: high ? 1 : 0, baseProbability: 0.5, features: feature(`BOOST-${i}-${line}`, at, line, high ? 0.34 : 0.17),
        weight: 1 / 3, clusterId: `START-${i}`,
      });
    }
  }
  return out;
}

export function runMlbPitcherKV5VerificationSuite() {
  const initialQuota = marketQuotaGuard.getQuotaState().dailyUsed;
  const tests: Array<{ name: string; passed: boolean; details: string }> = [];

  const near = scoreNegativeBinomialCount({ actualStrikeouts: 6, expectedStrikeouts: 6, dispersionR: 10 });
  const far = scoreNegativeBinomialCount({ actualStrikeouts: 15, expectedStrikeouts: 6, dispersionR: 10 });
  tests.push({ name: 'Exact-count NLL rewards plausible outcomes', passed: !!near && !!far && near.negativeLogLikelihood < far.negativeLogLikelihood, details: `near=${near?.negativeLogLikelihood}; far=${far?.negativeLogLikelihood}` });

  const nb: MlbPitcherKNegativeBinomialResult = { modelVersion: 'APEX_MLB_K_NB_V3', isAvailable: true, reason: null, expectedStrikeouts: 6, dispersionR: 10, predictiveVariance: 9.6, overProbability: 0.5, underProbability: 0.5, pushProbability: 0 };
  const countRows = [5, 6, 7].map((actual) => countScoreRowFromNegativeBinomial(actual, nb)!).filter(Boolean);
  const countMetrics = aggregateCountScores(countRows);
  tests.push({ name: 'Full-count aggregate exposes NLL/CRPS/MAE/RMSE', passed: countMetrics.observations === 3 && countMetrics.meanCrps !== null && countMetrics.rootMeanSquaredError !== null, details: JSON.stringify(countMetrics) });

  const snapshots: DurableHistoricalPropSnapshot[] = [];
  for (let i = 0; i < 30; i++) for (const line of [5.5, 6.5, 7.5]) snapshots.push(snapshot(i, line, i % 2 === 0));
  const evidence = buildMlbPitcherKFastLearningEvidence(snapshots, new Date('2027-01-01T00:00:00Z'));
  tests.push({ name: 'Multiple legitimate lines count as one independent pitcher start', passed: evidence.prospective.independentStarts === 30 && evidence.prospective.evaluatedLineThresholds === 90, details: `starts=${evidence.prospective.independentStarts}; thresholds=${evidence.prospective.evaluatedLineThresholds}` });
  tests.push({ name: 'Sequential paired evidence surfaces early challenger superiority', passed: evidence.prospective.paired.evidenceTier === 'DEVELOPING_SIGNAL' && (evidence.prospective.paired.probabilityChallengerBetter ?? 0) > 0.95, details: evidence.prospective.paired.interpretation });

  const insufficient = trainMlbPitcherKBoostedForVerification(boostedRows(79), feature('CURRENT', '2026-12-31T12:00:00Z', 6.5, 0.34), 0.5);
  tests.push({ name: 'Three lines per start cannot fake the 80-start booster threshold', passed: insufficient.status === 'INSUFFICIENT_EVIDENCE' && insufficient.validation.trainingRows === 79, details: `${insufficient.status}; effective=${insufficient.validation.trainingRows}` });

  const trained = trainMlbPitcherKBoostedForVerification(boostedRows(120), feature('CURRENT2', '2026-12-31T12:00:00Z', 6.5, 0.34), 0.5);
  tests.push({ name: 'Cluster-weighted multi-line booster can activate with enough independent starts', passed: trained.status === 'ACTIVE_SHADOW' && trained.validation.trainingRows === 90 && trained.validation.validationRows === 30, details: `${trained.status}; train=${trained.validation.trainingRows}; val=${trained.validation.validationRows}` });

  tests.push({ name: 'Historical replay remains non-promotional research evidence', passed: evidence.historicalReplay.note.includes('cannot satisfy prospective promotion'), details: evidence.historicalReplay.note });
  tests.push({ name: 'All-starter shadow evidence is separated from sportsbook prop evidence', passed: evidence.allStarterShadow.totalForecasts >= evidence.allStarterShadow.gradedForecasts && evidence.learningSample.prospectiveIndependentStarts === 30, details: `starter=${evidence.allStarterShadow.totalForecasts}; prospective=${evidence.learningSample.prospectiveIndependentStarts}` });

  const tempRepoPath = `/tmp/apex-v5-starter-${process.pid}.json`;
  try { fs.unlinkSync(tempRepoPath); } catch {}
  const starterRepo = new MlbPitcherKStarterShadowRepository(tempRepoPath);
  const baseStarter: any = { forecastId: 'immutable-1', forecastVersion: 'APEX_MLB_K_ALL_STARTERS_V1', eventId: 'game', eventStartTime: '2026-07-01T20:00:00Z', season: 2026, pitcherId: 1, pitcherName: 'Pitcher', team: 'A', opponent: 'B', teamVenueRole: 'HOME', capturedAt: '2026-07-01T15:00:00Z', featureVector: feature('IMM-1', '2026-07-01T15:00:00Z', 5.5), negativeBinomial: nb, gradingStatus: 'PENDING', actualStrikeouts: null, gradedAt: null, gradingSource: null, rejectionReason: null };
  starterRepo.upsertMany([baseStarter]);
  starterRepo.upsertMany([{ ...baseStarter, capturedAt: '2026-07-01T18:00:00Z', featureVector: feature('IMM-2', '2026-07-01T18:00:00Z', 5.5) }]);
  starterRepo.upsertMany([{ ...baseStarter, gradingStatus: 'GRADED', actualStrikeouts: 7, gradedAt: '2026-07-02T01:00:00Z', gradingSource: 'MLB_STATS_API_BOXSCORE' }]);
  const immutable = starterRepo.getAll()[0];
  tests.push({ name: 'First valid all-starter forecast is immutable across refreshes and only grading appends outcome', passed: immutable?.capturedAt === baseStarter.capturedAt && immutable?.featureVector?.featureVectorId === 'IMM-1' && immutable?.actualStrikeouts === 7 && immutable?.gradingStatus === 'GRADED', details: `captured=${immutable?.capturedAt}; feature=${immutable?.featureVector?.featureVectorId}; actual=${immutable?.actualStrikeouts}` });
  try { fs.unlinkSync(tempRepoPath); } catch {}

  const finalQuota = marketQuotaGuard.getQuotaState().dailyUsed;
  tests.push({ name: 'V5 verification consumes zero keyed Odds API requests', passed: finalQuota === initialQuota, details: `initial=${initialQuota}; final=${finalQuota}; consumed=${finalQuota - initialQuota}` });

  return {
    suite: 'APEX MLB PITCHER K V5 FAST LEARNING',
    version: 'APEX_MLB_K_FAST_LEARNING_V1',
    totalTests: tests.length,
    passedTests: tests.filter((t) => t.passed).length,
    failedTests: tests.filter((t) => !t.passed).length,
    allPassed: tests.every((t) => t.passed),
    keyedRequestsConsumed: finalQuota - initialQuota,
    tests,
    generatedAt: new Date().toISOString(),
  };
}

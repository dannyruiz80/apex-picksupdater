import { buildPredictionContractV1 } from './predictionContract';
import { evaluateRecommendationGate } from './recommendationGate';

const now = new Date('2026-09-03T06:00:00.000Z');

function makeQuote(overrides: Record<string, unknown> = {}): any {
  return {
    quoteId: 'q1', apexEventId: 'event1', providerEventId: 'provider1', sport: 'MLB', league: 'MLB',
    playerId: 'player1', playerDisplayName: 'Verified Player', verifiedTeam: 'A', verifiedOpponent: 'B',
    marketCategory: 'Strikeouts', providerMarketKey: 'pitcher_strikeouts', line: 5.5,
    bookmakerKey: 'book', bookmakerTitle: 'Book', overOddsAmerican: 110, overOddsDecimal: 2.1,
    underOddsAmerican: -120, underOddsDecimal: 1.8333, marketVerified: true, rosterVerified: true,
    rosterSource: 'Official Roster', marketSource: 'Odds Provider', providerTimestamp: '2026-09-03T05:55:00.000Z',
    retrievedAt: '2026-09-03T05:56:00.000Z', cacheStatus: 'HIT', eventStatus: 'UPCOMING',
    eventStartTime: '2026-09-03T08:00:00.000Z', historicalStats: { validGamesUsed: 20, calculationVerified: true, source: 'Official Logs' },
    probabilityAnalysis: { isAvailable: true, modelVersion: 'APEX_BASELINE_V1', calculatedAt: '2026-09-03T05:56:30.000Z', components: { sampleReliabilityTier: 'STRONG' }, marketImplied: { noVigOverProbability: 0.49, noVigUnderProbability: 0.51 }, pointInTimeAudit: { featureSnapshotVersion: 'APEX_FEATURE_SNAPSHOT_V1', featureSnapshotId: 'FS-test', asOf: '2026-09-03T05:56:30.000Z', isValid: true, reasonCodes: [], latestObservedAt: '2026-09-03T05:56:00.000Z', featureCount: 8 } },
    ...overrides,
  };
}

const thresholds = { minReliabilityTier: 'MODERATE' as const, minModelEdge: 0.03, minEVPercent: 3, positiveEVRequired: true, maxQuoteAgeMs: 10 * 60 * 1000 };

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }

const healthy = makeQuote();
const pass = evaluateRecommendationGate({ quote: healthy, probability: 0.60, modelEdge: 0.11, expectedValue: 0.26, expectedValuePercent: 26, reliabilityTier: 'STRONG', thresholds, now });
assert(pass.qualifies, `healthy quote should qualify: ${pass.reasonCodes.join(',')}`);

const stale = evaluateRecommendationGate({ quote: makeQuote({ providerTimestamp: '2026-09-03T05:30:00.000Z', retrievedAt: '2026-09-03T05:59:59.000Z' }), probability: 0.60, modelEdge: 0.11, expectedValue: 0.26, expectedValuePercent: 26, reliabilityTier: 'STRONG', thresholds, now });
assert(!stale.qualifies && stale.reasonCodes.includes('STALE_PRICE'), 'stale provider quote must fail even if retrieval is fresh');

const live = evaluateRecommendationGate({ quote: makeQuote({ eventStatus: 'LIVE' }), probability: 0.60, modelEdge: 0.11, expectedValue: 0.26, expectedValuePercent: 26, reliabilityTier: 'STRONG', thresholds, now });
assert(!live.qualifies && live.reasonCodes.includes('EVENT_NOT_PREGAME'), 'live event must fail');

const badProv = evaluateRecommendationGate({ quote: makeQuote({ marketSource: '' }), probability: 0.60, modelEdge: 0.11, expectedValue: 0.26, expectedValuePercent: 26, reliabilityTier: 'STRONG', thresholds, now });
assert(!badProv.qualifies && badProv.reasonCodes.includes('PROVENANCE_INCOMPLETE'), 'missing provenance must fail');

const badProb = evaluateRecommendationGate({ quote: healthy, probability: 1.2, modelEdge: 0.71, expectedValue: 1.5, expectedValuePercent: 150, reliabilityTier: 'STRONG', thresholds, now });
assert(!badProb.qualifies && badProb.reasonCodes.includes('INVALID_PROBABILITY'), 'invalid probability must fail');

const contract = buildPredictionContractV1({ quote: healthy, side: 'OVER', oddsAmerican: 110, oddsDecimal: 2.1, probability: 0.60, marketNoVigProbability: 0.49, pushProbability: 0, modelEdge: 0.11, expectedValue: 0.26, expectedValuePercent: 26, decision: 'QUALIFIES', reasonCodes: [], quoteFresh: true, pregameEligible: true, now });
assert(contract.contractVersion === 'APEX_PREDICTION_CONTRACT_V1', 'contract version mismatch');
assert(contract.predictionId.startsWith('APX-'), 'prediction id missing');
assert(contract.calibratedProbability === null, 'uncalibrated model must not claim calibrated probability');
assert(Object.isFrozen(contract), 'prediction contract must be immutable');

console.log('Prediction Contract V1 / Central Recommendation Gate: 6/6 PASS');

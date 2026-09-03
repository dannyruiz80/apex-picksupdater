import { NormalizedPlayerPropQuote, ReasonCode, SampleReliabilityTier } from '../types';
import { isProbability } from './predictionContract';

export interface RecommendationGateThresholds {
  minReliabilityTier: SampleReliabilityTier;
  minModelEdge: number;
  minEVPercent: number;
  positiveEVRequired: boolean;
  maxQuoteAgeMs: number;
}

export interface RecommendationGateInput {
  quote: NormalizedPlayerPropQuote;
  probability: number | null;
  modelEdge: number | null;
  expectedValue: number | null;
  expectedValuePercent: number | null;
  reliabilityTier: SampleReliabilityTier | null;
  thresholds: RecommendationGateThresholds;
  now?: Date;
}

export interface RecommendationGateResult {
  qualifies: boolean;
  reasonCodes: ReasonCode[];
  checks: {
    marketVerified: boolean;
    playerVerified: boolean;
    statsVerified: boolean;
    modelAvailable: boolean;
    probabilityValid: boolean;
    provenanceComplete: boolean;
    quoteFresh: boolean;
    pregameEligible: boolean;
    pointInTimeValid: boolean;
    minReliabilityMet: boolean;
    minEdgeMet: boolean;
    minEVMet: boolean;
    positiveEVMet: boolean;
  };
}

const RELIABILITY_RANK: Record<SampleReliabilityTier, number> = {
  VERY_LIMITED: 0,
  LIMITED: 1,
  MODERATE: 2,
  STRONG: 3,
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function evaluateRecommendationGate(input: RecommendationGateInput): RecommendationGateResult {
  const now = input.now ?? new Date();
  const quote = input.quote;
  const reasonCodes: ReasonCode[] = [];

  const marketVerified = quote.marketVerified === true;
  const playerVerified = quote.rosterVerified === true && Boolean(quote.playerId);
  const statsVerified = Boolean(
    quote.historicalStats &&
    quote.historicalStats.validGamesUsed > 0 &&
    quote.historicalStats.calculationVerified
  );
  const modelAvailable = Boolean(quote.probabilityAnalysis?.isAvailable && input.probability !== null);
  const probabilityValid = isProbability(input.probability);
  const provenanceComplete = Boolean(
    quote.marketSource &&
    quote.rosterSource &&
    quote.providerTimestamp &&
    quote.retrievedAt &&
    quote.probabilityAnalysis?.modelVersion &&
    quote.probabilityAnalysis?.calculatedAt
  );

  const providerMs = parseTime(quote.providerTimestamp);
  // Price freshness is anchored to the provider observation time. A fresh server retrieval
  // must never make an old sportsbook quote look current.
  const quoteFresh = providerMs !== null && now.getTime() - providerMs <= input.thresholds.maxQuoteAgeMs;

  const startMs = parseTime(quote.eventStartTime);
  const normalizedStatus = (quote.eventStatus ?? 'UPCOMING').toUpperCase();
  const statusPregame = normalizedStatus === 'UPCOMING' || normalizedStatus === 'SCHEDULED' || normalizedStatus === 'PRE';
  const timePregame = startMs === null || now.getTime() < startMs;
  const pregameEligible = statusPregame && timePregame;
  const pointInTimeValid = quote.probabilityAnalysis?.pointInTimeAudit?.isValid === true;

  const reliabilityTier = input.reliabilityTier;
  const minReliabilityMet = Boolean(
    reliabilityTier && RELIABILITY_RANK[reliabilityTier] >= RELIABILITY_RANK[input.thresholds.minReliabilityTier]
  );
  const minEdgeMet = input.modelEdge !== null && Number.isFinite(input.modelEdge) && input.modelEdge >= input.thresholds.minModelEdge;
  const positiveEVMet = input.expectedValue !== null && Number.isFinite(input.expectedValue) && input.expectedValue > 0;
  const minEVMet = input.expectedValuePercent !== null && Number.isFinite(input.expectedValuePercent) && input.expectedValuePercent >= input.thresholds.minEVPercent;

  if (!marketVerified) reasonCodes.push('MARKET_UNVERIFIED');
  if (!playerVerified) reasonCodes.push('PLAYER_UNVERIFIED');
  if (!statsVerified) reasonCodes.push('STATS_UNAVAILABLE');
  if (!modelAvailable) reasonCodes.push('MODEL_UNAVAILABLE');
  if (!probabilityValid) reasonCodes.push('INVALID_PROBABILITY');
  if (!provenanceComplete) reasonCodes.push('PROVENANCE_INCOMPLETE');
  if (!quoteFresh) reasonCodes.push('STALE_PRICE');
  if (!pregameEligible) reasonCodes.push('EVENT_NOT_PREGAME');
  if (!pointInTimeValid) reasonCodes.push('POINT_IN_TIME_INVALID');
  if (!minReliabilityMet) reasonCodes.push('RELIABILITY_BELOW_MINIMUM');
  if (input.thresholds.positiveEVRequired && !positiveEVMet) reasonCodes.push('NEGATIVE_EV');
  if (positiveEVMet && !minEVMet) reasonCodes.push('EV_BELOW_THRESHOLD');
  if (!minEdgeMet) reasonCodes.push('EDGE_BELOW_THRESHOLD');

  return {
    qualifies: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)],
    checks: {
      marketVerified,
      playerVerified,
      statsVerified,
      modelAvailable,
      probabilityValid,
      provenanceComplete,
      quoteFresh,
      pregameEligible,
      pointInTimeValid,
      minReliabilityMet,
      minEdgeMet,
      minEVMet,
      positiveEVMet,
    },
  };
}

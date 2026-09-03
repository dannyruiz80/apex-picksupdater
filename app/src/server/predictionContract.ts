import { ApexSport, NormalizedPlayerPropQuote } from '../types';

export type PredictionSide = 'OVER' | 'UNDER';
export type PredictionDecision = 'QUALIFIES' | 'NO_BET';

export interface PredictionProvenanceV1 {
  marketSource: string;
  rosterSource: string;
  statsSource: string | null;
  providerTimestamp: string;
  retrievedAt: string;
  modelCalculatedAt: string | null;
}

export interface PredictionContractV1 {
  contractVersion: 'APEX_PREDICTION_CONTRACT_V1';
  predictionId: string;
  predictionAsOf: string;
  apexEventId: string;
  providerEventId: string;
  sport: ApexSport;
  league: string;
  eventStatus: string | null;
  eventStartTime: string | null;
  playerId: string | null;
  playerDisplayName: string;
  verifiedTeam: string;
  verifiedOpponent: string;
  marketCategory: string;
  providerMarketKey: string;
  side: PredictionSide;
  line: number;
  sportsbook: string;
  oddsAmerican: number;
  oddsDecimal: number;
  modelVersion: string | null;
  rawProbability: number | null;
  calibratedProbability: number | null;
  calibrationStatus: string | null;
  calibrationVersion: string | null;
  featureSnapshotId: string | null;
  featureSnapshotVersion: string | null;
  featureAsOf: string | null;
  marketNoVigProbability: number | null;
  pushProbability: number;
  modelEdge: number | null;
  expectedValue: number | null;
  expectedValuePercent: number | null;
  reliabilityTier: string | null;
  decision: PredictionDecision;
  reasonCodes: string[];
  provenance: PredictionProvenanceV1;
  integrity: {
    marketVerified: boolean;
    playerVerified: boolean;
    statsVerified: boolean;
    modelAvailable: boolean;
    probabilityValid: boolean;
    provenanceComplete: boolean;
    quoteFresh: boolean;
    pregameEligible: boolean;
    pointInTimeValid: boolean;
  };
}

export interface BuildPredictionContractInput {
  quote: NormalizedPlayerPropQuote;
  side: PredictionSide;
  oddsAmerican: number;
  oddsDecimal: number;
  probability: number | null;
  marketNoVigProbability: number | null;
  pushProbability: number;
  modelEdge: number | null;
  expectedValue: number | null;
  expectedValuePercent: number | null;
  decision: PredictionDecision;
  reasonCodes: string[];
  quoteFresh: boolean;
  pregameEligible: boolean;
  now?: Date;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isProbability(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function buildPredictionContractV1(input: BuildPredictionContractInput): PredictionContractV1 {
  const { quote, side } = input;
  const now = input.now ?? new Date();
  const model = quote.probabilityAnalysis;
  const stats = quote.historicalStats;
  const probabilityValid = isProbability(input.probability);
  const modelAvailable = Boolean(model?.isAvailable && probabilityValid);
  const statsVerified = Boolean(stats && stats.validGamesUsed > 0 && stats.calculationVerified);
  const provenanceComplete = Boolean(
    quote.marketSource &&
    quote.rosterSource &&
    quote.providerTimestamp &&
    quote.retrievedAt &&
    model?.modelVersion &&
    model?.calculatedAt &&
    model?.pointInTimeAudit?.isValid !== false
  );

  const identity = [
    quote.apexEventId,
    quote.providerEventId,
    quote.playerId ?? quote.playerDisplayName,
    quote.providerMarketKey,
    side,
    quote.line,
    quote.bookmakerKey,
    input.oddsAmerican,
    model?.modelVersion ?? 'MODEL_UNAVAILABLE',
    model?.calculatedAt ?? quote.retrievedAt,
  ].join('|');

  const noVig = side === 'OVER'
    ? model?.marketImplied?.noVigOverProbability ?? input.marketNoVigProbability
    : model?.marketImplied?.noVigUnderProbability ?? input.marketNoVigProbability;

  return Object.freeze({
    contractVersion: 'APEX_PREDICTION_CONTRACT_V1',
    predictionId: `APX-${stableHash(identity)}`,
    predictionAsOf: now.toISOString(),
    apexEventId: quote.apexEventId,
    providerEventId: quote.providerEventId,
    sport: quote.sport,
    league: quote.league,
    eventStatus: quote.eventStatus ?? null,
    eventStartTime: quote.eventStartTime ?? null,
    playerId: quote.playerId,
    playerDisplayName: quote.playerDisplayName,
    verifiedTeam: quote.verifiedTeam,
    verifiedOpponent: quote.verifiedOpponent,
    marketCategory: quote.marketCategory,
    providerMarketKey: quote.providerMarketKey,
    side,
    line: quote.line,
    sportsbook: quote.bookmakerTitle || quote.bookmakerKey,
    oddsAmerican: input.oddsAmerican,
    oddsDecimal: input.oddsDecimal,
    modelVersion: model?.modelVersion ?? null,
    rawProbability: side === 'OVER'
      ? model?.rawOverProbability ?? input.probability
      : model?.rawUnderProbability ?? input.probability,
    calibratedProbability: side === 'OVER'
      ? model?.calibratedOverProbability ?? null
      : model?.calibratedUnderProbability ?? null,
    calibrationStatus: model?.calibration?.status ?? null,
    calibrationVersion: model?.calibration?.calibrationVersion ?? null,
    featureSnapshotId: model?.pointInTimeAudit?.featureSnapshotId ?? null,
    featureSnapshotVersion: model?.pointInTimeAudit?.featureSnapshotVersion ?? null,
    featureAsOf: model?.pointInTimeAudit?.asOf ?? null,
    marketNoVigProbability: noVig ?? null,
    pushProbability: input.pushProbability,
    modelEdge: input.modelEdge,
    expectedValue: input.expectedValue,
    expectedValuePercent: input.expectedValuePercent,
    reliabilityTier: model?.components?.sampleReliabilityTier ?? null,
    decision: input.decision,
    reasonCodes: [...input.reasonCodes],
    provenance: {
      marketSource: quote.marketSource,
      rosterSource: quote.rosterSource,
      statsSource: stats?.source ?? null,
      providerTimestamp: quote.providerTimestamp,
      retrievedAt: quote.retrievedAt,
      modelCalculatedAt: model?.calculatedAt ?? null,
    },
    integrity: {
      marketVerified: quote.marketVerified,
      playerVerified: quote.rosterVerified && Boolean(quote.playerId),
      statsVerified,
      modelAvailable,
      probabilityValid,
      provenanceComplete,
      quoteFresh: input.quoteFresh,
      pregameEligible: input.pregameEligible,
      pointInTimeValid: model?.pointInTimeAudit?.isValid ?? false,
    },
  });
}

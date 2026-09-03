import crypto from 'crypto';
import { NormalizedPlayerPropQuote } from '../types';

export interface MlbPitcherKMonteCarloResult {
  simulationVersion: 'APEX_MLB_K_MONTE_CARLO_V1';
  trials: 10000;
  seed: string;
  playerId: string | null;
  playerName: string;
  team: string;
  opponent: string;
  line: number;
  sportsbook: string;
  productionDecision: 'QUALIFIES' | 'NO_BET';
  productionSide: 'OVER' | 'UNDER' | null;
  productionProbability: number | null;
  productionEVPercent: number | null;
  productionEdgePp: number | null;
  oddsAmerican: number | null;
  reliabilityTier: string | null;
  shadowModelVersion: string | null;
  v3DataQuality: string | null;
  expectedStrikeouts: number | null;
  simulatedMeanStrikeouts: number | null;
  simulatedMedianStrikeouts: number | null;
  simulatedP10Strikeouts: number | null;
  simulatedP90Strikeouts: number | null;
  overProbability: number | null;
  underProbability: number | null;
  pushProbability: number | null;
  simulationSupportsProduction: boolean | null;
  status: 'SIMULATED' | 'UNAVAILABLE';
  reason: string | null;
}

function hashSeed(text: string): number {
  const digest = crypto.createHash('sha256').update(text).digest();
  const value = digest.readUInt32LE(0);
  return value === 0 ? 0x9e3779b9 : value;
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state + 0.5) / 4294967296;
  };
}

function buildNegativeBinomialCdf(mu: number, r: number): number[] {
  const variance = mu + (mu * mu) / r;
  const maxK = Math.max(40, Math.ceil(mu + 12 * Math.sqrt(variance)));
  const q = mu / (mu + r);
  let pk = Math.pow(r / (r + mu), r);
  const probs: number[] = [pk];
  for (let k = 0; k < maxK; k++) {
    pk = pk * q * ((k + r) / (k + 1));
    probs.push(pk);
  }
  const total = probs.reduce((a, b) => a + b, 0);
  let running = 0;
  return probs.map((p, index) => {
    running += p / total;
    return index === probs.length - 1 ? 1 : running;
  });
}

function sampleFromCdf(cdf: number[], u: number): number {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (u <= cdf[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

export function simulateMlbPitcherKQuote(
  quote: NormalizedPlayerPropQuote,
  trials = 10000
): MlbPitcherKMonteCarloResult {
  const recommendation = quote.valueAnalysis?.bestRecommendation ?? null;
  const selected = recommendation?.selectedAnalysis ?? null;
  const shadow = quote.probabilityAnalysis?.mlbPitcherKShadow ?? null;
  const nb = shadow?.negativeBinomial ?? null;
  const featureVector = shadow?.featureVector ?? null;

  const base: Omit<MlbPitcherKMonteCarloResult, 'status' | 'reason' | 'simulatedMeanStrikeouts' | 'simulatedMedianStrikeouts' | 'simulatedP10Strikeouts' | 'simulatedP90Strikeouts' | 'overProbability' | 'underProbability' | 'pushProbability' | 'simulationSupportsProduction'> = {
    simulationVersion: 'APEX_MLB_K_MONTE_CARLO_V1',
    trials: 10000,
    seed: featureVector?.featureVectorId ?? quote.quoteId,
    playerId: quote.playerId,
    playerName: quote.playerDisplayName,
    team: quote.verifiedTeam,
    opponent: quote.verifiedOpponent,
    line: quote.line,
    sportsbook: selected?.sportsbook ?? quote.bookmakerTitle,
    productionDecision: recommendation?.recommendationStatus ?? 'NO_BET',
    productionSide: recommendation?.side ?? null,
    productionProbability: selected?.apexProbability ?? null,
    productionEVPercent: selected?.expectedValuePercent ?? null,
    productionEdgePp: selected?.modelEdgePercentagePoints ?? null,
    oddsAmerican: selected?.oddsAmerican ?? null,
    reliabilityTier: quote.probabilityAnalysis?.components?.sampleReliabilityTier ?? null,
    shadowModelVersion: shadow?.shadowVersion ?? null,
    v3DataQuality: featureVector?.dataQuality ?? null,
    expectedStrikeouts: nb?.expectedStrikeouts ?? null,
  };

  if (
    quote.sport !== 'MLB' ||
    quote.providerMarketKey !== 'pitcher_strikeouts' ||
    !shadow ||
    !featureVector?.isPointInTimeValid ||
    !nb?.isAvailable ||
    nb.expectedStrikeouts === null ||
    nb.dispersionR === null ||
    nb.expectedStrikeouts <= 0 ||
    nb.dispersionR <= 0
  ) {
    return {
      ...base,
      simulatedMeanStrikeouts: null,
      simulatedMedianStrikeouts: null,
      simulatedP10Strikeouts: null,
      simulatedP90Strikeouts: null,
      overProbability: null,
      underProbability: null,
      pushProbability: null,
      simulationSupportsProduction: null,
      status: 'UNAVAILABLE',
      reason: nb?.reason || shadow?.promotionReason || 'Verified MLB pitcher strikeout V3 distribution is unavailable for this quote.',
    };
  }

  const actualTrials = Math.max(1000, Math.min(10000, Math.floor(trials)));
  const seedText = `${featureVector.featureVectorId}|${quote.line}|${quote.providerTimestamp}|${actualTrials}`;
  const rng = xorshift32(hashSeed(seedText));
  const cdf = buildNegativeBinomialCdf(nb.expectedStrikeouts, nb.dispersionR);
  const samples = new Array<number>(actualTrials);
  let sum = 0;
  let over = 0;
  let under = 0;
  let push = 0;

  for (let i = 0; i < actualTrials; i++) {
    const k = sampleFromCdf(cdf, rng());
    samples[i] = k;
    sum += k;
    if (k > quote.line) over++;
    else if (k < quote.line) under++;
    else push++;
  }

  samples.sort((a, b) => a - b);
  const overProb = over / actualTrials;
  const underProb = under / actualTrials;
  const pushProb = push / actualTrials;
  const support = recommendation?.recommendationStatus === 'QUALIFIES' && recommendation.side
    ? recommendation.side === 'OVER'
      ? overProb > underProb
      : underProb > overProb
    : null;

  return {
    ...base,
    trials: actualTrials as 10000,
    seed: crypto.createHash('sha256').update(seedText).digest('hex').slice(0, 12),
    simulatedMeanStrikeouts: round(sum / actualTrials, 3),
    simulatedMedianStrikeouts: percentile(samples, 0.5),
    simulatedP10Strikeouts: percentile(samples, 0.1),
    simulatedP90Strikeouts: percentile(samples, 0.9),
    overProbability: round(overProb, 6),
    underProbability: round(underProb, 6),
    pushProbability: round(pushProb, 6),
    simulationSupportsProduction: support,
    status: 'SIMULATED',
    reason: null,
  };
}
